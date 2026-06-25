// Cloud TTS via ElevenLabs HTTP streaming (raw PCM). No SDK / native module —
// just fetch. Streams chunks so playback starts before the whole reply is done.

import { bufferToInt16 } from "../audio/pcm";
import type { Config } from "../config";
import type { TtsChunk, TtsProvider } from "./types";

const EL_RATE = 24000; // pcm_24000 is broadly available across tiers
const EL_BASE = "https://api.elevenlabs.io/v1";

export class ElevenLabsTts implements TtsProvider {
  readonly sampleRate = EL_RATE;

  constructor(private config: Config) {
    if (!config.elevenlabs.apiKey) {
      throw new Error("ElevenLabs API key required (set ELEVENLABS_API_KEY).");
    }
  }

  async synthesize(
    text: string,
    onChunk: (chunk: TtsChunk) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const { apiKey, ttsVoiceId, ttsModel } = this.config.elevenlabs;
    const url = `${EL_BASE}/text-to-speech/${encodeURIComponent(ttsVoiceId)}/stream?output_format=pcm_${EL_RATE}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "xi-api-key": apiKey, "content-type": "application/json" },
      body: JSON.stringify({
        text,
        model_id: ttsModel,
        voice_settings: { stability: 0.4, similarity_boost: 0.8 },
      }),
      signal,
    });
    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => "");
      throw new Error(`ElevenLabs TTS ${res.status}: ${detail.slice(0, 180)}`);
    }

    const reader = res.body.getReader();
    let leftover = Buffer.alloc(0);
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal?.aborted) {
        await reader.cancel().catch(() => {});
        break;
      }
      const buf = Buffer.concat([leftover, Buffer.from(value)]);
      const usable = buf.length - (buf.length % 2); // whole s16 samples only
      if (usable > 0) onChunk({ pcm: bufferToInt16(buf.subarray(0, usable)), sampleRate: EL_RATE });
      leftover = buf.subarray(usable);
    }
  }
}
