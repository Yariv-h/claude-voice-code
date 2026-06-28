// Read Claude's reply from the session JSONL it writes to disk. Claude names its
// own files, so we never map a session id → filename. The robust path: after
// injecting, find the file whose newest USER message is the text we injected —
// that's *our* session even if other Claude sessions share the project dir — and
// read the assistant reply that follows it. (Falls back to newest-by-mtime until
// our message appears.)

import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/**
 * Claude Code stores transcripts under ~/.claude/projects/<dir>, where <dir> is
 * the cwd with every "/" AND "." replaced by "-" (verified — e.g. a path
 * containing "/.claude/" maps to "--claude-").
 */
export function projectDirFor(cwd: string): string {
  return join(homedir(), ".claude", "projects", cwd.replace(/[/.]/g, "-"));
}

/** Non-subagent *.jsonl in the project dir, newest first. */
function sessionFiles(projectDir: string): string[] {
  let names: string[];
  try {
    names = readdirSync(projectDir);
  } catch {
    return [];
  }
  return names
    .filter((n) => n.endsWith(".jsonl") && !n.includes("subagent"))
    .map((n) => join(projectDir, n))
    .map((p) => {
      try {
        return { p, m: statSync(p).mtimeMs };
      } catch {
        return null;
      }
    })
    .filter((x): x is { p: string; m: number } => x !== null)
    .sort((a, b) => b.m - a.m)
    .map((x) => x.p);
}

/** Newest non-subagent *.jsonl, by mtime (null if none). */
export function newestSessionFile(projectDir: string): string | null {
  return sessionFiles(projectDir)[0] ?? null;
}

interface JsonlEntry {
  type?: string;
  isSidechain?: boolean;
  message?: { role?: string; content?: unknown };
}

function entryText(message: { content?: unknown }): string {
  const c = message.content;
  if (typeof c === "string") return c.trim();
  if (Array.isArray(c)) {
    let t = "";
    for (const p of c) {
      const part = p as { type?: string; text?: unknown };
      if (part?.type === "text" && typeof part.text === "string") t += part.text;
    }
    return t.trim();
  }
  return "";
}

interface Turn {
  role: "user" | "assistant";
  text: string;
}

/** Ordered user/assistant turns in a transcript (skips sidechains + noise). */
function parseTurns(file: string): Turn[] {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: Turn[] = [];
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let e: JsonlEntry;
    try {
      e = JSON.parse(s) as JsonlEntry;
    } catch {
      continue;
    }
    if (e.isSidechain || !e.message) continue;
    const role =
      e.type === "assistant" || e.message.role === "assistant"
        ? "assistant"
        : e.type === "user" || e.message.role === "user"
          ? "user"
          : null;
    if (!role) continue;
    const text = entryText(e.message);
    if (text) out.push({ role, text });
  }
  return out;
}

/** All assistant text messages in a transcript file, in order. */
export function assistantTexts(file: string): string[] {
  return parseTurns(file).filter((t) => t.role === "assistant").map((t) => t.text);
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

/** The file whose transcript contains `injected` as a user message (newest first). */
function fileWithUserMessage(projectDir: string, injected: string): string | null {
  for (const f of sessionFiles(projectDir)) {
    if (parseTurns(f).some((t) => t.role === "user" && norm(t.text) === injected)) return f;
  }
  return null;
}

/** The last assistant text that follows our injected user message in `file`. */
function replyAfterUserMessage(file: string, injected: string): string | null {
  const turns = parseTurns(file);
  let lastUser = -1;
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].role === "user" && norm(turns[i].text) === injected) lastUser = i;
  }
  if (lastUser < 0) return null;
  let reply = "";
  for (let i = lastUser + 1; i < turns.length; i++) {
    if (turns[i].role === "assistant") reply = turns[i].text;
  }
  return reply || null;
}

/** All assistant text after our injected user message, concatenated (in order). */
function assistantTextAfter(file: string, injected: string): string {
  const turns = parseTurns(file);
  let lastUser = -1;
  for (let i = 0; i < turns.length; i++) {
    if (turns[i].role === "user" && norm(turns[i].text) === injected) lastUser = i;
  }
  if (lastUser < 0) return "";
  const parts: string[] = [];
  for (let i = lastUser + 1; i < turns.length; i++) {
    if (turns[i].role === "assistant") parts.push(turns[i].text);
  }
  return parts.join("\n");
}

export interface TurnBaseline {
  activeFile: string | null;
  assistantCount: number;
}

/** Snapshot the transcript state *before* injecting, to detect new replies. */
export function captureBaseline(projectDir: string): TurnBaseline {
  const f = newestSessionFile(projectDir);
  return { activeFile: f, assistantCount: f ? assistantTexts(f).length : 0 };
}

export interface AwaitReplyOpts {
  pollMs?: number;
  stableMs?: number;
  deadlineMs?: number;
  signal?: AbortSignal;
  /** The injected user message — keys the reply to *our* session file. */
  match?: string;
  /** Called when a newer (still-changing) candidate reply is seen. */
  onProgress?: (partial: string) => void;
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        resolve();
      },
      { once: true },
    );
  });
}

/**
 * Poll for the assistant reply to an injected turn. With `match`, keys off the
 * session file that received that exact user message (correct even when other
 * Claude sessions share the project dir); otherwise watches newest-by-mtime
 * relative to `baseline`. Returns once the reply is stable for `stableMs`, or the
 * best-effort partial at the deadline, or null. Aborts promptly on `signal`.
 */
export async function awaitReply(
  projectDir: string,
  baseline: TurnBaseline,
  opts: AwaitReplyOpts = {},
): Promise<string | null> {
  const pollMs = opts.pollMs ?? 250;
  const stableMs = opts.stableMs ?? 900;
  const deadlineMs = opts.deadlineMs ?? 90_000;
  const deadline = Date.now() + deadlineMs;
  const match = opts.match ? norm(opts.match) : null;
  let lastText = "";
  let stableSince = 0;

  const baselineCandidate = (): string => {
    const f = newestSessionFile(projectDir);
    const texts = f ? assistantTexts(f) : [];
    if (f && f !== baseline.activeFile) return texts[texts.length - 1] ?? "";
    if (f && texts.length > baseline.assistantCount) return texts[texts.length - 1] ?? "";
    return "";
  };

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) break;

    let candidate = "";
    if (match) {
      const target = fileWithUserMessage(projectDir, match);
      // Once our file is found, read only from it (ignore other sessions). Until
      // then, hedge with newest-by-mtime so we don't stall on the first turn.
      candidate = target ? (replyAfterUserMessage(target, match) ?? "") : baselineCandidate();
    } else {
      candidate = baselineCandidate();
    }

    if (candidate) {
      if (candidate === lastText) {
        if (Date.now() - stableSince >= stableMs) return candidate;
      } else {
        lastText = candidate;
        stableSince = Date.now();
        opts.onProgress?.(candidate);
      }
    }
    await delay(pollMs, opts.signal);
  }
  return lastText || null;
}

export interface StreamReplyOpts {
  /** The injected user message — keys the reply to our session file. */
  match: string;
  signal?: AbortSignal;
  pollMs?: number;
  /** Turn is considered done after the reply text is unchanged this long. */
  idleMs?: number;
  deadlineMs?: number;
  /** Newly-complete text (one or more whole sentences) since the last call. */
  onText: (chunk: string, fullSoFar: string) => void;
}

/**
 * Stream an assistant reply as it lands: each poll, emit any newly-complete
 * sentences (ending in . ! ? or a newline) via onText, holding a trailing
 * partial until it completes; flush the remainder once the reply has been idle
 * for idleMs (turn done). Works whether Claude writes the transcript a sentence
 * at a time or a whole message at once. Returns the full reply text.
 */
export async function streamReply(projectDir: string, opts: StreamReplyOpts): Promise<string> {
  const pollMs = opts.pollMs ?? 200;
  const idleMs = opts.idleMs ?? 1200;
  const deadline = Date.now() + (opts.deadlineMs ?? 90_000);
  const match = norm(opts.match);
  let acc = "";
  let prev = "";
  let spoken = 0;
  let lastChange = Date.now();
  let saw = false;

  const hasSpeech = (s: string) => /[\p{L}\p{N}]/u.test(s);
  const flush = (final: boolean) => {
    const tail = acc.slice(spoken);
    if (!tail) return;
    if (final) {
      const t = tail.trim();
      if (hasSpeech(t)) opts.onText(t, acc);
      spoken = acc.length;
      return;
    }
    let cut = -1;
    for (let i = tail.length - 1; i >= 0; i--) {
      const ch = tail[i];
      if (ch === "." || ch === "!" || ch === "?" || ch === "\n") {
        cut = i;
        break;
      }
    }
    if (cut >= 0) {
      const ready = tail.slice(0, cut + 1).trim();
      if (hasSpeech(ready)) opts.onText(ready, acc.slice(0, spoken + cut + 1));
      spoken += cut + 1;
    }
  };

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) break;
    const file = fileWithUserMessage(projectDir, match);
    if (file) acc = assistantTextAfter(file, match);
    if (acc !== prev) {
      prev = acc;
      lastChange = Date.now();
      if (acc) saw = true;
    }
    flush(false);
    if (saw && Date.now() - lastChange >= idleMs) {
      flush(true);
      return acc;
    }
    await delay(pollMs, opts.signal);
  }
  if (!opts.signal?.aborted) flush(true);
  return acc;
}
