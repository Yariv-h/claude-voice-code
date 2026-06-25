import { test } from "node:test";
import assert from "node:assert/strict";
import { parseJsonc } from "./jsonc";

test("strips line and block comments", () => {
  const text = `{
    // a line comment
    "a": 1, /* inline */ "b": 2
    /* multi
       line */
  }`;
  assert.deepEqual(parseJsonc(text), { a: 1, b: 2 });
});

test("removes trailing commas in objects and arrays", () => {
  assert.deepEqual(parseJsonc(`{"a":[1,2,3,],"b":{"c":1,},}`), { a: [1, 2, 3], b: { c: 1 } });
});

test("preserves // and commas inside strings", () => {
  const v = parseJsonc<{ url: string; weird: string }>(`{"url":"http://x/y","weird":"a, ]"}`);
  assert.equal(v.url, "http://x/y");
  assert.equal(v.weird, "a, ]");
});

test("handles escaped quotes in strings", () => {
  assert.deepEqual(parseJsonc(`{"q":"he said \\"hi\\" // not a comment"}`), {
    q: 'he said "hi" // not a comment',
  });
});
