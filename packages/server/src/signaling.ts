// Per-connection wiring: WebRTC transport ⇄ gateway. The browser speaks this
// vocabulary on /api/voice/signal —
//   client → {hello, offer, ice}    server → {answer, ice, state, transcript, error}
// state ∈ idle|listening|thinking|speaking (the client adds "off" on close).

import type { WebSocket } from "ws";
import {
  bufferToInt16,
  createBridge,
  createGateway,
  createStt,
  createTts,
  downsample48to16,
  int16ToBuffer,
  resampleLinear,
  rms16,
  type Config,
  type Gateway,
} from "@cvc/core";
import { WebRTCTransport } from "./transport";

export function handleConnection(ws: WebSocket, config: Config): void {
  const send = (m: Record<string, unknown>) => {
    try {
      ws.send(JSON.stringify(m));
    } catch {
      /* socket closed */
    }
  };

  const transport = new WebRTCTransport(send);
  let gateway: Gateway | null = null;

  try {
    const stt = createStt(config);
    if (!stt) throw new Error('stt is "off" — set it to local or elevenlabs to use voice.');
    const tts = createTts(config);
    const bridge = createBridge(config);
    gateway = createGateway({
      stt,
      tts,
      bridge,
      config,
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
  } catch (e) {
    send({ type: "error", error: (e as Error).message });
    transport.close();
    try {
      ws.close();
    } catch {
      /* ignore */
    }
    return;
  }

  // Mic: 48 kHz PCM frames → 16 kHz → gateway/STT.
  let dbg = 0;
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
    let msg: { type?: string; sdp?: { type: string; sdp: string }; candidate?: unknown };
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return;
    }
    try {
      if (msg.type === "hello") {
        await gateway?.start();
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
