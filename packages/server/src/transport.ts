// Self-hosted WebRTC media plane (werift). Inbound mic Opus → 48 kHz PCM; a 20 ms
// pacer drains queued TTS PCM → Opus → RTP (sending silence when idle to keep the
// browser's jitter buffer warm). The Opus payload type is pinned to 96 so the
// outbound RtpHeader matches the negotiated codec.

import {
  MediaStreamTrack,
  RTCPeerConnection,
  RTCRtpCodecParameters,
  RtpHeader,
  RtpPacket,
} from "werift";
import { OPUS_FRAME_BYTES, OPUS_FRAME_SAMPLES, OpusCodec } from "./codec";

const OPUS_PT = 96;
const SILENCE_FRAME = Buffer.alloc(OPUS_FRAME_BYTES);

export type SignalSink = (msg: Record<string, unknown>) => void;

export class WebRTCTransport {
  private pc: RTCPeerConnection;
  private codec = new OpusCodec();
  private outTrack = new MediaStreamTrack({ kind: "audio" });
  private audioCbs: ((pcm: Buffer) => void)[] = [];
  private closeCbs: (() => void)[] = [];
  private pcmQueue = Buffer.alloc(0);
  private pacer: ReturnType<typeof setInterval> | null = null;
  private seq = 0;
  private ts = 0;
  private ssrc = (Math.floor(Math.random() * 0xffffffff) >>> 0) || 1;

  constructor(private signal: SignalSink) {
    this.pc = new RTCPeerConnection({
      codecs: {
        audio: [
          new RTCRtpCodecParameters({
            mimeType: "audio/opus",
            clockRate: 48000,
            channels: 2,
            payloadType: OPUS_PT,
          }),
        ],
      },
    });
    this.pc.addTransceiver(this.outTrack, { direction: "sendrecv" });

    this.pc.onIceCandidate.subscribe((c) => {
      if (c) this.signal({ type: "ice", candidate: c });
    });
    this.pc.onTrack.subscribe((track) => {
      track.onReceiveRtp.subscribe((rtp) => {
        try {
          const pcm = this.codec.decode(rtp.payload as Buffer);
          for (const cb of this.audioCbs) cb(pcm);
        } catch {
          /* skip undecodable frame */
        }
      });
    });
    this.pc.connectionStateChange.subscribe((state) => {
      if (state === "connected") this.startPacer();
      else if (state === "failed" || state === "closed") {
        this.stopPacer();
        for (const cb of this.closeCbs) cb();
      }
    });
  }

  async handleOffer(sdp: { type: string; sdp: string }): Promise<{ type: string; sdp: string }> {
    type SD = Parameters<RTCPeerConnection["setRemoteDescription"]>[0];
    await this.pc.setRemoteDescription(sdp as SD);
    await this.pc.setLocalDescription(await this.pc.createAnswer());
    const local = this.pc.localDescription!;
    return { type: local.type, sdp: local.sdp };
  }

  async addIceCandidate(candidate: unknown): Promise<void> {
    type IC = Parameters<RTCPeerConnection["addIceCandidate"]>[0];
    try {
      await this.pc.addIceCandidate(candidate as IC);
    } catch {
      /* ignore */
    }
  }

  onAudioFrame(cb: (pcm: Buffer) => void): void {
    this.audioCbs.push(cb);
  }
  onClose(cb: () => void): void {
    this.closeCbs.push(cb);
  }

  /** Queue 48 kHz mono s16 PCM for playback to the browser. */
  sendAudio(pcm: Buffer): void {
    this.pcmQueue = Buffer.concat([this.pcmQueue, pcm]);
  }
  /** Barge-in: drop everything queued. */
  clearAudio(): void {
    this.pcmQueue = Buffer.alloc(0);
  }

  private startPacer(): void {
    if (this.pacer) return;
    this.pacer = setInterval(() => {
      let frame: Buffer;
      if (this.pcmQueue.length >= OPUS_FRAME_BYTES) {
        frame = this.pcmQueue.subarray(0, OPUS_FRAME_BYTES);
        this.pcmQueue = this.pcmQueue.subarray(OPUS_FRAME_BYTES);
      } else if (this.pcmQueue.length > 0) {
        frame = Buffer.concat([this.pcmQueue, Buffer.alloc(OPUS_FRAME_BYTES - this.pcmQueue.length)]);
        this.pcmQueue = Buffer.alloc(0);
      } else {
        frame = SILENCE_FRAME; // keep the track warm
      }
      let opus: Buffer;
      try {
        opus = this.codec.encodeFrame(frame);
      } catch {
        return;
      }
      if (!opus.length) return;
      this.seq = (this.seq + 1) & 0xffff;
      this.ts = (this.ts + OPUS_FRAME_SAMPLES) >>> 0;
      const header = new RtpHeader({
        version: 2,
        payloadType: OPUS_PT,
        sequenceNumber: this.seq,
        timestamp: this.ts,
        ssrc: this.ssrc,
        marker: false,
      });
      try {
        this.outTrack.writeRtp(new RtpPacket(header, opus));
      } catch {
        /* track gone */
      }
    }, 20);
  }

  private stopPacer(): void {
    if (this.pacer) {
      clearInterval(this.pacer);
      this.pacer = null;
    }
  }

  close(): void {
    this.stopPacer();
    try {
      void this.pc.close();
    } catch {
      /* ignore */
    }
    this.codec.destroy();
  }
}
