// `cvc inject` — text smoke test for the bridge: send a message to Claude and
// (from step 4) print the reply.

import { parseArgs } from "node:util";
import { createBridge, loadConfig } from "@cvc/core";

const HELP = `cvc inject — send text to Claude (bridge smoke test)

Usage:
  cvc inject -m "your message"
  echo "your message" | cvc inject

Options:
  -m, --message <text>   Message to send (else read from stdin)
      --attach <name>    Use an existing tmux session
      --no-launch        Don't launch claude if the session must be created
      --no-reply         Send only; don't wait for / print the reply
  -h, --help`;

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (process.stdin.isTTY) return resolve("");
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
  });
}

export async function run(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      message: { type: "string", short: "m" },
      attach: { type: "string" },
      "no-launch": { type: "boolean", default: false },
      "no-reply": { type: "boolean", default: false },
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
    console.error('No message. Pass -m "…" or pipe text via stdin.');
    return 1;
  }

  const { config } = loadConfig({});
  let bridge;
  try {
    bridge = createBridge(config, { attach: values.attach, launch: !values["no-launch"] });
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
  if (bridge.created) {
    console.error(`Created tmux session "${bridge.target.session}" (launched ${config.claudeBin}).`);
  }

  bridge.inject(text);

  if (values["no-reply"]) {
    console.error(`Sent to ${bridge.target.session}.`);
    return 0;
  }
  // Reply polling is wired in the next build step (turn reader).
  console.error("Sent. (Reply polling is added in the next build step.)");
  return 0;
}
