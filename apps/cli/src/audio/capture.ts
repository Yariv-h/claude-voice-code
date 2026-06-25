// Capture the mic via `rec` (sox) as mono s16 PCM at a chosen rate.

import { spawn } from "node:child_process";
import { bufferToInt16 } from "@cvc/core";

export interface Capture {
  stop(): void;
}

export interface CaptureOpts {
  rate: number;
  onFrame: (pcm: Int16Array) => void;
  onError?: (err: Error) => void;
}

export function startCapture(opts: CaptureOpts): Capture {
  const child = spawn(
    "rec",
    ["-q", "-r", String(opts.rate), "-b", "16", "-c", "1", "-e", "signed-integer", "-t", "raw", "-"],
    { stdio: ["ignore", "pipe", "ignore"] },
  );
  let leftover = Buffer.alloc(0);
  child.stdout.on("data", (d: Buffer) => {
    const buf = Buffer.concat([leftover, d]);
    const usable = buf.length - (buf.length % 2); // whole s16 samples only
    if (usable > 0) opts.onFrame(bufferToInt16(buf.subarray(0, usable)));
    leftover = buf.subarray(usable);
  });
  child.on("error", (e) => opts.onError?.(e as Error));
  return {
    stop() {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    },
  };
}
