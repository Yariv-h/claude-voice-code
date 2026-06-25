// `cvc serve` — start the web UI server (browser voice over WebRTC).

import { parseArgs } from "node:util";
import { loadConfig, type Config, type DeepPartial } from "@cvc/core";
import { createServer } from "@cvc/server";

const HELP = `cvc serve — start the web UI server

Usage: cvc serve [--port <n>] [--host <addr>]

Options:
      --port <n>      Port to listen on (default 5173)
      --host <addr>   Host to bind (default 127.0.0.1)
  -h, --help

Build the UI first with: npm run web:build`;

export async function run(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      port: { type: "string" },
      host: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }

  const flags: DeepPartial<Config> = {};
  if (values.port || values.host) {
    flags.server = {
      ...(values.port ? { port: Number(values.port) } : {}),
      ...(values.host ? { host: values.host } : {}),
    };
  }
  const { config, errors } = loadConfig({ flags });
  for (const e of errors) console.error(`⚠ config: ${e}`);

  const { url } = await createServer(config).start();
  console.log(`\ncvc web UI → ${url}`);
  console.log(`  engines: stt=${config.stt} tts=${config.tts} · session=${config.tmux.session}`);
  console.log("  Open it in your browser. Ctrl-C to stop.\n");

  await new Promise<void>((resolve) => {
    process.once("SIGINT", () => {
      console.log("\nbye");
      resolve();
    });
  });
  return 0;
}
