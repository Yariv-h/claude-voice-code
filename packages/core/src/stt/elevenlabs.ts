// Cloud STT via ElevenLabs. Endpointing is done locally with a simple energy
// gate (no native module), then each finished utterance is transcribed by the
// stable /speech-to-text (Scribe) HTTP endpoint. Push-to-talk's flush() also
// finalizes the buffered audio immediately.

import { concatInt16, rms16 } from "../audio/pcm";
import type { Config } from "../config";
import { RATE_STT, type Transcript } from "../types";
import { pcm16ToWav } from "../audio/wav";
import type { SttProvider } from "./types";

const EL_BASE = "https://api.elevenlabs.io/v1";
const SPEECH_THRESHOLD = 0.012; // RMS over which a frame counts as speech

export class ElevenLabsStt implements SttProvider {
  readonly inputRate = RATE_STT;
  private buf: Int16Array[] = [];
  private inSpeech = false;
  private silenceMs = 0;
  private transcriptCbs: ((t: Transcript) => void)[] = [];
  private speechCbs: (() => void)[] = [];
  private closed = false;

  constructor(private config: Config) {
    if (!config.elevenlabs.apiKey) {
      throw new Error("ElevenLabs API key required (set ELEVENLABS_API_KEY).");
    }
  }

  async start(): Promise<void> {
    this.closed = false;
  }

  onTranscript(cb: (t: Transcript) => void): void {
    this.transcriptCbs.push(cb);
  }
  onSpeechStart(cb: () => void): void {
    this.speechCbs.push(cb);
  }

  push(frame: Int16Array): void {
    if (this.closed) return;
    const frameMs = (frame.length / this.inputRate) * 1000;
    if (rms16(frame) >= SPEECH_THRESHOLD) {
      if (!this.inSpeech) {
        this.inSpeech = true;
        for (const cb of this.speechCbs) cb();
      }
      this.silenceMs = 0;
      this.buf.push(frame);
    } else if (this.inSpeech) {
      this.buf.push(frame); // keep trailing silence in the clip
      this.silenceMs += frameMs;
      if (this.silenceMs >= this.config.vad.minSilenceSec * 1000) this.endpoint();
    }
  }

  flush(): void {
    if (this.inSpeech || this.buf.length) this.endpoint();
  }

  private endpoint(): void {
    const audio = concatInt16(this.buf);
    this.buf = [];
    this.inSpeech = false;
    this.silenceMs = 0;
    if (audio.length < this.config.vad.minSpeechSec * this.inputRate) return; // too short
    void this.transcribe(audio);
  }

  private async transcribe(audio: Int16Array): Promise<void> {
    try {
      const form = new FormData();
      form.append("model_id", this.config.elevenlabs.sttModel);
      form.append("file", new Blob([pcm16ToWav(audio, this.inputRate)], { type: "audio/wav" }), "audio.wav");
      const t0 = Date.now();
      const res = await fetch(`${EL_BASE}/speech-to-text`, {
        method: "POST",
        headers: { "xi-api-key": this.config.elevenlabs.apiKey },
        body: form,
      });
      if (!res.ok) {
        console.error(`[voice] ElevenLabs STT ${res.status}: ${(await res.text().catch(() => "")).slice(0, 160)}`);
        return;
      }
      const data = (await res.json()) as { text?: string };
      const text = (data.text || "").trim();
      const decodeMs = Date.now() - t0;
      if (text) for (const cb of this.transcriptCbs) cb({ text, final: true, decodeMs });
    } catch (e) {
      console.error("[voice] ElevenLabs STT error:", (e as Error).message);
    }
  }

  async stop(): Promise<void> {
    this.closed = true;
    this.buf = [];
  }
}
