import { test } from "node:test";
import assert from "node:assert/strict";
import { splitForStreaming } from "./local";

test("short reply stays a single chunk", () => {
  assert.deepEqual(splitForStreaming("Sure, done."), ["Sure, done."]);
});

test("first chunk is small and no chunk exceeds the cap (comma-less sentence)", () => {
  const long =
    "I will now go ahead and read the entire file and then report the overall structure back to you in detail";
  const chunks = splitForStreaming(long);
  assert.ok(chunks.length > 1, "a long comma-less sentence is split, not one giant chunk");
  assert.ok(chunks[0].length <= 64, `first chunk stays tiny: "${chunks[0]}"`);
  for (const c of chunks) assert.ok(c.length <= 160, `chunk within cap: "${c}"`);
  assert.equal(chunks.join(" "), long, "no words dropped or reordered");
});

test("clause breaks are preferred; first chunk small, rest larger", () => {
  const chunks = splitForStreaming(
    "First a quick note, then the details, and finally a longer closing thought that runs on for a while to fill it out.",
  );
  assert.ok(chunks[0].length <= 64, `first chunk small: "${chunks[0]}"`);
  for (const c of chunks) assert.ok(c.length <= 160);
});
