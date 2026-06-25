// `cvc download-models` — fetch offline speech models into the models dir.

import { parseArgs } from "node:util";
import { downloadModels, loadConfig } from "@cvc/core";

const HELP = `cvc download-models — download offline speech models

Usage: cvc download-models [--only vad|whisper|kokoro|all] [--hifi] [--force] [--dir <path>]

Options:
      --only <which>   Just one artifact (default: all needed)
      --hifi           Higher-quality fp32 Kokoro (~320MB vs ~103MB int8)
      --force          Re-download even if present
      --dir <path>     Target dir (default: config models.dir)
  -h, --help`;

export async function run(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      only: { type: "string" },
      hifi: { type: "boolean", default: false },
      force: { type: "boolean", default: false },
      dir: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }
  const { config } = loadConfig({});
  try {
    await downloadModels({
      dir: values.dir ?? config.models.dir,
      only: values.only ?? null,
      hifi: values.hifi,
      force: values.force,
      whisper: config.models.whisper,
      log: (s) => console.log(s),
    });
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
  console.log("Done.");
  return 0;
}
