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
  streamReply,
} from "./turnReader";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

test("awaitReply with match reads OUR session file, not the newest one", async () => {
  const dir = tmp();
  // Another Claude session sharing the dir — NEWER, with its own reply.
  const other = join(dir, "other.jsonl");
  writeFileSync(
    other,
    line({ type: "user", message: { role: "user", content: "unrelated dev message" } }) +
      asst("a dev-session reply that must be ignored"),
  );
  utimesSync(other, new Date(9000), new Date(9000));
  // Our session — OLDER, contains the message we injected + the real reply.
  const ours = join(dir, "ours.jsonl");
  writeFileSync(
    ours,
    line({ type: "user", message: { role: "user", content: "add a dark mode toggle" } }) +
      asst("Done — added the toggle."),
  );
  utimesSync(ours, new Date(1000), new Date(1000));
  const baseline = captureBaseline(dir); // newest = other
  const r = await awaitReply(dir, baseline, {
    match: "add a dark mode toggle",
    pollMs: 15,
    stableMs: 45,
    deadlineMs: 2000,
  });
  assert.equal(r, "Done — added the toggle.");
  rmSync(dir, { recursive: true, force: true });
});

test("streamReply emits whole sentences as they appear, flushes tail on idle", async () => {
  const dir = tmp();
  const f = join(dir, "s.jsonl");
  const userLine = line({ type: "user", message: { role: "user", content: "do the thing" } });
  writeFileSync(f, userLine);
  const grow = (txt: string) => writeFileSync(f, userLine + asst(txt));

  const chunks: string[] = [];
  const p = streamReply(dir, {
    match: "do the thing",
    pollMs: 15,
    idleMs: 120,
    deadlineMs: 4000,
    onText: (c) => chunks.push(c),
  });
  await sleep(45);
  grow("First sentence here.");
  await sleep(50);
  grow("First sentence here. Second one too!");
  await sleep(50);
  grow("First sentence here. Second one too! Trailing part");
  const full = await p;

  assert.equal(chunks[0], "First sentence here.");
  assert.ok(chunks.includes("Second one too!"), `chunks: ${JSON.stringify(chunks)}`);
  assert.ok(chunks.some((c) => c.includes("Trailing part")), "tail flushed on idle");
  assert.match(full, /Trailing part$/);
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
