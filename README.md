# claude-voice-code (`cvc`)

Talk to **Claude Code** by voice — naturally, two-way, with barge-in — from your
**terminal** or a **web UI**.

It bridges to a normal, already-authenticated `claude` running in a tmux session:
your speech is transcribed and injected into the session as if typed, and Claude's
reply is read from the session transcript and spoken back. Speech runs **offline**
(sherpa-onnx: Whisper STT + Kokoro TTS + Silero VAD) or via **ElevenLabs** —
switchable per side.

> 🚧 Under active construction. Run `cvc --help` to see what's wired up.

## Quickstart

```bash
npm install
npm run cvc -- setup     # install tmux, download offline models, write config
npm run cvc -- start     # open a Claude session and start talking (terminal)
# …or the web UI:
npm run cvc -- serve     # then open the printed URL in your browser
```

Once installed globally (`npm link` from the repo root, or `npm i -g .`), the
`cvc` command is available directly: `cvc start`, `cvc serve`, etc.

## Requirements

- macOS or Linux, **Node ≥ 20**
- **tmux** — installed for you by `cvc setup` (or `brew install tmux`)
- **sox** — mic capture & playback for the terminal client (`brew install sox`)
- A running, logged-in `claude` (Claude Code) — `cvc start` will launch one
- For cloud speech: an `ELEVENLABS_API_KEY`

## How it works

```
you ──speak──► STT (Whisper/Scribe) ──► inject into tmux `claude` (paste + Enter)
                                              │
                                              ▼
you ◄─hear─── TTS (Kokoro/ElevenLabs) ◄── read newest session JSONL reply
```

A turn-taking state machine (`idle → listening → thinking → speaking`) ties it
together, with barge-in: start talking while it speaks and it stops to listen.

The same core (speech providers + tmux bridge + gateway) powers both front-ends:

- **Terminal** (`cvc talk`): `sox` captures the mic, `play` speaks replies;
  push-to-talk by default (`--open-mic` for hands-free, best with headphones).
- **Web** (`cvc serve`): a browser client over WebRTC (for echo cancellation),
  with an audio-reactive orb.

## Configuration

Copy `cvc.config.example.jsonc` → `cvc.config.jsonc` and edit. Precedence:
**CLI flag > environment variable > config file > built-in default.**

## Project layout

```
packages/core    speech providers, tmux bridge, turn-taking gateway (shared)
packages/server  WebRTC transport + WS signaling + static host (web only)
apps/cli         the `cvc` terminal command + terminal voice client
apps/web         React + Vite browser UI (the Voice Console)
```

## License

MIT
