// Opus ↔ PCM via opusscript (pure-JS/wasm, no native build). One per connection.
// Audio is 48 kHz mono s16le; Opus frames are 20 ms (960 samples).

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

interface OpusScriptInstance {
  encode(pcm: Buffer, frameSize: number): Buffer;
  decode(opus: Buffer): Buffer;
  delete?(): void;
}
interface OpusScriptCtor {
  new (sampleRate: number, channels: number, application: number): OpusScriptInstance;
  Application: { VOIP: number; AUDIO: number; RESTRICTED_LOWDELAY: number };
}
const OpusScript = require("opusscript") as OpusScriptCtor;

export const OPUS_RATE = 48000;
export const OPUS_FRAME_SAMPLES = 960; // 20 ms @ 48 kHz
export const OPUS_FRAME_BYTES = OPUS_FRAME_SAMPLES * 2; // mono s16

export class OpusCodec {
  // Separate encoder + decoder instances: a single opusscript instance used for
  // both, interleaved on the 20 ms pacer, corrupts its internal state (buzzing).
  private encoder = new OpusScript(OPUS_RATE, 1, OpusScript.Application.AUDIO);
  private decoder = new OpusScript(OPUS_RATE, 1, OpusScript.Application.AUDIO);

  /** Opus → 48 kHz mono s16 PCM. */
  decode(opus: Buffer): Buffer {
    return this.decoder.decode(opus);
  }

  /** One 20 ms PCM frame (1920 bytes) → Opus. */
  encodeFrame(pcm: Buffer): Buffer {
    return this.encoder.encode(pcm, OPUS_FRAME_SAMPLES);
  }

  destroy(): void {
    for (const c of [this.encoder, this.decoder]) {
      try {
        c.delete?.();
      } catch {
        /* ignore */
      }
    }
  }
}
