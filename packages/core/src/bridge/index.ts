// Facade over the tmux primitives (and, from step 4, the JSONL turn reader).

import type { Config } from "../config";
import { ensureSession, inject, interrupt, sendKey, type TmuxTarget } from "./tmux";

export * from "./tmux";

export interface ClaudeBridge {
  readonly target: TmuxTarget;
  readonly created: boolean;
  readonly attached: boolean;
  /** Paste text into Claude's input and submit (Enter). */
  inject(text: string): void;
  /** Escape — interrupt the agent (barge-in). */
  interrupt(): void;
  /** Send a raw key/keyspec to the pane. */
  sendKey(key: string): void;
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
  return {
    target,
    created,
    attached,
    inject: (text) => inject(target, text),
    interrupt: () => interrupt(target),
    sendKey: (key) => sendKey(target, key),
  };
}
