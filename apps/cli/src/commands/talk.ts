// `cvc talk` — terminal voice loop. Speak → transcribe → inject → hear the reply.
// Push-to-talk by default (SPACE toggles the mic); --open-mic for hands-free.
// (Step 8 refactors the turn handling onto the shared gateway state machine.)

import { parseArgs } from "node:util";
import {
  createBridge,
  createStt,
  createTts,
  loadConfig,
  stripMarkdown,
  type ClaudeBridge,
  type SttProvider,
  type TtsProvider,
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

Push-to-talk (default): press SPACE to start the mic, speak, pause — your turn is
sent automatically. Press SPACE again to mute. Ctrl-C to quit.`;

const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

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

  await stt.start();

  const openMic = values["open-mic"];
  let busy = false; // handling a turn (thinking / speaking)
  let micOn = openMic;
  let cap: Capture | null = null;
  let player: Player | null = null;

  const stopPlayback = () => {
    player?.kill();
    player = null;
  };

  function startCap() {
    if (cap) return;
    cap = startCapture({
      rate: stt!.inputRate,
      onFrame: (f) => {
        // PTT: ignore the mic while a turn is in flight (avoids TTS feedback on
        // speakers). Open-mic: keep feeding so barge-in can fire.
        if (!busy || openMic) stt!.push(f);
      },
      onError: (e) => console.error("mic:", e.message),
    });
  }
  function stopCap() {
    cap?.stop();
    cap = null;
    stt!.flush();
  }

  async function handleTurn(text: string) {
    if (busy) return;
    busy = true;
    process.stdout.write(`\n${dim("you:")} ${text}\n${dim("· thinking…")}\n`);
    const reply = await bridge.send(text);
    if (reply) {
      process.stdout.write(`\x1b[1mclaude:\x1b[0m ${reply}\n`);
      if (tts) {
        player = createPlayer(tts.sampleRate);
        try {
          await tts.synthesize(stripMarkdown(reply), (c) => player?.write(c.pcm));
          await player?.end();
        } finally {
          player = null;
        }
      }
    } else {
      process.stdout.write(dim("(no reply)\n"));
    }
    busy = false;
    prompt();
  }

  stt.onTranscript((t) => {
    if (t.final && t.text.trim()) void handleTurn(t.text.trim());
  });
  stt.onSpeechStart(() => {
    if (busy && player) stopPlayback(); // barge-in: stop talking and listen
  });

  function prompt() {
    process.stdout.write(
      dim(openMic ? "[open-mic] speak any time · Ctrl-C to quit\n" : "[push-to-talk] SPACE to talk/mute · Ctrl-C to quit\n"),
    );
  }

  console.log(`Voice ready — session ${bridge.target.session} · stt=${config.stt} tts=${config.tts}`);
  if (openMic) {
    console.log("\x1b[33m⚠ open-mic: use headphones (no echo cancellation in the terminal)\x1b[0m");
    startCap();
  }
  prompt();

  let stopKeys: () => void = () => {};
  let finish: () => void = () => {};
  const done = new Promise<void>((r) => (finish = r));
  const cleanup = () => {
    stopPlayback();
    stopCap();
    void stt!.stop();
    stopKeys();
    finish();
  };

  stopKeys = startKeys({
    onToggle: () => {
      if (openMic || busy) return;
      micOn = !micOn;
      if (micOn) {
        startCap();
        process.stdout.write(dim("… listening — speak, then pause (or SPACE to mute)\n"));
      } else {
        stopCap();
        process.stdout.write(dim("… muted\n"));
      }
    },
    onQuit: cleanup,
  });
  process.once("SIGINT", cleanup);

  await done;
  return 0;
}
