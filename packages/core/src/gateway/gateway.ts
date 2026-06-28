// The gateway wires STT → bridge → TTS through the turn-state machine. It streams
// the reply (speaking each sentence as it lands), owns barge-in (a per-turn
// AbortController that stops the reader + TTS), and runs the spoken tool-confirm
// flow (Guard mode).

import { stripMarkdown } from "../audio/markdown";
import type { ClaudeBridge } from "../bridge";
import type { Config } from "../config";
import { classifyYesNo, type ConfirmDecision } from "../confirm";
import type { SttProvider } from "../stt";
import type { TtsProvider } from "../tts";
import type { VoiceState } from "../types";
import { reduce, type ActiveState, type GatewayEffect, type VoiceEvent } from "./turnState";

export interface GatewayDeps {
  stt: SttProvider;
  tts: TtsProvider | null;
  bridge: ClaudeBridge;
  config: Config;
  /** Prepended to each injected turn (thinking level / concise instruction). */
  thinkingPrefix?: string;
  /** State changes (idle/listening/thinking/speaking, and "off" after stop). */
  onState?(s: VoiceState): void;
  /** A finalized user utterance (for transcript UI). */
  onUserText?(text: string): void;
  /** Agent reply text; partial=true while it's still streaming. */
  onAgentText?(text: string, partial?: boolean): void;
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
  /** Speak a tool-use confirmation prompt and await a spoken yes/no (fail-closed). */
  confirm(reason: string): Promise<ConfirmDecision>;
  /** Feed a mic frame (s16 mono at stt.inputRate). */
  feedAudio(frame: Int16Array): void;
  state(): VoiceState;
}

export function createGateway(deps: GatewayDeps): Gateway {
  let st: ActiveState = "idle";
  let on = false;
  let turnAbort: AbortController | null = null;
  let confirmAnswer: ((text: string) => void) | null = null;

  // ── TTS queue: synthesize queued reply chunks in order, streaming audio out.
  // Each chunk carries its turn's signal so barge-in only cancels that turn. ──
  const ttsQueue: { text: string; signal: AbortSignal }[] = [];
  let draining = false;
  let drainWaiters: (() => void)[] = [];

  async function drainLoop(): Promise<void> {
    draining = true;
    while (ttsQueue.length) {
      const item = ttsQueue.shift();
      if (!item || item.signal.aborted) continue;
      const speak = stripMarkdown(item.text);
      if (!deps.tts || !speak) continue;
      try {
        await deps.tts.synthesize(
          speak,
          (c) => {
            if (!item.signal.aborted) deps.onAudio?.(c.pcm, c.sampleRate);
          },
          item.signal,
        );
      } catch {
        /* aborted/failed */
      }
    }
    draining = false;
    const waiters = drainWaiters;
    drainWaiters = [];
    for (const w of waiters) w();
  }
  function enqueueSpeak(text: string, signal: AbortSignal): void {
    ttsQueue.push({ text, signal });
    if (!draining) void drainLoop();
  }
  function clearQueue(): void {
    ttsQueue.length = 0;
  }
  function waitDrain(signal: AbortSignal): Promise<void> {
    if (!draining && ttsQueue.length === 0) return Promise.resolve();
    return new Promise((resolve) => {
      if (signal.aborted) return resolve();
      drainWaiters.push(resolve);
      signal.addEventListener("abort", () => resolve(), { once: true });
    });
  }

  function setState(s: ActiveState): void {
    if (s === st) return;
    st = s;
    deps.onState?.(s);
  }

  function dispatch(ev: VoiceEvent): void {
    if (!on) return;
    const tr = reduce(st, ev);
    setState(tr.state);
    for (const eff of tr.effects) applyEffect(eff);
  }

  function applyEffect(eff: GatewayEffect): void {
    switch (eff.type) {
      case "inject":
        void runTurn(eff.text);
        break;
      case "cancelTts":
        turnAbort?.abort();
        clearQueue();
        deps.onAudioFlush?.();
        break;
      case "interruptAgent":
        turnAbort?.abort();
        clearQueue();
        deps.onAudioFlush?.();
        deps.bridge.interrupt();
        break;
      case "say":
        break; // speech is driven by the streaming reader, not this effect
    }
  }

  async function runTurn(text: string): Promise<void> {
    deps.onUserText?.(text); // show the raw words
    const injected = deps.thinkingPrefix ? `${deps.thinkingPrefix} ${text}` : text;
    deps.bridge.inject(injected);
    turnAbort = new AbortController();
    const sig = turnAbort.signal;
    let started = false;
    let fullSoFar = "";
    const full = await deps.bridge.streamReply({
      match: injected,
      signal: sig,
      onText: (chunk, soFar) => {
        if (sig.aborted) return;
        fullSoFar = soFar;
        if (!started) {
          started = true;
          setState("speaking"); // first sentence → start speaking
        }
        deps.onAgentText?.(soFar, true);
        enqueueSpeak(chunk, sig);
      },
    });
    if (sig.aborted) return;
    const reply = (full || fullSoFar).trim();
    if (reply) deps.onAgentText?.(reply, false);
    await waitDrain(sig);
    if (sig.aborted) return;
    setState("idle");
  }

  // ── spoken tool-use confirmation (Guard mode) ──
  const CONFIRM_TIMEOUT_MS = 30_000;
  async function speakConfirm(text: string): Promise<void> {
    if (!deps.tts) return;
    const ac = new AbortController();
    try {
      await deps.tts.synthesize(text, (c) => deps.onAudio?.(c.pcm, c.sampleRate), ac.signal);
    } catch {
      /* ignore */
    }
  }
  function confirm(reason: string): Promise<ConfirmDecision> {
    if (!on) return Promise.resolve("deny");
    return new Promise((resolve) => {
      let settled = false;
      const done = (d: ConfirmDecision) => {
        if (settled) return;
        settled = true;
        confirmAnswer = null;
        clearTimeout(timer);
        resolve(d);
      };
      const timer = setTimeout(() => done("deny"), CONFIRM_TIMEOUT_MS); // fail-closed
      confirmAnswer = (answer) => {
        const yn = classifyYesNo(answer);
        if (yn === "yes") done("allow");
        else if (yn === "no") done("deny");
        else void speakConfirm("Sorry — please say yes, or no.");
      };
      void speakConfirm(`Heads up — Claude wants to ${reason}. Say yes to allow, or no to deny.`);
    });
  }

  return {
    async start() {
      await deps.stt.start();
      deps.stt.onSpeechStart(() => dispatch({ type: "speechStart" }));
      deps.stt.onTranscript((tr) => {
        if (!tr.final || !tr.text.trim()) return;
        const text = tr.text.trim();
        // While a tool-confirmation is pending, the next utterance is the answer.
        if (confirmAnswer) {
          confirmAnswer(text);
          return;
        }
        dispatch({ type: "finalTranscript", text });
      });
      on = true;
      st = "idle";
      deps.onState?.("idle");
    },
    async stop() {
      on = false;
      turnAbort?.abort();
      clearQueue();
      deps.onAudioFlush?.();
      await deps.stt.stop();
      deps.onState?.("off");
    },
    interrupt() {
      dispatch({ type: "stop" });
    },
    confirm,
    feedAudio(frame) {
      if (on) deps.stt.push(frame);
    },
    state() {
      return on ? st : "off";
    },
  };
}
