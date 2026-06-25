// `cvc start` — ensure a Claude tmux session exists (and, in a later step, drop
// into the voice loop).

import { parseArgs } from "node:util";
import { createBridge, loadConfig } from "@cvc/core";

const HELP = `cvc start — ensure a Claude tmux session

Usage: cvc start [--attach <name>] [--no-launch]

Options:
      --attach <name>   Bind an existing tmux session instead of creating one
      --no-launch       Create the session but don't launch claude
  -h, --help`;

export async function run(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      attach: { type: "string" },
      "no-launch": { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }

  const { config } = loadConfig({});
  let bridge;
  try {
    bridge = createBridge(config, { attach: values.attach, launch: !values["no-launch"] });
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }

  const { session, socket, cwd } = bridge.target;
  console.log(`tmux session : ${session}${socket ? ` (socket ${socket})` : ""}`);
  console.log(`working dir  : ${cwd}`);
  if (bridge.attached) console.log("status       : attached to existing session");
  else if (bridge.created)
    console.log(`status       : created${values["no-launch"] ? "" : ` + launched ${config.claudeBin}`}`);
  else console.log("status       : reused existing session");

  console.log(`\nWatch it live: tmux ${socket ? `-S ${socket} ` : ""}attach -t ${session}`);
  console.log("Voice loop (cvc talk) arrives in a later build step.");
  return 0;
}
