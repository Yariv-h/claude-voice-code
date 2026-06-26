// Facade over the tmux primitives + the JSONL turn reader.

import type { Config } from "../config";
import { ensureSession, inject, interrupt, sendKey, type TmuxTarget } from "./tmux";
import {
  awaitReply,
  captureBaseline,
  projectDirFor,
  type AwaitReplyOpts,
  type TurnBaseline,
} from "./turnReader";

export * from "./tmux";
export * from "./turnReader";

export interface ClaudeBridge {
  readonly target: TmuxTarget;
  readonly created: boolean;
  readonly attached: boolean;
  /** ~/.claude/projects dir Claude writes this session's transcript to. */
  readonly projectDir: string;
  /** Paste text into Claude's input and submit (Enter). */
  inject(text: string): void;
  /** Escape — interrupt the agent (barge-in). */
  interrupt(): void;
  /** Send a raw key/keyspec to the pane. */
  sendKey(key: string): void;
  /** Snapshot transcript state before injecting. */
  captureBaseline(): TurnBaseline;
  /** Wait for the reply to a turn started at `baseline`. */
  awaitReply(baseline: TurnBaseline, opts?: AwaitReplyOpts): Promise<string | null>;
  /** captureBaseline → inject → awaitReply (one full turn). */
  send(text: string, opts?: AwaitReplyOpts): Promise<string | null>;
}

export interface CreateBridgeOpts {
  /** Bind an existing session by name instead of the configured one. */
  attach?: string | null;
  /** Launch claude when a session must be created (default true). */
  launch?: boolean;
}

/** Build a bridge to Claude's tmux session per config, creating it if needed. */
export function createBridge(config: Config, opts: CreateBridgeOpts = {}): ClaudeBridge {
  const launch = opts.launch ?? true;
  const { target, created, attached } = ensureSession({
    session: config.tmux.session,
    cwd: config.tmux.cwd ?? process.cwd(),
    attach: opts.attach ?? config.tmux.attach,
    socket: config.tmux.socket,
    launchCommand: launch ? config.claudeBin : null,
  });
  const projectDir = projectDirFor(target.cwd);
  return {
    target,
    created,
    attached,
    projectDir,
    inject: (text) => inject(target, text),
    interrupt: () => interrupt(target),
    sendKey: (key) => sendKey(target, key),
    captureBaseline: () => captureBaseline(projectDir),
    awaitReply: (baseline, o) => awaitReply(projectDir, baseline, o),
    send: (text, o) => {
      const baseline = captureBaseline(projectDir);
      inject(target, text);
      return awaitReply(projectDir, baseline, { ...o, match: text });
    },
  };
}
