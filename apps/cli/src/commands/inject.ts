// `cvc inject` — text smoke test for the bridge: send a message to Claude and
// print its reply (the whole product, headless).

import { parseArgs } from "node:util";
import { createBridge, loadConfig } from "@cvc/core";
import { readStdin } from "../stdin";

const HELP = `cvc inject — send text to Claude and print the reply

Usage:
  cvc inject -m "your message"
  echo "your message" | cvc inject

Options:
  -m, --message <text>   Message to send (else read from stdin)
      --attach <name>    Use an existing tmux session
      --no-launch        Don't launch claude if the session must be created
      --no-reply         Send only; don't wait for / print the reply
      --timeout <sec>    Max seconds to wait for the reply (default 90)
  -h, --help`;

export async function run(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      message: { type: "string", short: "m" },
      attach: { type: "string" },
      "no-launch": { type: "boolean", default: false },
      "no-reply": { type: "boolean", default: false },
      timeout: { type: "string" },
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

  if (values["no-reply"]) {
    bridge.inject(text);
    console.error(`Sent to ${bridge.target.session}.`);
    return 0;
  }

  const deadlineMs = values.timeout ? Number(values.timeout) * 1000 : undefined;
  process.stderr.write("· thinking…\n");
  const t0 = Date.now();
  const reply = await bridge.send(text, deadlineMs ? { deadlineMs } : {});
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  if (reply == null) {
    console.error(`No reply within ${secs}s.`);
    return 1;
  }
  process.stdout.write(reply.trim() + "\n");
  console.error(`· ${secs}s`);
  return 0;
}
