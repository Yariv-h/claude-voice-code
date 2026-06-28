// Local offline STT via sherpa-onnx: Silero VAD segments an utterance, then
// offline Whisper base.en transcribes the whole segment (more accurate than
// streaming). Native module is require()'d lazily.

import { createRequire } from "node:module";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Config } from "../config";
import { int16ToFloat32 } from "../audio/pcm";
import { RATE_STT, type Transcript } from "../types";
import type { SttProvider } from "./types";

interface SherpaStream {
  acceptWaveform(o: { sampleRate: number; samples: Float32Array }): void;
}
interface SherpaRecognizer {
  createStream(): SherpaStream;
  decode(s: SherpaStream): void;
  getResult(s: SherpaStream): { text: string };
}
interface SherpaSegment {
  samples: Float32Array;
  start: number;
}
interface SherpaVad {
  acceptWaveform(samples: Float32Array): void;
  isEmpty(): boolean;
  isDetected?(): boolean;
  front(): SherpaSegment;
  pop(): void;
  clear?(): void;
  flush?(): void;
}
interface SherpaModule {
  OfflineRecognizer: new (config: unknown) => SherpaRecognizer;
  Vad: new (config: unknown, bufferSeconds: number) => SherpaVad;
}

const VAD_WINDOW = 512;

let recognizer: SherpaRecognizer | null = null;
let recKey = "";

function sherpa(): SherpaModule {
  const require = createRequire(import.meta.url);
  return require("sherpa-onnx-node") as SherpaModule;
}

/**
 * Encoder path for a sherpa whisper dir — files are prefixed by the model name
 * (e.g. "sherpa-onnx-whisper-small.en" → small.en-encoder.int8.onnx). int8 is
 * preferred; large-v3 etc. may ship fp32 only. Returns null if absent.
 */
export function whisperEncoderPath(modelsDir: string, whisperDir: string): string | null {
  const dir = join(modelsDir, whisperDir);
  const name = whisperDir.replace(/^sherpa-onnx-whisper-/, "");
  const int8 = join(dir, `${name}-encoder.int8.onnx`);
  const fp32 = join(dir, `${name}-encoder.onnx`);
  return existsSync(int8) ? int8 : existsSync(fp32) ? fp32 : null;
}

function loadRecognizer(config: Config): SherpaRecognizer {
  const dir = join(config.models.dir, config.models.whisper);
  const name = config.models.whisper.replace(/^sherpa-onnx-whisper-/, "");
  const encoder = whisperEncoderPath(config.models.dir, config.models.whisper);
  if (!encoder) {
    throw new Error(`Whisper model "${config.models.whisper}" not found in ${config.models.dir}. Run "cvc setup".`);
  }
  const decoder = encoder.replace("-encoder.", "-decoder."); // same int8/fp32 variant
  const tokens = join(dir, `${name}-tokens.txt`);
  if (recognizer && recKey === encoder) return recognizer;
  const numThreads = Number(process.env.CVC_NUM_THREADS || 4);
  recognizer = new (sherpa().OfflineRecognizer)({
    featConfig: { sampleRate: RATE_STT, featureDim: 80 },
    modelConfig: {
      whisper: { encoder, decoder, language: "en", task: "transcribe" },
      tokens, // NOTE: at modelConfig level, not inside whisper{}
      numThreads,
      provider: "cpu",
      debug: 0,
    },
    decodingMethod: "greedy_search",
  });
  recKey = encoder;
  return recognizer;
}

function makeVad(config: Config): SherpaVad {
  const model = join(config.models.dir, config.models.vad);
  if (!existsSync(model)) throw new Error(`VAD model not found at ${model}. Run "cvc setup".`);
  return new (sherpa().Vad)(
    {
      sileroVad: {
        model,
        threshold: config.vad.threshold,
        minSilenceDuration: config.vad.minSilenceSec,
        minSpeechDuration: config.vad.minSpeechSec,
        maxSpeechDuration: config.vad.maxSpeechSec,
        windowSize: config.vad.windowSize,
      },
      sampleRate: RATE_STT,
      numThreads: 1,
      debug: 0,
    },
    30,
  );
}

/**
 * Whisper marks non-speech as bracketed/parenthesized annotations — e.g.
 * "[BLANK_AUDIO]", "(buzzing)", "(buzzer)", "[ Silence ]", "♪ … ♪". Strip them so
 * noise never reaches Claude; return "" when nothing speech-like remains (any
 * Unicode letter/number counts as speech, so non-English transcripts survive).
 */
export function cleanTranscript(raw: string): string {
  const cleaned = raw
    .replace(/\[[^\]]*\]/g, " ") // [BLANK_AUDIO], [ Silence ]
    .replace(/\([^)]*\)/g, " ") // (buzzing), (laughs)
    .replace(/\*[^*]*\*/g, " ") // *door creaks*
    .replace(/♪[^♪]*♪?/g, " ") // ♪ music ♪
    // Whisper's greedy decode can truncate a noise token mid-word with no closer
    // (e.g. "[BL", "[BLANK_AUD") — strip an unterminated bracket/paren run too.
    .replace(/[[(][^\])]*$/, " ")
    .replace(/\s+/g, " ")
    .trim();
  return /[\p{L}\p{N}]/u.test(cleaned) ? cleaned : "";
}

export class LocalStt implements SttProvider {
  readonly inputRate = RATE_STT;
  private rec: SherpaRecognizer | null = null;
  private vad: SherpaVad | null = null;
  private pending = new Float32Array(0);
  private transcriptCbs: ((t: Transcript) => void)[] = [];
  private speechCbs: (() => void)[] = [];
  private speaking = false;
  private closed = false;

  constructor(private config: Config) {}

  async start(): Promise<void> {
    this.rec = loadRecognizer(this.config);
    this.vad = makeVad(this.config);
    this.closed = false;
  }

  onTranscript(cb: (t: Transcript) => void): void {
    this.transcriptCbs.push(cb);
  }
  onSpeechStart(cb: () => void): void {
    this.speechCbs.push(cb);
  }

  push(frame: Int16Array): void {
    if (this.closed || !this.vad || !this.rec) return;
    const incoming = int16ToFloat32(frame);
    const merged = new Float32Array(this.pending.length + incoming.length);
    merged.set(this.pending);
    merged.set(incoming, this.pending.length);
    this.pending = merged;

    let off = 0;
    while (off + VAD_WINDOW <= this.pending.length) {
      this.vad.acceptWaveform(this.pending.subarray(off, off + VAD_WINDOW));
      off += VAD_WINDOW;
    }
    if (off > 0) this.pending = this.pending.slice(off); // slice copies → no leak

    const detected = this.vad.isDetected?.() ?? false;
    if (detected && !this.speaking) {
      this.speaking = true;
      for (const cb of this.speechCbs) cb();
    } else if (!detected && this.speaking) {
      this.speaking = false;
    }

    this.drain();
  }

  private drain(): void {
    if (!this.vad || !this.rec) return;
    while (!this.vad.isEmpty()) {
      const seg = this.vad.front();
      this.vad.pop();
      const st = this.rec.createStream();
      st.acceptWaveform({ sampleRate: RATE_STT, samples: seg.samples });
      const t0 = Date.now();
      this.rec.decode(st);
      const text = cleanTranscript(this.rec.getResult(st).text || "");
      const decodeMs = Date.now() - t0;
      if (text) for (const cb of this.transcriptCbs) cb({ text, final: true, decodeMs });
    }
  }

  flush(): void {
    if (!this.vad) return;
    try {
      this.vad.flush?.();
    } catch {
      /* some builds lack flush; minSilenceDuration ends the segment instead */
    }
    this.drain();
  }

  async stop(): Promise<void> {
    this.closed = true;
    this.pending = new Float32Array(0);
    try {
      this.vad?.clear?.();
    } catch {
      /* ignore */
    }
  }
}
