// Audio-pipeline round trip: synthesize a phrase with local TTS, feed the PCM
// straight into local STT, and assert the words come back. Validates Kokoro,
// Whisper, the resamplers, and the s16/float conversions — with no mic/speaker.
//
// Heavy (loads native models), so gated behind CVC_AUDIO_TESTS=1 + model presence.
//   CVC_AUDIO_TESTS=1 npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { concatInt16 } from "../audio/pcm";
import { resampleLinear } from "../audio/resample";
import { defaultConfig, resolveConfig } from "../config";
import { LocalStt } from "./local";
import { LocalTts } from "../tts/local";

const cfg = resolveConfig(defaultConfig());
const haveModels =
  existsSync(join(cfg.models.dir, cfg.models.kokoro, "model.int8.onnx")) &&
  existsSync(join(cfg.models.dir, cfg.models.whisper, "base.en-encoder.int8.onnx"));
const RUN = process.env.CVC_AUDIO_TESTS === "1" && haveModels;

test("local TTS → STT round trip recovers the phrase", { skip: !RUN }, async () => {
  const phrase = "the quick brown fox jumps over the lazy dog";

  const tts = new LocalTts(cfg);
  const chunks: Int16Array[] = [];
  await tts.synthesize(phrase, (c) => chunks.push(c.pcm)); // 24 kHz
  const speech = resampleLinear(concatInt16(chunks), tts.sampleRate, 16000);
  // Pad with leading/trailing silence so the VAD catches the onset (real mic
  // audio always has lead-in; a synthesized clip starts abruptly otherwise).
  const pad = new Int16Array(8000); // 0.5 s @ 16 kHz
  const at16 = concatInt16([pad, speech, pad]);

  const stt = new LocalStt(cfg);
  await stt.start();
  const got: string[] = [];
  stt.onTranscript((t) => got.push(t.text));
  for (let i = 0; i < at16.length; i += 512) stt.push(at16.subarray(i, i + 512));
  stt.flush();
  await stt.stop();

  const text = got.join(" ").toLowerCase().replace(/[^a-z ]/g, " ");
  // Distinctive content words (a leading article/adjective can be dropped by
  // Whisper on a short contextless clip — not a pipeline failure).
  for (const w of ["brown", "fox", "jumps", "lazy", "dog"]) {
    assert.ok(text.includes(w), `expected "${w}" in transcript: "${text.trim()}"`);
  }
});
