// Speech-to-text provider interface (local Whisper+VAD or ElevenLabs Scribe).

import type { Transcript } from "../types";

export interface SttProvider {
  /** Sample rate (Hz) the provider expects push() frames in. */
  readonly inputRate: number;
  start(): Promise<void>;
  /**
   * Optional warm-up: run one throwaway decode so the first real utterance
   * doesn't pay ONNX-JIT cost. Best-effort — must never throw.
   */
  prime?(): Promise<void>;
  /** Feed a mono s16 PCM frame at inputRate. */
  push(frame: Int16Array): void;
  /** Force end-of-utterance (e.g. push-to-talk release): finalize buffered speech. */
  flush(): void;
  /** Final (and, for cloud, partial) transcripts. */
  onTranscript(cb: (t: Transcript) => void): void;
  /** Fires when speech begins — used for barge-in in open-mic mode. */
  onSpeechStart(cb: () => void): void;
  stop(): Promise<void>;
}
