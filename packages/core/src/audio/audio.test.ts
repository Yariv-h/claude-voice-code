import { test } from "node:test";
import assert from "node:assert/strict";
import { downsample48to16, upsample24to48, upsampleInt } from "./resample";
import { bufferToInt16, float32ToInt16, int16ToBuffer, int16ToFloat32, rms16 } from "./pcm";
import { stripMarkdown } from "./markdown";

test("downsample48to16 group-averages every 3 samples", () => {
  const out = downsample48to16(Int16Array.from([0, 3, 6, 9, 12, 15]));
  assert.deepEqual([...out], [3, 12]);
});

test("upsample24to48 doubles length with interpolated midpoints", () => {
  const out = upsample24to48(Int16Array.from([100, 200]));
  assert.deepEqual([...out], [100, 150, 200, 200]);
});

test("upsampleInt ×3 interpolates linearly", () => {
  const out = upsampleInt(Int16Array.from([0, 30]), 3);
  assert.deepEqual([...out], [0, 10, 20, 30, 30, 30]);
});

test("int16 <-> buffer round-trips", () => {
  const src = Int16Array.from([0, 1, -1, 32767, -32768, 1234]);
  assert.deepEqual([...bufferToInt16(int16ToBuffer(src))], [...src]);
});

test("int16 <-> float32 round-trips within 1 LSB", () => {
  const src = Int16Array.from([0, 16384, -16384, 32767, -32768]);
  const back = float32ToInt16(int16ToFloat32(src));
  for (let i = 0; i < src.length; i++) assert.ok(Math.abs(back[i] - src[i]) <= 1);
});

test("rms16 is 0 for silence and positive for signal", () => {
  assert.equal(rms16(new Int16Array(10)), 0);
  assert.ok(rms16(Int16Array.from([16384, -16384, 16384])) > 0.4);
});

test("stripMarkdown cleans common markup", () => {
  assert.equal(
    stripMarkdown("**bold** and `code` and [link](http://x)"),
    "bold and code and link",
  );
  assert.equal(stripMarkdown("# Title\n\nA para."), "Title. A para.");
  assert.equal(stripMarkdown("```js\nx=1\n```\nDone"), "Done");
});
