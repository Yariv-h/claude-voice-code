// `cvc say` — synthesize speech from text (TTS engine smoke test). Plays it, or
// writes a WAV with --out (handy headless).

import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { concatInt16, createTts, loadConfig, pcm16ToWav } from "@cvc/core";
import { createPlayer } from "../audio/playback";
import { readStdin } from "../stdin";

const HELP = `cvc say — synthesize speech from text (TTS smoke test)

Usage:
  cvc say -m "hello world"
  cvc say -m "hello world" --out hello.wav

Options:
  -m, --message <text>   Text to speak (else read from stdin)
      --out <file.wav>   Write a WAV file instead of playing
  -h, --help`;

export async function run(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      message: { type: "string", short: "m" },
      out: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }

  const text = (values.message ?? (await readStdin())).trim();
  if (!text) {
    console.error('No text. Pass -m "…" or pipe text via stdin.');
    return 1;
  }

  const { config } = loadConfig({});
  let tts;
  try {
    tts = createTts(config);
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
  if (!tts) {
    console.error('tts is "off" in config — nothing to synthesize.');
    return 1;
  }

  const t0 = Date.now();

  if (values.out) {
    const chunks: Int16Array[] = [];
    let rate = tts.sampleRate;
    await tts.synthesize(text, (c) => {
      chunks.push(c.pcm);
      rate = c.sampleRate;
    });
    const pcm = concatInt16(chunks);
    writeFileSync(values.out, pcm16ToWav(pcm, rate));
    console.error(
      `Wrote ${values.out} — ${(pcm.length / rate).toFixed(2)}s @ ${rate}Hz (synth ${((Date.now() - t0) / 1000).toFixed(1)}s)`,
    );
    return 0;
  }

  if (spawnSync("which", ["play"], { stdio: "ignore" }).status !== 0) {
    console.error("`play` (sox) not found. Install: brew install sox — or use --out file.wav");
    return 1;
  }
  const player = createPlayer(tts.sampleRate);
  await tts.synthesize(text, (c) => player.write(c.pcm));
  await player.end();
  console.error(`Spoke (${((Date.now() - t0) / 1000).toFixed(1)}s).`);
  return 0;
}
