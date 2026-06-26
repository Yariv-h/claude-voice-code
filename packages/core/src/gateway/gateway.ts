// The gateway wires STT → bridge → TTS through the turn-state machine. It owns
// barge-in (AbortControllers for the in-flight reply and TTS) and emits state +
// transcripts + audio to whatever front-end drives it (CLI or web server).

import type { ClaudeBridge } from "../bridge";
import type { Config } from "../config";
import type { SttProvider } from "../stt";
import type { TtsProvider } from "../tts";
import { condenseForSpeech } from "../summarize";
import type { VoiceState } from "../types";
import { reduce, type ActiveState, type GatewayEffect, type VoiceEvent } from "./turnState";

export interface GatewayDeps {
  stt: SttProvider;
  tts: TtsProvider | null;
  bridge: ClaudeBridge;
  config: Config;
  /** Prepended to each injected turn to set Claude's thinking level (e.g. "Think hard."). */
  thinkingPrefix?: string;
  /** State changes (idle/listening/thinking/speaking, and "off" after stop). */
  onState?(s: VoiceState): void;
  /** A finalized user utterance (for transcript UI). */
  onUserText?(text: string): void;
  /** The agent's reply text (full, for transcript UI). */
  onAgentText?(text: string): void;
  /** A chunk of TTS audio to play/transmit. */
  onAudio?(pcm: Int16Array, sampleRate: number): void;
  /** Barge-in: drop any queued/playing audio immediately. */
  onAudioFlush?(): void;
}

export interface Gateway {
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Manually interrupt the current turn (stop TTS / Escape the agent → idle). */
  interrupt(): void;
  /** Feed a mic frame (s16 mono at stt.inputRate). */
  feedAudio(frame: Int16Array): void;
  state(): VoiceState;
}

export function createGateway(deps: GatewayDeps): Gateway {
  let st: ActiveState = "idle";
  let on = false;
  let replyAbort: AbortController | null = null;
  let ttsAbort: AbortController | null = null;

  function dispatch(ev: VoiceEvent): void {
    if (!on) return;
    const prev = st;
    const tr = reduce(st, ev);
    st = tr.state;
    for (const eff of tr.effects) applyEffect(eff);
    if (st !== prev) deps.onState?.(st);
  }

  function applyEffect(eff: GatewayEffect): void {
    switch (eff.type) {
      case "inject":
        void runTurn(eff.text);
        break;
      case "say":
        void runSay(eff.text);
        break;
      case "cancelTts":
        ttsAbort?.abort();
        deps.onAudioFlush?.();
        break;
      case "interruptAgent":
        replyAbort?.abort();
        deps.bridge.interrupt();
        break;
    }
  }

  async function runTurn(text: string): Promise<void> {
    deps.onUserText?.(text); // show the raw words
    const injected = deps.thinkingPrefix ? `${deps.thinkingPrefix} ${text}` : text;
    const baseline = deps.bridge.captureBaseline();
    deps.bridge.inject(injected);
    replyAbort = new AbortController();
    const signal = replyAbort.signal;
    const reply = await deps.bridge.awaitReply(baseline, { signal, match: injected });
    if (signal.aborted) return; // user barged in
    dispatch({ type: "replyReady", text: reply ?? "" });
  }

  async function runSay(text: string): Promise<void> {
    const display = text.trim();
    if (display) deps.onAgentText?.(display);
    const speak = condenseForSpeech(text, deps.config.reply);
    if (!deps.tts || !speak) {
      dispatch({ type: "ttsDone" });
      return;
    }
    ttsAbort = new AbortController();
    const signal = ttsAbort.signal;
    const t0 = Date.now();
    let first = false;
    try {
      await deps.tts.synthesize(
        speak,
        (c) => {
          if (!first) {
            first = true;
            if (process.env.CVC_DEBUG_AUDIO) console.error(`[tts] first audio +${Date.now() - t0}ms (${speak.length} chars)`);
          }
          if (!signal.aborted) deps.onAudio?.(c.pcm, c.sampleRate);
        },
        signal,
      );
      if (process.env.CVC_DEBUG_AUDIO) console.error(`[tts] synth done +${Date.now() - t0}ms`);
    } catch {
      /* synthesis failed/aborted */
    }
    if (signal.aborted) return; // barge-in already moved the state + flushed
    dispatch({ type: "ttsDone" });
  }

  return {
    async start() {
      await deps.stt.start();
      deps.stt.onSpeechStart(() => dispatch({ type: "speechStart" }));
      deps.stt.onTranscript((tr) => {
        if (tr.final && tr.text.trim()) dispatch({ type: "finalTranscript", text: tr.text.trim() });
      });
      on = true;
      st = "idle";
      deps.onState?.("idle");
    },
    async stop() {
      on = false;
      replyAbort?.abort();
      ttsAbort?.abort();
      deps.onAudioFlush?.();
      await deps.stt.stop();
      deps.onState?.("off");
    },
    interrupt() {
      dispatch({ type: "stop" });
    },
    feedAudio(frame) {
      if (on) deps.stt.push(frame);
    },
    state() {
      return on ? st : "off";
    },
  };
}
