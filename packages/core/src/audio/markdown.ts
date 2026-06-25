// Turn a Markdown reply into clean prose for TTS: drop code, keep link text,
// strip emphasis/list/heading markers, collapse whitespace.

export function stripMarkdown(md: string): string {
  let t = md.replace(/\r/g, "");
  t = t.replace(/```[\s\S]*?```/g, " "); // fenced code blocks
  t = t.replace(/`([^`]+)`/g, "$1"); // inline code
  t = t.replace(/!\[[^\]]*\]\([^)]*\)/g, " "); // images
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, "$1"); // links → text
  t = t.replace(/^\s{0,3}#{1,6}\s+/gm, ""); // headings
  t = t.replace(/^\s{0,3}>\s?/gm, ""); // blockquotes
  t = t.replace(/^\s*[-*+]\s+/gm, ""); // bullet lists
  t = t.replace(/^\s*\d+\.\s+/gm, ""); // numbered lists
  t = t.replace(/(\*\*|__)(.*?)\1/g, "$2"); // bold
  t = t.replace(/(\*|_)(.*?)\1/g, "$2"); // italic
  t = t.replace(/~~(.*?)~~/g, "$2"); // strikethrough
  t = t.replace(/\n{2,}/g, ". "); // paragraph break → sentence pause
  t = t.replace(/\n/g, " ");
  t = t.replace(/\s{2,}/g, " ");
  return t.trim();
}
