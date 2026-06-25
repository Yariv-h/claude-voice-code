#!/usr/bin/env node
// Download offline speech models from k2-fsa/sherpa-onnx GitHub releases.
//   node scripts/download-models.mjs [--dir D] [--only vad|whisper|kokoro|all]
//                                    [--hifi] [--force]
// Idempotent: skips artifacts that already exist (use --force to re-fetch).

import { createWriteStream, existsSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";

const REL = "https://github.com/k2-fsa/sherpa-onnx/releases/download";
const ASR = `${REL}/asr-models`;
const TTS = `${REL}/tts-models`;

const ARTIFACTS = {
  vad: { kind: "file", url: `${ASR}/silero_vad.onnx`, out: "silero_vad.onnx" },
  whisper: { kind: "tar", url: `${ASR}/sherpa-onnx-whisper-base.en.tar.bz2`, dir: "sherpa-onnx-whisper-base.en" },
  kokoro: { kind: "tar", url: `${TTS}/kokoro-int8-en-v0_19.tar.bz2`, dir: "kokoro-int8-en-v0_19" },
  "kokoro-hifi": { kind: "tar", url: `${TTS}/kokoro-en-v0_19.tar.bz2`, dir: "kokoro-en-v0_19" },
};

function parseArgs() {
  const a = process.argv.slice(2);
  const o = {
    dir: process.env.CVC_MODELS_DIR || join(homedir(), ".cache", "claude-voice-code", "models"),
    only: null,
    force: false,
    hifi: false,
  };
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    if (x === "--dir") o.dir = a[++i];
    else if (x === "--only") o.only = a[++i];
    else if (x === "--force") o.force = true;
    else if (x === "--hifi") o.hifi = true;
    else if (x === "-h" || x === "--help") {
      console.log("usage: download-models [--dir D] [--only vad|whisper|kokoro|all] [--hifi] [--force]");
      process.exit(0);
    } else {
      console.error(`unknown arg: ${x}`);
      process.exit(2);
    }
  }
  return o;
}

async function download(url, dest) {
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
    if (!ws.write(Buffer.from(value))) await new Promise((r) => ws.once("drain", r));
    if (total) {
      const pct = Math.floor((got / total) * 100);
      if (pct !== lastPct && pct % 5 === 0) {
        process.stdout.write(`\r    ${pct}%  (${(got / 1e6).toFixed(1)}/${(total / 1e6).toFixed(1)} MB)`);
        lastPct = pct;
      }
    }
  }
  await new Promise((resolve, reject) => ws.end((e) => (e ? reject(e) : resolve())));
  renameSync(part, dest);
  process.stdout.write(`\r    done  (${(got / 1e6).toFixed(1)} MB)            \n`);
}

async function getArtifact(key, opts) {
  const art = ARTIFACTS[key];
  if (art.kind === "file") {
    const dest = join(opts.dir, art.out);
    if (existsSync(dest) && !opts.force) return console.log(`  ✓ ${art.out} (exists)`);
    console.log(`  ↓ ${art.out}`);
    await download(art.url, dest);
  } else {
    const dest = join(opts.dir, art.dir);
    if (existsSync(dest) && !opts.force) return console.log(`  ✓ ${art.dir}/ (exists)`);
    if (existsSync(dest)) rmSync(dest, { recursive: true, force: true });
    const tarball = join(opts.dir, `${key}.tar.bz2`);
    console.log(`  ↓ ${art.dir}/`);
    await download(art.url, tarball);
    process.stdout.write("    extracting…");
    const r = spawnSync("tar", ["xjf", tarball, "-C", opts.dir], { stdio: ["ignore", "ignore", "inherit"] });
    rmSync(tarball, { force: true });
    if (r.status !== 0) throw new Error("tar extraction failed");
    process.stdout.write(" done\n");
  }
}

const opts = parseArgs();
mkdirSync(opts.dir, { recursive: true });
const sel = opts.only && opts.only !== "all" ? [opts.only] : ["vad", "whisper", "kokoro"];
const list = sel.map((s) => (s === "kokoro" && opts.hifi ? "kokoro-hifi" : s));
console.log(`Models → ${opts.dir}`);
for (const k of list) {
  if (!ARTIFACTS[k]) {
    console.error(`unknown artifact: ${k}`);
    process.exit(2);
  }
  await getArtifact(k, opts);
}
console.log("Done.");
