import { test } from "node:test";
import assert from "node:assert/strict";
import { cleanTranscript } from "./local";

test("noise-only transcripts become empty (dropped, never injected)", () => {
  for (const s of ["(buzzer)(buzzing)", "[BLANK_AUDIO]", "[ Silence ]", "♪ music ♪", ".", "   ", "(static)"]) {
    assert.equal(cleanTranscript(s), "");
  }
});

test("truncated Whisper noise tokens (no closing bracket) are dropped", () => {
  // Greedy decode on near-silent segments emits prefixes like these.
  for (const s of ["[BL", "[BLANK_AUD", "[BLANK_AUDIO", "(buzz", "[ Silence"]) {
    assert.equal(cleanTranscript(s), "");
  }
  // ...even when trailing a real sentence.
  assert.equal(cleanTranscript("Ship it [BLANK_AUD"), "Ship it");
});

test("real speech is kept; inline annotations are removed", () => {
  assert.equal(cleanTranscript("Hello there."), "Hello there.");
  assert.equal(cleanTranscript("I think (laughs) we should ship it"), "I think we should ship it");
  assert.equal(cleanTranscript("Add a [pause] dark mode toggle"), "Add a dark mode toggle");
});

test("non-English speech survives", () => {
  assert.equal(cleanTranscript("שלום עולם"), "שלום עולם");
});
