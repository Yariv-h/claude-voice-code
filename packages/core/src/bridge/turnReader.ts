// Read Claude's reply from the session JSONL it writes to disk. Claude names its
// own files, so we never map a session id → filename; we watch the newest
// non-subagent *.jsonl and detect "the turn is done" by content stability.

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

/** Newest non-subagent *.jsonl in the project dir, by mtime (null if none). */
export function newestSessionFile(projectDir: string): string | null {
  let names: string[];
  try {
    names = readdirSync(projectDir);
  } catch {
    return null;
  }
  let best: { path: string; m: number } | null = null;
  for (const n of names) {
    if (!n.endsWith(".jsonl") || n.includes("subagent")) continue;
    const path = join(projectDir, n);
    let m: number;
    try {
      m = statSync(path).mtimeMs;
    } catch {
      continue;
    }
    if (!best || m > best.m) best = { path, m };
  }
  return best?.path ?? null;
}

interface JsonlEntry {
  type?: string;
  isSidechain?: boolean;
  message?: { role?: string; content?: unknown };
}

function lineAssistantText(entry: JsonlEntry): string | null {
  if (entry.isSidechain) return null;
  const m = entry.message;
  const isAssistant = entry.type === "assistant" || m?.role === "assistant";
  if (!m || !isAssistant) return null;
  const c = m.content;
  if (typeof c === "string") return c.trim() || null;
  if (Array.isArray(c)) {
    let t = "";
    for (const p of c) {
      const part = p as { type?: string; text?: unknown };
      if (part?.type === "text" && typeof part.text === "string") t += part.text;
    }
    return t.trim() || null;
  }
  return null;
}

/** All assistant text messages in a transcript file, in order. */
export function assistantTexts(file: string): string[] {
  let raw: string;
  try {
    raw = readFileSync(file, "utf8");
  } catch {
    return [];
  }
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    const s = line.trim();
    if (!s) continue;
    let e: JsonlEntry;
    try {
      e = JSON.parse(s) as JsonlEntry;
    } catch {
      continue;
    }
    const t = lineAssistantText(e);
    if (t) out.push(t);
  }
  return out;
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
 * Poll for the assistant reply that lands after a baseline snapshot. Returns the
 * last assistant text once it has been unchanged for `stableMs` (so multi-message
 * turns settle on the final text), or the best-effort partial at the deadline,
 * or null if nothing new arrived. Aborts promptly on `signal` (barge-in).
 */
export async function awaitReply(
  projectDir: string,
  baseline: TurnBaseline,
  opts: AwaitReplyOpts = {},
): Promise<string | null> {
  const pollMs = opts.pollMs ?? 400;
  const stableMs = opts.stableMs ?? 1500;
  const deadlineMs = opts.deadlineMs ?? 90_000;
  const deadline = Date.now() + deadlineMs;
  let lastText = "";
  let stableSince = 0;

  while (Date.now() < deadline) {
    if (opts.signal?.aborted) break;
    const f = newestSessionFile(projectDir);
    const texts = f ? assistantTexts(f) : [];
    // A newer file than baseline ⇒ any assistant text in it is fresh. The same
    // file ⇒ wait for the count to exceed the baseline so we don't grab a
    // pre-existing reply.
    let candidate = "";
    if (f && f !== baseline.activeFile) candidate = texts[texts.length - 1] ?? "";
    else if (f && texts.length > baseline.assistantCount) candidate = texts[texts.length - 1] ?? "";

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
