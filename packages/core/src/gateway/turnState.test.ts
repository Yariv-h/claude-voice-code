import { test } from "node:test";
import assert from "node:assert/strict";
import { reduce, type ActiveState } from "./turnState";

test("idle: speech → listening; final → thinking + inject", () => {
  assert.equal(reduce("idle", { type: "speechStart" }).state, "listening");
  const r = reduce("idle", { type: "finalTranscript", text: "hi" });
  assert.equal(r.state, "thinking");
  assert.deepEqual(r.effects, [{ type: "inject", text: "hi" }]);
});

test("listening: final transcript → thinking + inject", () => {
  const r = reduce("listening", { type: "finalTranscript", text: "do it" });
  assert.equal(r.state, "thinking");
  assert.deepEqual(r.effects, [{ type: "inject", text: "do it" }]);
});

test("thinking: replyReady → speaking + say", () => {
  const r = reduce("thinking", { type: "replyReady", text: "done" });
  assert.equal(r.state, "speaking");
  assert.deepEqual(r.effects, [{ type: "say", text: "done" }]);
});

test("thinking: mid-think utterance is ignored (no double-send)", () => {
  const r = reduce("thinking", { type: "finalTranscript", text: "wait" });
  assert.equal(r.state, "thinking");
  assert.deepEqual(r.effects, []);
});

test("barge-in: speechStart while thinking → listening + interruptAgent", () => {
  const r = reduce("thinking", { type: "speechStart" });
  assert.equal(r.state, "listening");
  assert.equal(r.bargeIn, true);
  assert.deepEqual(r.effects, [{ type: "interruptAgent" }]);
});

test("barge-in: speechStart while speaking → listening + cancelTts", () => {
  const r = reduce("speaking", { type: "speechStart" });
  assert.equal(r.state, "listening");
  assert.equal(r.bargeIn, true);
  assert.deepEqual(r.effects, [{ type: "cancelTts" }]);
});

test("barge-in: full utterance while speaking → thinking + cancelTts + inject", () => {
  const r = reduce("speaking", { type: "finalTranscript", text: "actually no" });
  assert.equal(r.state, "thinking");
  assert.equal(r.bargeIn, true);
  assert.deepEqual(r.effects, [{ type: "cancelTts" }, { type: "inject", text: "actually no" }]);
});

test("speaking: ttsDone → idle", () => {
  assert.equal(reduce("speaking", { type: "ttsDone" }).state, "idle");
});

test("stale replyReady after barge-in is dropped (not in thinking)", () => {
  for (const s of ["idle", "listening", "speaking"] as ActiveState[]) {
    const r = reduce(s, { type: "replyReady", text: "late" });
    assert.equal(r.state, s);
    assert.deepEqual(r.effects, []);
  }
});

test("stop interrupts: thinking → idle + interruptAgent; speaking → idle + cancelTts", () => {
  const a = reduce("thinking", { type: "stop" });
  assert.equal(a.state, "idle");
  assert.deepEqual(a.effects, [{ type: "interruptAgent" }]);
  const b = reduce("speaking", { type: "stop" });
  assert.equal(b.state, "idle");
  assert.deepEqual(b.effects, [{ type: "cancelTts" }]);
  assert.equal(reduce("idle", { type: "stop" }).state, "idle");
});

test("ttsDone outside speaking is a no-op", () => {
  for (const s of ["idle", "listening", "thinking"] as ActiveState[]) {
    assert.equal(reduce(s, { type: "ttsDone" }).state, s);
  }
});
