import { test } from "node:test";
import assert from "node:assert/strict";
import { condenseForSpeech } from "./summarize";

const cfg = (summarize: boolean) => ({ verbatimMaxChars: 40, summarize });

test("short replies are spoken verbatim (markdown stripped)", () => {
  assert.equal(condenseForSpeech("**Done.** Added the toggle.", cfg(true)), "Done. Added the toggle.");
});

test("long reply with summarize off is spoken in full", () => {
  const long = "First sentence here. Second sentence is also quite long indeed. Third one too.";
  assert.equal(condenseForSpeech(long, cfg(false)), long);
});

test("long reply with summarize on is condensed + pointer", () => {
  const long = "First sentence here. Second sentence is also quite long indeed. Third one too.";
  const out = condenseForSpeech(long, cfg(true));
  assert.match(out, /on screen\.$/);
  assert.ok(out.startsWith("First sentence here."));
  assert.ok(out.length < long.length + 30);
});
