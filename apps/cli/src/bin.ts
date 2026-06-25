// cvc — command-line entry point. Parses the subcommand and dispatches.

const VERSION = "0.1.0";

const HELP = `cvc — talk to Claude Code by voice

Usage: cvc <command> [options]

Commands:
  setup            Install tmux, download speech models, write config
  start            Ensure a Claude tmux session, then start the voice loop
  talk             Terminal voice loop (push-to-talk; --open-mic for hands-free)
  serve            Start the web UI server (browser, WebRTC)
  inject           Text smoke test: read stdin, send to Claude, print the reply
  say              Speak text via the configured TTS engine (TTS smoke test)
  doctor           Check tmux/sox/models/api-key/mic and report problems
  download-models  Download offline speech models into the models dir

Options:
  -h, --help       Show this help
  -v, --version    Show version

Run "cvc <command> --help" for command-specific options.`;

type CommandModule = { run: (argv: string[]) => Promise<number> };

const IMPLEMENTED: Record<string, () => Promise<CommandModule>> = {
  start: () => import("./commands/start"),
  inject: () => import("./commands/inject"),
  say: () => import("./commands/say"),
};

const PLANNED = new Set(["setup", "talk", "serve", "doctor", "download-models"]);

async function main(argv: string[]): Promise<number> {
  const cmd = argv[0];

  if (!cmd || cmd === "-h" || cmd === "--help" || cmd === "help") {
    console.log(HELP);
    return 0;
  }
  if (cmd === "-v" || cmd === "--version") {
    console.log(VERSION);
    return 0;
  }

  const loader = IMPLEMENTED[cmd];
  if (loader) {
    const mod = await loader();
    return mod.run(argv.slice(1));
  }

  if (PLANNED.has(cmd)) {
    console.error(`🚧  "${cmd}" is not implemented yet — coming soon.`);
    return 1;
  }

  console.error(`Unknown command: ${cmd}\n`);
  console.log(HELP);
  return 2;
}

main(process.argv.slice(2))
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
