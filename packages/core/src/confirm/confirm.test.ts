import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ConfirmBridge } from "./bridge";
import { classifyYesNo } from "./yesno";

function ask(socketPath: string, msg: unknown): Promise<string> {
  return new Promise((resolve, reject) => {
    const c = net.createConnection(socketPath);
    let out = "";
    c.setEncoding("utf8");
    c.on("connect", () => c.end(JSON.stringify(msg))); // half-close after sending
    c.on("data", (d) => (out += d));
    c.on("end", () => resolve(out));
    c.on("error", reject);
  });
}

test("ConfirmBridge returns the ask() decision over the socket", async () => {
  const sock = join(mkdtempSync(join(tmpdir(), "cvc-cb-")), "c.sock");
  const bridge = new ConfirmBridge(sock, async (reason) => (reason.includes("rm ") ? "deny" : "allow"));
  await bridge.start();
  assert.equal(await ask(sock, { reason: "edit a file" }), "allow");
  assert.equal(await ask(sock, { reason: "rm -rf /tmp" }), "deny");
  bridge.stop();
});

test("ConfirmBridge fails closed when ask() throws", async () => {
  const sock = join(mkdtempSync(join(tmpdir(), "cvc-cb-")), "c.sock");
  const bridge = new ConfirmBridge(sock, async () => {
    throw new Error("boom");
  });
  await bridge.start();
  assert.equal(await ask(sock, { reason: "anything" }), "deny");
  bridge.stop();
});

test("classifyYesNo: NO wins over YES; unclear is unclear", () => {
  assert.equal(classifyYesNo("yes, go ahead"), "yes");
  assert.equal(classifyYesNo("sure do it"), "yes");
  assert.equal(classifyYesNo("no"), "no");
  assert.equal(classifyYesNo("no, don't do it"), "no");
  assert.equal(classifyYesNo("hmm, maybe later"), "unclear");
});
