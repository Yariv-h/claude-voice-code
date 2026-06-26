// Strip Whisper's non-lexical sound annotations. When fed silence or noise,
// Whisper emits sound-event tags instead of words — "[BLANK_AUDIO]", "(static)",
// "(buzzing)", "[ Silence ]", music notes — always fully enclosed in brackets,
// parentheses, or ♪. These are not speech and must never reach the agent, so we
// remove every enclosed group; if nothing lexical remains, the caller drops the
// segment. Real speech transcripts are unaffected (Whisper does not parenthesize
// actual words).

export function cleanTranscript(text: string): string {
  return text
    .replace(/\[[^\]]*\]/g, " ") // [BLANK_AUDIO], [ Silence ], [INAUDIBLE]
    .replace(/\([^)]*\)/g, " ") // (static), (buzzing), (wind blowing)
    .replace(/[♪♫*]+/g, " ") // music / emphasis markers
    .replace(/\s+/g, " ")
    .trim();
}
