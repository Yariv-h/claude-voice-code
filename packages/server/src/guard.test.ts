// Exercises the PreToolUse hook script end-to-end with a stub confirm command
// (prints VOICE-set STUB). The socket↔client path is covered by core's
// confirm.test.ts; here we verify the hook's classifier + decision emission.

import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const hook = fileURLToPath(new URL("../scripts/voice-guard-hook.mjs", import.meta.url));
const stub = join(mkdtempSync(join(tmpdir(), "cvc-guard-")), "stub.mjs");
writeFileSync(stub, "process.stdout.write(process.env.STUB||'deny');\n");

function runHook(input: object, opts: { stub?: string; enabled?: string } = {}) {
  const r = spawnSync("node", [hook], {
    input: JSON.stringify(input),
    encoding: "utf8",
    env: {
      ...process.env,
      VOICE_GUARD_ENABLED: opts.enabled ?? "1",
      VOICE_GUARD_CONFIRM_CMD: stub,
      STUB: opts.stub ?? "deny",
    },
  });
  return { code: r.status, out: (r.stdout || "").trim() };
}

test("safe tool → allow silently (no decision)", () => {
  const r = runHook({ tool_name: "Bash", tool_input: { command: "ls -la" } }, { stub: "deny" });
  assert.equal(r.code, 0);
  assert.equal(r.out, "");
});

test("dangerous + confirm allow → exit 0 silently", () => {
  const r = runHook({ tool_name: "Bash", tool_input: { command: "rm -rf /tmp/x" } }, { stub: "allow" });
  assert.equal(r.code, 0);
  assert.equal(r.out, "");
});

test("dangerous (rm) + confirm deny → emits deny decision", () => {
  const r = runHook({ tool_name: "Bash", tool_input: { command: "rm -rf /tmp/x" } }, { stub: "deny" });
  assert.match(r.out, /"permissionDecision":"deny"/);
});

test("git push is gated", () => {
  const r = runHook({ tool_name: "Bash", tool_input: { command: "git push origin main" } }, { stub: "deny" });
  assert.match(r.out, /"permissionDecision":"deny"/);
});

test("any mcp__ tool is treated as dangerous (asks)", () => {
  const r = runHook({ tool_name: "mcp__claude_ai_Gmail__send_message", tool_input: {} }, { stub: "deny" });
  assert.match(r.out, /"permissionDecision":"deny"/);
});

test("disabled → inert (allows even dangerous)", () => {
  const r = runHook({ tool_name: "Bash", tool_input: { command: "rm -rf /tmp/x" } }, { enabled: "0", stub: "deny" });
  assert.equal(r.code, 0);
  assert.equal(r.out, "");
});
