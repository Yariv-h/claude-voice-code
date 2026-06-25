// Low-level tmux bridge: locate/create the Claude session and inject keystrokes.
// Uses execFileSync (no shell) so session names, cwd, and messages can't be
// mis-quoted or shell-injected.

import { execFileSync } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface TmuxTarget {
  session: string;
  socket: string | null;
  cwd: string;
}

const PASTE_BUFFER = "cvc"; // named buffer so we never clobber the user's clipboard

function flags(socket: string | null): string[] {
  return socket ? ["-S", socket] : [];
}

function run(args: string[], socket: string | null): string {
  return execFileSync("tmux", [...flags(socket), ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function tryRun(args: string[], socket: string | null): boolean {
  try {
    execFileSync("tmux", [...flags(socket), ...args], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Is the tmux binary available? */
export function tmuxAvailable(): boolean {
  return tryRun(["-V"], null);
}

/** tmux version string (e.g. "tmux 3.5a"), or null if unavailable. */
export function tmuxVersion(): string | null {
  try {
    return run(["-V"], null).trim();
  } catch {
    return null;
  }
}

/** Socket override (explicit → CVC_TMUX_SOCKET → null = tmux's own default). */
export function resolveSocket(explicit?: string | null): string | null {
  return explicit ?? process.env.CVC_TMUX_SOCKET ?? null;
}

/** Does a session exist on this socket? */
export function hasSession(session: string, socket: string | null): boolean {
  return tryRun(["has-session", "-t", session], socket);
}

/** The pane's current working directory (where Claude is running). */
export function paneCurrentPath(session: string, socket: string | null): string | null {
  try {
    const out = run(
      ["display-message", "-p", "-t", session, "#{pane_current_path}"],
      socket,
    ).trim();
    return out || null;
  } catch {
    return null;
  }
}

let counter = 0;

/** Inject a message: paste it into the pane, then press Enter (as if typed). */
export function inject(target: TmuxTarget, text: string): void {
  const body = text.replace(/\s+$/, ""); // no trailing newline → Enter submits exactly once
  const tmp = join(tmpdir(), `cvc-msg-${process.pid}-${counter++}.txt`);
  writeFileSync(tmp, body);
  try {
    run(["load-buffer", "-b", PASTE_BUFFER, tmp], target.socket);
    run(["paste-buffer", "-d", "-b", PASTE_BUFFER, "-t", target.session], target.socket);
    run(["send-keys", "-t", target.session, "Enter"], target.socket);
  } finally {
    try {
      unlinkSync(tmp);
    } catch {
      /* ignore */
    }
  }
}

/** Send a single key/keyspec to the pane (e.g. "Escape", "Enter", "C-c"). */
export function sendKey(target: TmuxTarget, key: string): void {
  run(["send-keys", "-t", target.session, key], target.socket);
}

/** Interrupt the agent (barge-in) — Escape in Claude's TUI. */
export function interrupt(target: TmuxTarget): void {
  sendKey(target, "Escape");
}

/** Capture the visible pane text (diagnostics / tests). */
export function capturePane(target: TmuxTarget): string {
  try {
    return run(["capture-pane", "-p", "-t", target.session], target.socket);
  } catch {
    return "";
  }
}

export interface EnsureOpts {
  session: string;
  cwd: string;
  attach?: string | null;
  socket?: string | null;
  /** Command to run when creating a new session (e.g. the claude binary). */
  launchCommand?: string | null;
}

export interface EnsureResult {
  target: TmuxTarget;
  created: boolean;
  attached: boolean;
}

/** Ensure a usable session exists: attach to one, reuse, or create + launch. */
export function ensureSession(opts: EnsureOpts): EnsureResult {
  if (!tmuxAvailable()) {
    throw new Error('tmux is not installed. Run "cvc setup" or "brew install tmux".');
  }
  const socket = resolveSocket(opts.socket);

  if (opts.attach) {
    if (!hasSession(opts.attach, socket)) {
      throw new Error(`tmux session "${opts.attach}" not found (--attach).`);
    }
    const cwd = paneCurrentPath(opts.attach, socket) ?? opts.cwd;
    return { target: { session: opts.attach, socket, cwd }, created: false, attached: true };
  }

  if (hasSession(opts.session, socket)) {
    const cwd = paneCurrentPath(opts.session, socket) ?? opts.cwd;
    return { target: { session: opts.session, socket, cwd }, created: false, attached: false };
  }

  const args = ["new-session", "-d", "-s", opts.session, "-c", opts.cwd];
  if (opts.launchCommand) args.push(opts.launchCommand);
  run(args, socket);
  const cwd = paneCurrentPath(opts.session, socket) ?? opts.cwd;
  return { target: { session: opts.session, socket, cwd }, created: true, attached: false };
}

/** Kill a session (teardown / tests). */
export function killSession(session: string, socket: string | null): void {
  tryRun(["kill-session", "-t", session], socket);
}
