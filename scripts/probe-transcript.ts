// Dev utility: validate the JSONL turn reader against a real ~/.claude transcript.
//   node --import tsx scripts/probe-transcript.ts <cwd-of-a-past-claude-session>
import { assistantTexts, newestSessionFile, projectDirFor } from "@cvc/core";

const cwd = process.argv[2] ?? process.cwd();
const dir = projectDirFor(cwd);
const file = newestSessionFile(dir);
console.log("cwd        :", cwd);
console.log("projectDir :", dir);
console.log("newest     :", file ?? "(none)");
if (file) {
  const texts = assistantTexts(file);
  console.log("assistant messages:", texts.length);
  const last = texts.at(-1) ?? "";
  console.log("last reply (≤200): " + JSON.stringify(last.slice(0, 200)));
}
