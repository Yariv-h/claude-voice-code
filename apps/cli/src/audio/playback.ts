// Stream PCM to the speakers via `play` (sox). kill() stops instantly (barge-in).

import { spawn } from "node:child_process";
import { int16ToBuffer } from "@cvc/core";

export interface Player {
  write(pcm: Int16Array): void;
  /** Flush remaining audio and resolve when playback finishes. */
  end(): Promise<void>;
  /** Stop immediately (barge-in). */
  kill(): void;
}

export function createPlayer(sampleRate: number): Player {
  const child = spawn(
    "play",
    ["-q", "-t", "raw", "-r", String(sampleRate), "-b", "16", "-c", "1", "-e", "signed-integer", "-"],
    { stdio: ["pipe", "ignore", "ignore"] },
  );
  let dead = false;
  child.on("error", () => {
    dead = true;
  });
  child.on("exit", () => {
    dead = true;
  });
  const stdin = child.stdin;

  return {
    write(pcm) {
      if (dead || !stdin || !stdin.writable) return;
      stdin.write(int16ToBuffer(pcm));
    },
    end() {
      return new Promise((resolve) => {
        if (dead || !stdin) return resolve();
        child.once("exit", () => resolve());
        stdin.end();
      });
    },
    kill() {
      if (!dead) child.kill("SIGKILL");
      dead = true;
    },
  };
}
