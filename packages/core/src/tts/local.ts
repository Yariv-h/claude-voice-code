// Local offline TTS via sherpa-onnx Kokoro (24 kHz). The native module is
// require()'d lazily so ElevenLabs-only / off users never load it.

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config";
import { float32ToInt16 } from "../audio/pcm";
import { RATE_KOKORO } from "../types";
import type { TtsChunk, TtsProvider } from "./types";

interface SherpaOfflineTts {
  readonly sampleRate: number;
  readonly numSpeakers: number;
  generate(opts: { text: string; sid: number; speed: number }): {
    samples: Float32Array;
    sampleRate: number;
  };
}
interface SherpaModule {
  OfflineTts: new (config: unknown) => SherpaOfflineTts;
}

// Process-wide singleton so the model loads once and is shared.
let cached: SherpaOfflineTts | null = null;
let cachedKey = "";

function resolveKokoro(config: Config): {
  model: string;
  voices: string;
  tokens: string;
  dataDir: string;
} {
  const dir = join(config.models.dir, config.models.kokoro);
  const int8 = join(dir, "model.int8.onnx");
  const fp32 = join(dir, "model.onnx");
  const model =
    config.models.kokoroQuality === "int8"
      ? existsSync(int8)
        ? int8
        : fp32
      : existsSync(fp32)
        ? fp32
        : int8;
  const paths = {
    model,
    voices: join(dir, "voices.bin"),
    tokens: join(dir, "tokens.txt"),
    dataDir: join(dir, "espeak-ng-data"),
  };
  for (const [label, p] of Object.entries(paths)) {
    if (!existsSync(p)) {
      throw new Error(
        `Kokoro ${label} not found at ${p}. Run "cvc setup" to download speech models.`,
      );
    }
  }
  return paths;
}

function load(config: Config): SherpaOfflineTts {
  const paths = resolveKokoro(config);
  if (cached && cachedKey === paths.model) return cached;
  const require = createRequire(import.meta.url);
  const sherpa = require("sherpa-onnx-node") as SherpaModule;
  const numThreads = Number(process.env.CVC_NUM_THREADS || 2);
  cached = new sherpa.OfflineTts({
    model: {
      kokoro: { ...paths, lengthScale: 1.0 },
      numThreads,
      debug: 0,
      provider: "cpu",
    },
    maxNumSentences: 1,
  });
  cachedKey = paths.model;
  return cached;
}

/** Split into sentence-ish chunks so playback starts before the whole reply. */
function splitSentences(text: string): string[] {
  const parts = text.match(/[^.!?\n]+[.!?]*\s*/g);
  return (parts ?? [text]).map((s) => s.trim()).filter(Boolean);
}

export class LocalTts implements TtsProvider {
  readonly sampleRate = RATE_KOKORO;
  private speaker: number;
  private speed: number;

  constructor(private config: Config) {
    this.speaker = config.voice.kokoroSpeaker;
    this.speed = config.voice.speed;
  }

  async synthesize(
    text: string,
    onChunk: (chunk: TtsChunk) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const tts = load(this.config);
    for (const sentence of splitSentences(text)) {
      if (signal?.aborted) break;
      const audio = tts.generate({ text: sentence, sid: this.speaker, speed: this.speed });
      if (signal?.aborted) break;
      onChunk({ pcm: float32ToInt16(audio.samples), sampleRate: audio.sampleRate });
      await new Promise((r) => setImmediate(r)); // yield between sentences
    }
  }
}
