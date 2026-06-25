// Per-connection wiring: WebRTC transport ⇄ gateway. The browser speaks this
// vocabulary on /api/voice/signal —
//   client → {hello(+settings), offer, ice}   server → {answer, ice, state, transcript, error}
// state ∈ idle|listening|thinking|speaking (the client adds "off" on close).
// The gateway is built on `hello` so per-connection settings (engine, voice,
// Claude model) take effect; changing a setting = the client reconnects.

import type { WebSocket } from "ws";
import {
  bufferToInt16,
  createBridge,
  createGateway,
  createStt,
  createTts,
  downsample48to16,
  int16ToBuffer,
  killSession,
  resampleLinear,
  resolveSocket,
  rms16,
  type Config,
  type Gateway,
  type Side,
} from "@cvc/core";
import { WebRTCTransport } from "./transport";

interface Hello {
  type: "hello";
  openMic?: boolean;
  stt?: Side;
  tts?: Side;
  kokoroSpeaker?: number;
  ttsVoiceId?: string;
  model?: string;
  restartSession?: boolean;
}

const isSide = (v: unknown): v is Side => v === "local" || v === "elevenlabs" || v === "off";

/** Merge per-connection UI settings from the hello message onto the base config. */
function applyHello(base: Config, m: Hello): Config {
  const cfg: Config = {
    ...base,
    voice: { ...base.voice },
    elevenlabs: { ...base.elevenlabs },
    tmux: { ...base.tmux },
    models: { ...base.models },
  };
  if (isSide(m.stt)) cfg.stt = m.stt;
  if (isSide(m.tts)) cfg.tts = m.tts;
  if (typeof m.kokoroSpeaker === "number") cfg.voice.kokoroSpeaker = m.kokoroSpeaker;
  if (typeof m.ttsVoiceId === "string" && m.ttsVoiceId) cfg.elevenlabs.ttsVoiceId = m.ttsVoiceId;
  if (typeof m.model === "string" && m.model && m.model !== "default") {
    cfg.claudeBin = `${base.claudeBin} --model ${m.model}`;
  }
  return cfg;
}

export function handleConnection(ws: WebSocket, baseConfig: Config): void {
  const send = (m: Record<string, unknown>) => {
    try {
      ws.send(JSON.stringify(m));
    } catch {
      /* socket closed */
    }
  };

  const transport = new WebRTCTransport(send);
  let gateway: Gateway | null = null;
  let started = false;
  let dbg = 0;

  // Mic: 48 kHz PCM frames → 16 kHz → gateway/STT (dropped until the gateway exists).
  transport.onAudioFrame((pcm48) => {
    const i16 = bufferToInt16(pcm48);
    const d16 = downsample48to16(i16);
    if (process.env.CVC_DEBUG_AUDIO && dbg < 80) {
      dbg++;
      if (dbg % 10 === 0) {
        console.error(`[audio] f${dbg} in=${i16.length} rms48=${rms16(i16).toFixed(3)} → 16k=${d16.length} rms16=${rms16(d16).toFixed(3)}`);
      }
    }
    gateway?.feedAudio(d16);
  });
  transport.onClose(() => void gateway?.stop());

  ws.on("message", async (data) => {
    let msg: { type?: string; sdp?: { type: string; sdp: string }; candidate?: unknown } & Partial<Hello>;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    try {
      if (msg.type === "hello") {
        if (started) return;
        started = true;
        const cfg = applyHello(baseConfig, msg as Hello);
        if (msg.restartSession) {
          try {
            killSession(cfg.tmux.session, resolveSocket(cfg.tmux.socket));
          } catch {
            /* nothing to kill */
          }
        }
        const stt = createStt(cfg);
        if (!stt) throw new Error('stt is "off" — set it to local or elevenlabs to use voice.');
        const tts = createTts(cfg);
        const bridge = createBridge(cfg);
        gateway = createGateway({
          stt,
          tts,
          bridge,
          config: cfg,
          onState: (s) => send({ type: "state", state: s }),
          onUserText: (text) => {
            console.error(`[stt] "${text}"`);
            send({ type: "transcript", role: "user", text, final: true });
          },
          onAgentText: (text) => send({ type: "transcript", role: "agent", text }),
          onAudio: (pcm, rate) => {
            const at48 = rate === 48000 ? pcm : resampleLinear(pcm, rate, 48000);
            transport.sendAudio(int16ToBuffer(at48));
          },
          onAudioFlush: () => transport.clearAudio(),
        });
        await gateway.start();
      } else if (msg.type === "offer" && msg.sdp) {
        send({ type: "answer", sdp: await transport.handleOffer(msg.sdp) });
      } else if (msg.type === "ice" && msg.candidate) {
        await transport.addIceCandidate(msg.candidate);
      }
    } catch (e) {
      send({ type: "error", error: (e as Error).message });
    }
  });

  ws.on("close", () => {
    transport.close();
    void gateway?.stop();
  });
}
