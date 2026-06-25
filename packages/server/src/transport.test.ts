// Real WebRTC integration: a raw werift peer (the "browser") negotiates with our
// WebRTCTransport, sends mic Opus, and receives the paced TTS. Gated behind
// CVC_RTC_TESTS=1 (spins up DTLS/ICE; noisy + ~2s).
//   CVC_RTC_TESTS=1 npm test

import { test } from "node:test";
import assert from "node:assert/strict";
import { MediaStreamTrack, RTCPeerConnection, RTCRtpCodecParameters, RtpHeader, RtpPacket } from "werift";
import { WebRTCTransport } from "./transport";

const RUN = process.env.CVC_RTC_TESTS === "1";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("transport carries mic in and TTS out over a real peer", { skip: !RUN }, async () => {
  const codecs = {
    audio: [new RTCRtpCodecParameters({ mimeType: "audio/opus", clockRate: 48000, channels: 2, payloadType: 96 })],
  };
  const client = new RTCPeerConnection({ codecs });
  const clientTrack = new MediaStreamTrack({ kind: "audio" });
  client.addTransceiver(clientTrack, { direction: "sendrecv" });

  const transport = new WebRTCTransport((msg) => {
    if (msg.type === "ice" && msg.candidate) void client.addIceCandidate(msg.candidate as never);
  });
  let micFrames = 0;
  let clientRtp = 0;
  transport.onAudioFrame(() => micFrames++);
  client.onTrack.subscribe((t) => t.onReceiveRtp.subscribe(() => clientRtp++));
  client.onIceCandidate.subscribe((c) => c && transport.addIceCandidate(c));

  await client.setLocalDescription(await client.createOffer());
  const answer = await transport.handleOffer(client.localDescription!);
  await client.setRemoteDescription(answer as never);

  await new Promise<void>((res) => {
    const i = setInterval(() => {
      if (client.connectionState === "connected") {
        clearInterval(i);
        res();
      }
    }, 50);
    setTimeout(() => {
      clearInterval(i);
      res();
    }, 8000);
  });
  assert.equal(client.connectionState, "connected");

  const OpusScript = (await import("opusscript")).default;
  const enc = new OpusScript(48000, 1, OpusScript.Application.AUDIO);
  let seq = 0;
  let ts = 0;
  for (let i = 0; i < 25; i++) {
    const pcm = Buffer.alloc(1920);
    for (let j = 0; j < 960; j++) pcm.writeInt16LE((Math.sin(j / 6) * 9000) | 0, j * 2);
    const h = new RtpHeader({ version: 2, payloadType: 96, sequenceNumber: seq++ & 0xffff, timestamp: (ts += 960) >>> 0, ssrc: 99 });
    clientTrack.writeRtp(new RtpPacket(h, enc.encode(pcm, 960)));
    await wait(20);
  }

  const tts = Buffer.alloc(1920 * 10);
  for (let k = 0; k < tts.length / 2; k++) tts.writeInt16LE((Math.sin(k / 7) * 9000) | 0, k * 2);
  transport.sendAudio(tts);
  await wait(500);

  assert.ok(micFrames > 0, `server received mic frames (got ${micFrames})`);
  assert.ok(clientRtp > 0, `client received TTS rtp (got ${clientRtp})`);
  transport.close();
  client.close();
});
