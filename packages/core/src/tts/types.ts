// Text-to-speech provider interface (local Kokoro or ElevenLabs behind it).

export interface TtsChunk {
  /** Mono s16 PCM. */
  pcm: Int16Array;
  /** Sample rate of this chunk (Hz). */
  sampleRate: number;
}

export interface TtsProvider {
  /** Native output sample rate (Hz) — a hint for consumers (e.g. the player). */
  readonly sampleRate: number;
  /**
   * Synthesize `text`, streaming PCM chunks as they're produced so playback can
   * start early. Resolves when fully synthesized. Stops promptly if `signal`
   * aborts (barge-in).
   */
  synthesize(
    text: string,
    onChunk: (chunk: TtsChunk) => void,
    signal?: AbortSignal,
  ): Promise<void>;
  close?(): void;
}
