import { test } from "node:test";
import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assistantTexts,
  awaitReply,
  captureBaseline,
  newestSessionFile,
  projectDirFor,
} from "./turnReader";

const tmp = () => mkdtempSync(join(tmpdir(), "cvc-tr-"));
const line = (o: unknown) => JSON.stringify(o) + "\n";
const asst = (content: unknown) => line({ type: "assistant", message: { role: "assistant", content } });

test("projectDirFor replaces / and . with -", () => {
  assert.ok(projectDirFor("/a/b/.claude/c.d").endsWith("/.claude/projects/-a-b--claude-c-d"));
});

test("assistantTexts: string + array content; skips noise and sidechains", () => {
  const dir = tmp();
  const f = join(dir, "s.jsonl");
  writeFileSync(
    f,
    line({ type: "user", message: { role: "user", content: "hi" } }) +
      asst("hello there") +
      line({ type: "system", message: { role: "system", content: "x" } }) +
      asst([{ type: "text", text: "part1 " }, { type: "tool_use" }, { type: "text", text: "part2" }]) +
      line({ type: "assistant", isSidechain: true, message: { role: "assistant", content: "subagent noise" } }) +
      "not json\n",
  );
  assert.deepEqual(assistantTexts(f), ["hello there", "part1 part2"]);
  rmSync(dir, { recursive: true, force: true });
});

test("newestSessionFile picks newest non-subagent jsonl", () => {
  const dir = tmp();
  const a = join(dir, "a.jsonl");
  const b = join(dir, "b.jsonl");
  const sub = join(dir, "x-subagent.jsonl");
  for (const f of [a, b, sub]) writeFileSync(f, "");
  utimesSync(a, new Date(1000), new Date(1000));
  utimesSync(b, new Date(2000), new Date(2000));
  utimesSync(sub, new Date(9000), new Date(9000)); // newest but excluded
  assert.equal(newestSessionFile(dir), b);
  rmSync(dir, { recursive: true, force: true });
});

test("awaitReply detects an appended assistant line (same file)", async () => {
  const dir = tmp();
  const f = join(dir, "s.jsonl");
  writeFileSync(f, asst("old"));
  const baseline = captureBaseline(dir);
  appendFileSync(f, asst("the new reply"));
  const r = await awaitReply(dir, baseline, { pollMs: 15, stableMs: 45, deadlineMs: 3000 });
  assert.equal(r, "the new reply");
  rmSync(dir, { recursive: true, force: true });
});

test("awaitReply detects a brand-new session file", async () => {
  const dir = tmp();
  const a = join(dir, "a.jsonl");
  writeFileSync(a, asst("prev convo"));
  utimesSync(a, new Date(1000), new Date(1000));
  const baseline = captureBaseline(dir);
  const b = join(dir, "b.jsonl");
  writeFileSync(b, asst("fresh answer"));
  utimesSync(b, new Date(5000), new Date(5000));
  const r = await awaitReply(dir, baseline, { pollMs: 15, stableMs: 45, deadlineMs: 3000 });
  assert.equal(r, "fresh answer");
  rmSync(dir, { recursive: true, force: true });
});

test("awaitReply returns null on timeout with no new content", async () => {
  const dir = tmp();
  writeFileSync(join(dir, "s.jsonl"), asst("old"));
  const baseline = captureBaseline(dir);
  const r = await awaitReply(dir, baseline, { pollMs: 15, stableMs: 45, deadlineMs: 120 });
  assert.equal(r, null);
  rmSync(dir, { recursive: true, force: true });
});
