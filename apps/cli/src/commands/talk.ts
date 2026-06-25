// `cvc talk` — terminal voice loop, driven by the shared gateway state machine.
// Push-to-talk by default (SPACE toggles the mic); --open-mic for hands-free.

import { parseArgs } from "node:util";
import {
  createBridge,
  createGateway,
  createStt,
  createTts,
  loadConfig,
  type ClaudeBridge,
  type SttProvider,
  type TtsProvider,
  type VoiceState,
} from "@cvc/core";
import { startCapture, type Capture } from "../audio/capture";
import { createPlayer, type Player } from "../audio/playback";
import { startKeys } from "../ptt";

const HELP = `cvc talk — terminal voice loop

Usage: cvc talk [--open-mic] [--attach <name>]

Options:
      --open-mic       Keep the mic always-on (hands-free). Use headphones —
                       the terminal has no echo cancellation.
      --attach <name>  Bind an existing tmux session
  -h, --help

Push-to-talk (default): SPACE starts the mic; speak, then pause — your turn is
sent automatically. SPACE again to mute. Speak while it talks to barge in.
Ctrl-C to quit.`;

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;
const STATUS: Record<VoiceState, string> = {
  off: "off",
  idle: "ready",
  listening: "listening…",
  thinking: "thinking…",
  speaking: "speaking…",
};

export async function run(argv: string[]): Promise<number> {
  const { values } = parseArgs({
    args: argv,
    options: {
      "open-mic": { type: "boolean", default: false },
      attach: { type: "string" },
      help: { type: "boolean", short: "h", default: false },
    },
    allowPositionals: true,
  });
  if (values.help) {
    console.log(HELP);
    return 0;
  }

  const { config } = loadConfig({});
  let stt: SttProvider | null = null;
  let tts: TtsProvider | null = null;
  try {
    stt = createStt(config);
    tts = createTts(config);
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }
  if (!stt) {
    console.error('stt is "off" — set stt to "local" or "elevenlabs".');
    return 1;
  }

  let bridge!: ClaudeBridge;
  try {
    bridge = createBridge(config, { attach: values.attach });
  } catch (e) {
    console.error((e as Error).message);
    return 1;
  }

  const openMic = values["open-mic"];
  let player: Player | null = null;
  let cap: Capture | null = null;
  let micOn = openMic;
  let ready = false;

  const gateway = createGateway({
    stt,
    tts,
    bridge,
    config,
    onState: (s) => {
      if (ready) process.stdout.write(dim(`· ${STATUS[s]}`) + "\n");
      if (s !== "speaking" && player) {
        void player.end();
        player = null;
      }
    },
    onUserText: (text) => process.stdout.write(`\n\x1b[36myou:\x1b[0m ${text}\n`),
    onAgentText: (text) => process.stdout.write(`\x1b[1mclaude:\x1b[0m ${text}\n`),
    onAudio: (pcm, rate) => {
      if (!player) player = createPlayer(rate);
      player.write(pcm);
    },
    onAudioFlush: () => {
      player?.kill();
      player = null;
    },
  });

  function startCap() {
    if (cap) return;
    cap = startCapture({
      rate: stt!.inputRate,
      onFrame: (f) => {
        const s = gateway.state();
        // Open-mic feeds always (for barge-in); PTT only while idle/listening
        // so the agent's own speech can't trip the mic on speakers.
        if (openMic || s === "idle" || s === "listening") gateway.feedAudio(f);
      },
      onError: (e) => console.error("mic:", e.message),
    });
  }
  function stopCap() {
    cap?.stop();
    cap = null;
  }

  await gateway.start();
  ready = true;

  console.log(`Voice ready — session ${bridge.target.session} · stt=${config.stt} tts=${config.tts}`);
  if (openMic) {
    console.log("\x1b[33m⚠ open-mic: use headphones (no echo cancellation in the terminal)\x1b[0m");
    startCap();
  } else {
    console.log(dim("[push-to-talk] SPACE to talk/mute · Ctrl-C to quit"));
  }

  let stopKeys: () => void = () => {};
  let finish: () => void = () => {};
  const done = new Promise<void>((r) => (finish = r));
  const cleanup = () => {
    stopKeys();
    stopCap();
    player?.kill();
    void gateway.stop();
    finish();
  };

  stopKeys = startKeys({
    onToggle: () => {
      if (openMic) return;
      micOn = !micOn;
      if (micOn) {
        startCap();
        process.stdout.write(dim("… mic on — speak, then pause\n"));
      } else {
        stopCap();
        process.stdout.write(dim("… mic off\n"));
      }
    },
    onQuit: cleanup,
  });
  process.once("SIGINT", cleanup);

  await done;
  return 0;
}
