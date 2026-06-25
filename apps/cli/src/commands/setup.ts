// `cvc setup` — one-shot: ensure tmux, write a config, download offline models.

import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { downloadModels, loadConfig, tmuxAvailable } from "@cvc/core";

const HELP = `cvc setup — install tmux, write config, download offline models

Usage: cvc setup [--skip-models] [--hifi]

Options:
      --skip-models   Don't download local speech models (cloud-only)
      --hifi          Higher-quality fp32 Kokoro
  -h, --help`;

export async function run(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      "skip-models": { type: "boolean", default: false },
      hifi: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const { config } = loadConfig({});

  // 1. tmux
  if (tmuxAvailable()) {
    console.log("✓ tmux present");
  } else if (spawnSync("which", ["brew"], { stdio: "ignore" }).status !== 0) {
    console.error("✗ tmux missing and Homebrew not found — install tmux manually.");
  } else {
    console.log("Installing tmux via Homebrew…");
    const r = spawnSync("brew", ["install", "tmux"], { stdio: "inherit" });
    console.log(r.status === 0 ? "✓ tmux installed" : "✗ brew install tmux failed");
  }

  // 2. config file (in the current directory)
  const cfgPath = join(process.cwd(), "cvc.config.jsonc");
  if (existsSync(cfgPath)) {
    console.log("✓ cvc.config.jsonc exists");
  } else {
    const example = fileURLToPath(new URL("../../../../cvc.config.example.jsonc", import.meta.url));
    if (existsSync(example)) {
      copyFileSync(example, cfgPath);
      console.log(`✓ wrote ${cfgPath}`);
    }
  }

  // 3. models (only what the configured local engines need)
  const needLocal = config.stt === "local" || config.tts === "local";
  if (values["skip-models"] || !needLocal) {
    console.log("• skipping model download");
  } else {
    try {
      if (config.stt === "local") {
        await downloadModels({ dir: config.models.dir, only: "vad", log: (s) => console.log(s) });
        await downloadModels({ dir: config.models.dir, only: "whisper", log: (s) => console.log(s) });
      }
      if (config.tts === "local") {
        await downloadModels({ dir: config.models.dir, only: "kokoro", hifi: values.hifi, log: (s) => console.log(s) });
      }
    } catch (e) {
      console.error("✗ model download failed:", (e as Error).message);
    }
  }

  console.log("\nNext:");
  console.log("  cvc doctor          # verify");
  console.log("  cvc start           # talk in the terminal");
  console.log("  npm run web:build && cvc serve   # web UI");
  return 0;
}
