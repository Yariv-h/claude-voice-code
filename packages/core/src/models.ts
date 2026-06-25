// Download offline speech models from k2-fsa/sherpa-onnx GitHub releases.
// Streaming fetch + atomic .part rename + idempotent skip; extracts .tar.bz2 via
// the system `tar`. Used by `cvc setup` / `cvc download-models`.

import { spawnSync } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const REL = "https://github.com/k2-fsa/sherpa-onnx/releases/download";
const ASR = `${REL}/asr-models`;
const TTS = `${REL}/tts-models`;

export const MODEL_ARTIFACTS: Record<string, { kind: "file" | "tar"; url: string; out: string }> = {
  vad: { kind: "file", url: `${ASR}/silero_vad.onnx`, out: "silero_vad.onnx" },
  whisper: { kind: "tar", url: `${ASR}/sherpa-onnx-whisper-base.en.tar.bz2`, out: "sherpa-onnx-whisper-base.en" },
  kokoro: { kind: "tar", url: `${TTS}/kokoro-int8-en-v0_19.tar.bz2`, out: "kokoro-int8-en-v0_19" },
  "kokoro-hifi": { kind: "tar", url: `${TTS}/kokoro-en-v0_19.tar.bz2`, out: "kokoro-en-v0_19" },
};

export function defaultModelsDir(): string {
  return process.env.CVC_MODELS_DIR || join(homedir(), ".cache", "claude-voice-code", "models");
}

export interface DownloadOpts {
  dir?: string;
  only?: string | null; // "vad" | "whisper" | "kokoro" | "all" | null (=all)
  hifi?: boolean;
  force?: boolean;
  log?: (s: string) => void;
}

async function download(url: string, dest: string, log: (s: string) => void): Promise<void> {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok || !res.body) throw new Error(`GET ${url} → ${res.status}`);
  const total = Number(res.headers.get("content-length") || 0);
  const part = `${dest}.part`;
  const ws = createWriteStream(part);
  let got = 0;
  let lastPct = -1;
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    got += value.length;
    if (!ws.write(Buffer.from(value))) await new Promise<void>((r) => ws.once("drain", () => r()));
    if (total) {
      const pct = Math.floor((got / total) * 100);
      if (pct !== lastPct && pct % 10 === 0) {
        log(`    ${pct}%  (${(got / 1e6).toFixed(1)}/${(total / 1e6).toFixed(1)} MB)`);
        lastPct = pct;
      }
    }
  }
  await new Promise<void>((resolve, reject) => {
    ws.on("error", reject);
    ws.end(() => resolve());
  });
  renameSync(part, dest);
}

export async function downloadModels(opts: DownloadOpts = {}): Promise<void> {
  const dir = opts.dir ?? defaultModelsDir();
  const log = opts.log ?? (() => {});
  mkdirSync(dir, { recursive: true });
  const sel = opts.only && opts.only !== "all" ? [opts.only] : ["vad", "whisper", "kokoro"];
  const list = sel.map((s) => (s === "kokoro" && opts.hifi ? "kokoro-hifi" : s));
  log(`Models → ${dir}`);
  for (const key of list) {
    const art = MODEL_ARTIFACTS[key];
    if (!art) throw new Error(`unknown model artifact: ${key}`);
    if (art.kind === "file") {
      const dest = join(dir, art.out);
      if (existsSync(dest) && !opts.force) {
        log(`  ✓ ${art.out} (exists)`);
        continue;
      }
      log(`  ↓ ${art.out}`);
      await download(art.url, dest, log);
    } else {
      const destDir = join(dir, art.out);
      if (existsSync(destDir) && !opts.force) {
        log(`  ✓ ${art.out}/ (exists)`);
        continue;
      }
      if (existsSync(destDir)) rmSync(destDir, { recursive: true, force: true });
      const tarball = join(dir, `${key}.tar.bz2`);
      log(`  ↓ ${art.out}/`);
      await download(art.url, tarball, log);
      log("    extracting…");
      const r = spawnSync("tar", ["xjf", tarball, "-C", dir], { stdio: ["ignore", "ignore", "inherit"] });
      rmSync(tarball, { force: true });
      if (r.status !== 0) throw new Error("tar extraction failed");
    }
  }
}
