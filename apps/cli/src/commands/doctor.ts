// `cvc doctor` — verify the environment for voice. Exits nonzero on problems.

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { bufferToInt16, loadConfig, rms16, tmuxAvailable, tmuxVersion } from "@cvc/core";

const has = (cmd: string) => spawnSync("which", [cmd], { stdio: "ignore" }).status === 0;
const mark = (good: boolean) => (good ? "\x1b[32m✓\x1b[0m" : "\x1b[31m✗\x1b[0m");

export async function run(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: { mic: { type: "boolean", default: false }, help: { type: "boolean", short: "h", default: false } },
    allowPositionals: true,
  });
  if (values.help) {
    console.log("cvc doctor [--mic]\n  Checks node/tmux/claude/sox/models/api-key (+ mic with --mic).");
    return 0;
  }

  const { config } = loadConfig({});
  let problems = 0;
  const line = (label: string, good: boolean, note = "") => {
    if (!good) problems++;
    console.log(`${mark(good)} ${label}${note ? `  \x1b[2m${note}\x1b[0m` : ""}`);
  };

  const major = Number(process.versions.node.split(".")[0]);
  line(`Node ${process.versions.node}`, major >= 20, major >= 20 ? "" : "need ≥ 20");
  line("tmux", tmuxAvailable(), tmuxVersion() ?? "missing — run `cvc setup` or `brew install tmux`");
  line(`claude (${config.claudeBin})`, has(config.claudeBin) || config.claudeBin.includes(" "), has(config.claudeBin) ? "" : "not on PATH");
  line("sox (rec/play)", has("rec") && has("play"), has("rec") && has("play") ? "" : "brew install sox");

  const md = config.models.dir;
  if (config.tts === "local") {
    const k = config.models.kokoro;
    line("Kokoro model", existsSync(join(md, k, "model.int8.onnx")) || existsSync(join(md, k, "model.onnx")), md);
  }
  if (config.stt === "local") {
    line("Whisper model", existsSync(join(md, config.models.whisper, "base.en-encoder.int8.onnx")), md);
    line("VAD model", existsSync(join(md, config.models.vad)));
  }
  if (config.stt === "elevenlabs" || config.tts === "elevenlabs") {
    line("ELEVENLABS_API_KEY", !!config.elevenlabs.apiKey, config.elevenlabs.apiKey ? "" : "set the env var");
  }

  if (values.mic) {
    if (!has("rec")) line("mic capture", false, "rec not found");
    else {
      console.log("  recording 0.6s — say something…");
      const r = spawnSync(
        "rec",
        ["-q", "-r", "16000", "-b", "16", "-c", "1", "-e", "signed-integer", "-t", "raw", "-", "trim", "0", "0.6"],
        { maxBuffer: 8 * 1024 * 1024 },
      );
      const buf = r.stdout as Buffer | undefined;
      if (r.status === 0 && buf && buf.length) {
        const level = rms16(bufferToInt16(buf));
        line(`mic input (RMS ${level.toFixed(3)})`, level > 0.001, level > 0.001 ? "" : "silent — grant mic permission to your terminal");
      } else {
        line("mic capture", false, "no audio (mic permission?)");
      }
    }
  }

  console.log(problems === 0 ? "\n\x1b[32mAll good.\x1b[0m" : `\n\x1b[31m${problems} problem(s) above.\x1b[0m`);
  return problems === 0 ? 0 : 1;
}
