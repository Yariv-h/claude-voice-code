// Browser voice client: getUserMedia (AEC — the reason for WebRTC) → RTCPeer-
// Connection → WS signaling on /api/voice/signal → remote <audio> for TTS, with
// Web Audio analyser taps for the visualizer and a "thinking" earcon.

import { useCallback, useEffect, useRef, useState } from "react";

export type VoiceState = "off" | "idle" | "listening" | "thinking" | "speaking";
export type AnalyserRef = { current: AnalyserNode | null };

export interface TranscriptLine {
  role: "user" | "agent";
  text: string;
  partial?: boolean;
}

export interface VoiceSettings {
  stt?: "local" | "elevenlabs" | "off";
  tts?: "local" | "elevenlabs" | "off";
  kokoroSpeaker?: number;
  ttsVoiceId?: string;
  model?: string;
  thinking?: string;
  whisper?: string;
  restartSession?: boolean;
}

type ServerMsg =
  | { type: "answer"; sdp: RTCSessionDescriptionInit }
  | { type: "ice"; candidate: RTCIceCandidateInit }
  | { type: "state"; state: VoiceState }
  | { type: "transcript"; role: "user" | "agent"; text: string; partial?: boolean }
  | { type: "notice"; text: string }
  | { type: "error"; error: string };

function mergeTranscript(prev: TranscriptLine[], m: { role: "user" | "agent"; text: string; partial?: boolean }): TranscriptLine[] {
  const line: TranscriptLine = { role: m.role, text: m.text, partial: m.partial };
  const last = prev[prev.length - 1];
  if (last && last.role === m.role && last.partial) return [...prev.slice(0, -1), line];
  return [...prev, line];
}

export interface UseVoice {
  state: VoiceState;
  muted: boolean;
  transcript: TranscriptLine[];
  notice: string;
  start: (settings?: VoiceSettings) => Promise<void>;
  stop: () => void;
  reconnect: (settings?: VoiceSettings) => void;
  interrupt: () => void;
  setMicMuted: (m: boolean) => void;
  micAnalyser: AnalyserRef;
  ttsAnalyser: AnalyserRef;
}

export function useVoice(opts: { openMic?: boolean } = {}): UseVoice {
  const { openMic = true } = opts;
  const [state, setState] = useState<VoiceState>("off");
  const [muted, setMuted] = useState(!openMic);
  const [transcript, setTranscript] = useState<TranscriptLine[]>([]);
  const [notice, setNotice] = useState("");

  const pcRef = useRef<RTCPeerConnection | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioElRef = useRef<HTMLAudioElement | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const micAnalyser = useRef<AnalyserNode | null>(null);
  const ttsAnalyser = useRef<AnalyserNode | null>(null);
  const earconRef = useRef<{ stop: () => void } | null>(null);

  const makeAnalyser = (stream: MediaStream): AnalyserNode | null => {
    try {
      if (!ctxRef.current) {
        const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        ctxRef.current = new Ctx();
      }
      const ctx = ctxRef.current;
      void ctx.resume();
      const an = ctx.createAnalyser();
      an.fftSize = 256;
      an.smoothingTimeConstant = 0.8;
      ctx.createMediaStreamSource(stream).connect(an); // tap only
      return an;
    } catch {
      return null;
    }
  };

  const start = useCallback(async (settings: VoiceSettings = {}) => {
    if (pcRef.current) return;
    const signalingUrl = (location.protocol === "https:" ? "wss://" : "ws://") + location.host + "/api/voice/signal";

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    streamRef.current = stream;
    micAnalyser.current = makeAnalyser(stream);

    const pc = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });
    pcRef.current = pc;
    stream.getTracks().forEach((t) => pc.addTrack(t, stream));
    pc.ontrack = (ev) => {
      if (!audioElRef.current) {
        audioElRef.current = new Audio();
        audioElRef.current.autoplay = true;
      }
      audioElRef.current.srcObject = ev.streams[0];
      ttsAnalyser.current = makeAnalyser(ev.streams[0]);
    };

    const ws = new WebSocket(signalingUrl);
    wsRef.current = ws;
    const pendingIce: RTCIceCandidateInit[] = [];
    ws.onmessage = async (e) => {
      const msg = JSON.parse(e.data) as ServerMsg;
      if (msg.type === "answer") {
        await pc.setRemoteDescription(msg.sdp);
        for (const c of pendingIce) await pc.addIceCandidate(c).catch(() => {});
        pendingIce.length = 0;
      } else if (msg.type === "ice") {
        if (pc.remoteDescription) await pc.addIceCandidate(msg.candidate).catch(() => {});
        else pendingIce.push(msg.candidate);
      } else if (msg.type === "state") {
        setState(msg.state);
        setNotice("");
      } else if (msg.type === "transcript") {
        setTranscript((p) => mergeTranscript(p, msg));
      } else if (msg.type === "notice") {
        setNotice(msg.text);
      } else if (msg.type === "error") {
        setNotice("");
        console.error("[voice] server:", msg.error);
      }
    };
    ws.onclose = () => setState("off");
    ws.onerror = (err) => console.error("[voice] signaling socket", err);
    pc.onicecandidate = (e) => {
      if (e.candidate) ws.send(JSON.stringify({ type: "ice", candidate: e.candidate }));
    };

    await new Promise<void>((r) => (ws.onopen = () => r()));
    ws.send(JSON.stringify({ type: "hello", openMic, ...settings }));
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    ws.send(JSON.stringify({ type: "offer", sdp: offer }));
    setState("idle");
  }, [openMic]);

  const stop = useCallback(() => {
    wsRef.current?.close();
    wsRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (audioElRef.current) audioElRef.current.srcObject = null;
    setState("off");
  }, []);

  const reconnect = useCallback(
    (settings: VoiceSettings = {}) => {
      stop();
      window.setTimeout(() => void start(settings), 200);
    },
    [stop, start],
  );

  const setMicMuted = useCallback((m: boolean) => {
    streamRef.current?.getAudioTracks().forEach((t) => (t.enabled = !m));
    setMuted(m);
  }, []);

  const interrupt = useCallback(() => {
    wsRef.current?.send(JSON.stringify({ type: "stop" }));
  }, []);

  // Tie the mic-enable to a stable `connected` boolean, NOT `state` — keying on
  // state re-runs on every server update and re-mutes the mic mid-utterance.
  const connected = state !== "off";
  useEffect(() => {
    if (!connected || !streamRef.current) return;
    setMicMuted(!openMic);
  }, [openMic, connected, setMicMuted]);

  // "thinking" earcon (pure Web Audio).
  useEffect(() => {
    const ctx = ctxRef.current;
    if (!ctx) return;
    if (state === "thinking" && !earconRef.current) {
      const out = ctx.createGain();
      out.gain.value = 0;
      out.connect(ctx.destination);
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 700;
      lp.connect(out);
      const o1 = ctx.createOscillator();
      o1.type = "sine";
      o1.frequency.value = 196;
      o1.connect(lp);
      o1.start();
      const o2 = ctx.createOscillator();
      o2.type = "sine";
      o2.frequency.value = 294;
      o2.connect(lp);
      o2.start();
      const lfo = ctx.createOscillator();
      lfo.type = "sine";
      lfo.frequency.value = 1.5;
      const lg = ctx.createGain();
      lg.gain.value = 0.03;
      lfo.connect(lg);
      lg.connect(out.gain);
      lfo.start();
      earconRef.current = {
        stop: () => {
          try {
            [o1, o2, lfo].forEach((n) => n.stop());
            [out, lp, lg].forEach((n) => n.disconnect());
          } catch {
            /* ignore */
          }
        },
      };
    } else if (state !== "thinking" && earconRef.current) {
      earconRef.current.stop();
      earconRef.current = null;
    }
  }, [state]);

  useEffect(() => () => stop(), [stop]);

  return { state, muted, transcript, notice, start, stop, reconnect, interrupt, setMicMuted, micAnalyser, ttsAnalyser };
}
