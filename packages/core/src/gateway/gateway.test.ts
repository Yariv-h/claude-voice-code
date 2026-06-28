import { test } from "node:test";
import assert from "node:assert/strict";
import type { ClaudeBridge } from "../bridge";
import type { Config } from "../config";
import type { SttProvider } from "../stt";
import type { TtsProvider } from "../tts";
import type { Transcript } from "../types";
import { createGateway } from "./gateway";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

class MockStt implements SttProvider {
  readonly inputRate = 16000;
  private tcb: ((t: Transcript) => void)[] = [];
  private scb: (() => void)[] = [];
  async start() {}
  push() {}
  flush() {}
  async stop() {}
  onTranscript(cb: (t: Transcript) => void) {
    this.tcb.push(cb);
  }
  onSpeechStart(cb: () => void) {
    this.scb.push(cb);
  }
  emitFinal(text: string) {
    for (const cb of this.tcb) cb({ text, final: true });
  }
  emitSpeechStart() {
    for (const cb of this.scb) cb();
  }
}

class MockTts implements TtsProvider {
  readonly sampleRate = 24000;
  calls: string[] = [];
  async synthesize(text: string, onChunk: (c: { pcm: Int16Array; sampleRate: number }) => void, signal?: AbortSignal) {
    this.calls.push(text);
    await sleep(2);
    if (!signal?.aborted) onChunk({ pcm: new Int16Array(8), sampleRate: 24000 });
  }
}

function mockBridge(streamReply: ClaudeBridge["streamReply"], log: { injected: string[]; interrupts: number }) {
  return {
    inject: (t: string) => log.injected.push(t),
    interrupt: () => {
      log.interrupts++;
    },
    streamReply,
  } as unknown as ClaudeBridge;
}

test("gateway streams a reply: user→thinking→speaking→idle, two sentences spoken", async () => {
  const stt = new MockStt();
  const tts = new MockTts();
  const log = { injected: [] as string[], interrupts: 0 };
  const states: string[] = [];
  const agentFinal: string[] = [];
  let audio = 0;
  const bridge = mockBridge(async (o) => {
    o.onText("Hello there.", "Hello there.");
    o.onText("How are you?", "Hello there. How are you?");
    return "Hello there. How are you?";
  }, log);

  const gw = createGateway({
    stt,
    tts,
    bridge,
    config: {} as Config,
    onState: (s) => states.push(s),
    onAgentText: (t, partial) => {
      if (!partial) agentFinal.push(t);
    },
    onAudio: () => audio++,
  });
  await gw.start();
  stt.emitFinal("say hi");
  await sleep(60);

  assert.equal(log.injected[0], "say hi");
  assert.ok(states.includes("thinking"), `states: ${states}`);
  assert.ok(states.includes("speaking"), `states: ${states}`);
  assert.equal(gw.state(), "idle");
  assert.deepEqual(tts.calls, ["Hello there.", "How are you?"]);
  assert.ok(audio >= 2);
  assert.equal(agentFinal.at(-1), "Hello there. How are you?");
  await gw.stop();
});

test("barge-in: speechStart while speaking → listening + agent interrupted + audio flushed", async () => {
  const stt = new MockStt();
  const tts = new MockTts();
  const log = { injected: [] as string[], interrupts: 0 };
  let flushed = 0;
  // streamReply that keeps the turn 'speaking' long enough to barge in.
  const bridge = mockBridge(async (o) => {
    o.onText("A long reply.", "A long reply.");
    await sleep(200);
    return "A long reply.";
  }, log);
  const gw = createGateway({ stt, tts, bridge, config: {} as Config, onAudioFlush: () => flushed++ });
  await gw.start();
  stt.emitFinal("do something");
  await sleep(30); // now speaking
  assert.equal(gw.state(), "speaking");
  stt.emitSpeechStart(); // barge in
  await sleep(10);
  assert.equal(gw.state(), "listening");
  assert.ok(flushed >= 1, "audio flushed on barge-in");
  await gw.stop();
});
