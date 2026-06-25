# claude-voice-code (`cvc`)

Talk to **Claude Code** by voice — naturally, two-way, with barge-in — from your
**terminal** or a **web UI**.

`cvc` bridges to a normal, already-authenticated `claude` running in a tmux
session. Your speech is transcribed and injected into the session as if typed,
and Claude's reply is read straight from the session transcript and spoken back.
A turn-taking state machine (`idle → listening → thinking → speaking`) ties it
together, with **barge-in**: start talking while it speaks and it stops to listen.

Speech runs **offline** (sherpa-onnx: Whisper STT + Kokoro TTS + Silero VAD) or
via **ElevenLabs** — switchable per side.

```
you ──speak──▶ STT (Whisper / Scribe) ──▶ inject into tmux `claude` (paste + Enter)
                                                  │
                                                  ▼
you ◀─hear──── TTS (Kokoro / ElevenLabs) ◀── read newest session JSONL reply
```

## Quickstart

```bash
npm install
npm run cvc -- setup          # install tmux, download offline models, write config
npm run cvc -- doctor         # verify your environment

# Terminal voice:
npm run cvc -- start          # open a Claude session and start talking

# Web UI:
npm run web:build
npm run cvc -- serve          # then open the printed URL
```

Install the `cvc` command globally with `npm i -g .` (or `npm link`) from the repo
root, then use `cvc setup`, `cvc start`, `cvc serve`, … directly.

## Requirements

- macOS or Linux, **Node ≥ 20** (developed on 24)
- **tmux** — installed for you by `cvc setup` (or `brew install tmux`)
- **sox** — mic capture & playback for the terminal client (`brew install sox`)
- A logged-in **`claude`** (Claude Code) on your `PATH` — `cvc start` launches one
- For cloud speech: an **`ELEVENLABS_API_KEY`**

## Commands

| Command | What it does |
|---|---|
| `cvc setup` | Install tmux, download offline models, write `cvc.config.jsonc` |
| `cvc doctor [--mic]` | Check node/tmux/claude/sox/models/api-key (and mic with `--mic`) |
| `cvc start [--attach <s>]` | Ensure a Claude tmux session (launch claude), then talk |
| `cvc talk [--open-mic]` | Terminal voice loop (push-to-talk; `--open-mic` for hands-free) |
| `cvc serve [--port N]` | Start the web UI server (browser, WebRTC) |
| `cvc say -m "…" [--out f.wav]` | Speak text via the configured TTS (smoke test) |
| `cvc inject -m "…"` | Send text to Claude and print the reply (no audio) |
| `cvc download-models [--only …] [--hifi]` | Fetch offline speech models |

**Terminal push-to-talk:** press `SPACE` to open the mic, speak, then pause — your
turn is sent automatically; `SPACE` again mutes; `Ctrl-C` quits. `--open-mic` keeps
the mic live (use headphones — the terminal has no echo cancellation).

**Web UI:** click the mic to connect, then just talk (the browser provides echo
cancellation, so barge-in works on speakers). Pick from 7 themes and 4
audio-reactive visualizers in the bottom dock.

## How it works

- **The bridge.** Inject a turn with `tmux load-buffer → paste-buffer → send-keys
  Enter`. Read the reply by polling the JSONL Claude writes to
  `~/.claude/projects/<cwd>/` (the cwd with every `/` and `.` turned into `-`).
  We watch the newest non-subagent `*.jsonl` and treat the last assistant message
  as final once it's been stable for ~1.5 s. Barge-in sends `Escape`.
- **STT.** Local: Silero VAD endpoints an utterance, then offline Whisper base.en
  transcribes the whole thing (more accurate than streaming). Cloud: a light
  energy gate + ElevenLabs `/speech-to-text` (Scribe).
- **TTS.** Local: Kokoro (24 kHz, sentence-streamed). Cloud: ElevenLabs HTTP
  streaming (24 kHz). Audio is mono s16 throughout; resampling lives in one place.
- **Transport.** The web client uses **WebRTC** (werift + Opus) purely so the
  browser gives us **acoustic echo cancellation** — without it, the agent's TTS
  feeds back into the mic. A 20 ms pacer streams TTS out and keeps the track warm.
- **Gateway.** A pure turn-state reducer (`packages/core/src/gateway/turnState.ts`)
  decides transitions + effects (inject / say / cancelTTS / interruptAgent); the
  gateway runs them, cancelling the in-flight reply and TTS on barge-in.

## Configuration

Copy `cvc.config.example.jsonc` → `cvc.config.jsonc` and edit (`cvc setup` does this
for you). Precedence: **CLI flag > env var > config file > built-in default.**

| Key | Env | Default | Notes |
|---|---|---|---|
| `stt` / `tts` | `CVC_STT` / `CVC_TTS` | `local` | `local` \| `elevenlabs` \| `off` |
| `elevenlabs.apiKey` | `ELEVENLABS_API_KEY` | — | required for cloud engines |
| `models.dir` | `CVC_MODELS_DIR` | `~/.cache/claude-voice-code/models` | offline models |
| `claudeBin` | `CLAUDE_BIN` | `claude` | binary `cvc start` launches |
| `tmux.session` | `CVC_TMUX_SESSION` | `claude-voice` | managed session name |
| `tmux.cwd` | `CVC_CLAUDE_CWD` | current dir | Claude's working dir |
| `tmux.attach` | `CVC_TMUX_ATTACH` | — | bind an existing session instead |
| `reply.summarize` | — | `false` | speak a short excerpt of long replies |
| `server.port` / `server.host` | `CVC_PORT` / `CVC_HOST` | `5173` / `127.0.0.1` | |

## Project layout

```
packages/core    speech providers, the tmux bridge, the turn-taking gateway (shared)
packages/server  WebRTC transport + WS signaling + static host (web only)
apps/cli         the `cvc` terminal command + terminal voice client
apps/web         React + Vite browser UI (the Voice Console)
design/          the Voice Console design reference (themes/visualizers)
```

## Development

```bash
npm run typecheck                 # tsc across core/server/cli (tsx runs everything)
npm test                          # unit tests (node:test)
CVC_AUDIO_TESTS=1 npm test        # + local TTS→STT round-trip (needs models)
CVC_RTC_TESTS=1 npm test          # + real-WebRTC transport loopback
npm run web:build                 # build the web UI into apps/web/dist
```

There's no compile step for running — the CLI and server run TypeScript directly
via `tsx`; `tsc` is used purely for type-checking.

## Troubleshooting

- **No transcript / silent mic (terminal):** grant your terminal app Microphone
  permission in System Settings → Privacy. `cvc doctor --mic` records 0.6 s and
  reports the input level.
- **`tmux` not found:** `cvc setup` or `brew install tmux`. On non-default sockets,
  set `tmux.socket` / `CVC_TMUX_SOCKET`.
- **`cvc serve` shows "not built":** run `npm run web:build` once.
- **`npm audit`** reports a few highs from `werift`'s WebRTC transitive deps; they
  only affect the local web server you run yourself.

## Roadmap

- Spoken confirmation for dangerous tool calls (a PreToolUse hook → a Unix-socket
  bridge that asks "about to X — confirm?" and waits for a spoken yes/no).
- True LLM-based summarization of long replies (currently a length-gated excerpt).
- Per-voice selection UI and a usage meter for cloud engines.

## License

MIT
