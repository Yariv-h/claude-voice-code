#!/usr/bin/env node
// Bridges the PreToolUse hook to the cvc voice confirm socket. Point
// VOICE_GUARD_CONFIRM_CMD at this file. Usage: node …client.mjs "<reason>"
// (the hook's JSON payload is passed on stdin). Prints "allow"/"deny". Fail-closed.

import net from "node:net";
import { readFileSync } from "node:fs";

const reason = process.argv[2] || "(unknown)";
const socketPath = process.env.VOICE_GUARD_CONFIRM_SOCKET || "";
let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {
  /* no/invalid stdin */
}

function fail() {
  process.stdout.write("deny");
  process.exit(0);
}
if (!socketPath) fail();

const conn = net.createConnection(socketPath);
let out = "";
const timer = setTimeout(() => {
  try {
    conn.destroy();
  } catch {
    /* ignore */
  }
  fail();
}, Number(process.env.VOICE_GUARD_CONFIRM_TIMEOUT_MS || 120000));

conn.setEncoding("utf8");
conn.on("connect", () => conn.end(JSON.stringify({ reason, payload }))); // half-close after send
conn.on("data", (d) => (out += d));
conn.on("end", () => {
  clearTimeout(timer);
  process.stdout.write(/allow/i.test(out) ? "allow" : "deny");
  process.exit(0);
});
conn.on("error", () => {
  clearTimeout(timer);
  fail();
});
