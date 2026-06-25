// Shape an agent reply for speech. Short replies are spoken verbatim (cleaned of
// markdown). Long replies are spoken in full by default; when reply.summarize is
// on, only a lead excerpt is spoken with a pointer to the on-screen transcript
// (length-gated so we never add latency for a one-liner).

import { stripMarkdown } from "./audio/markdown";
import type { ReplyConfig } from "./config";

export function condenseForSpeech(text: string, cfg: ReplyConfig): string {
  const clean = stripMarkdown(text);
  if (clean.length <= cfg.verbatimMaxChars || !cfg.summarize) return clean;

  const sentences = clean.match(/[^.!?]+[.!?]+/g) ?? [clean];
  let lead = "";
  for (const s of sentences) {
    if (lead && (lead + s).length > cfg.verbatimMaxChars) break;
    lead += s;
  }
  lead = lead.trim() || clean.slice(0, cfg.verbatimMaxChars).trim();
  return `${lead} — the full reply is on screen.`;
}
