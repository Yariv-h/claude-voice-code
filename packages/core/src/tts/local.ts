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
  const numThreads = Number(process.env.CVC_NUM_THREADS || 4);
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

const MAX_CHUNK = 160;
const FIRST_CHUNK = 64; // keep the first chunk tiny so audio starts in ~0.6s

/** Greedily pack words into ≤cap pieces, breaking only at word boundaries. */
function wordWrap(s: string, cap: number): string[] {
  const out: string[] = [];
  let buf = "";
  for (const w of s.split(/\s+/)) {
    if (buf && (buf + " " + w).length > cap) {
      out.push(buf);
      buf = w;
    } else {
      buf = buf ? `${buf} ${w}` : w;
    }
  }
  if (buf) out.push(buf);
  return out.length ? out : [s];
}

/**
 * Split into small speakable chunks so the first words play within ~0.6s while
 * the rest synthesize. Pack clauses (split on , ; : . ! ?) up to a cap — small
 * for the first chunk (fast first audio), larger after (fewer synth calls). A
 * single clause longer than the cap (e.g. a comma-less sentence) is hard-wrapped
 * at word boundaries — otherwise it'd be one giant chunk that delays all audio.
 */
export function splitForStreaming(text: string): string[] {
  const clauses = text
    .split(/(?<=[,;:.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: string[] = [];
  let buf = "";
  const cap = () => (out.length === 0 ? FIRST_CHUNK : MAX_CHUNK);
  for (const cl of clauses) {
    if (!buf) {
      buf = cl;
    } else if ((buf + " " + cl).length <= cap()) {
      buf = `${buf} ${cl}`;
      continue; // still fits — nothing to flush
    } else {
      out.push(buf);
      buf = cl;
    }
    // buf may now exceed the cap (a single oversized clause): hard-wrap it,
    // emitting all but the last piece and carrying the remainder forward.
    if (buf.length > cap()) {
      const pieces = wordWrap(buf, cap());
      buf = pieces.pop() as string;
      for (const p of pieces) out.push(p);
    }
  }
  if (buf) out.push(buf);
  return out.length ? out : [text.trim()].filter(Boolean);
}

export class LocalTts implements TtsProvider {
  readonly sampleRate = RATE_KOKORO;
  private speaker: number;
  private speed: number;

  constructor(private config: Config) {
    this.speaker = config.voice.kokoroSpeaker;
    this.speed = config.voice.speed;
  }

  /** Load the model + one throwaway synth so the first real turn isn't cold. */
  async prime(): Promise<void> {
    try {
      load(this.config).generate({ text: "Ready.", sid: this.speaker, speed: this.speed });
    } catch {
      /* warm-up is best-effort */
    }
  }

  async synthesize(
    text: string,
    onChunk: (chunk: TtsChunk) => void,
    signal?: AbortSignal,
  ): Promise<void> {
    const tts = load(this.config);
    for (const sentence of splitForStreaming(text)) {
      if (signal?.aborted) break;
      const audio = tts.generate({ text: sentence, sid: this.speaker, speed: this.speed });
      if (signal?.aborted) break;
      onChunk({ pcm: float32ToInt16(audio.samples), sampleRate: audio.sampleRate });
      await new Promise((r) => setImmediate(r)); // yield between sentences
    }
  }
}
