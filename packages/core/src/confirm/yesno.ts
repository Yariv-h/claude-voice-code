// Classify a spoken answer as yes / no / unclear. NO is checked before YES so
// "no, don't do that" doesn't match the "do" in YES patterns.

export type YesNo = "yes" | "no" | "unclear";

export function classifyYesNo(text: string): YesNo {
  const t = text.toLowerCase();
  if (/\b(no|nope|nah|don'?t|do not|stop|cancel|deny|decline|negative|never)\b/.test(t)) return "no";
  if (/\b(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|allow|confirm|approve|affirmative|proceed|please do)\b/.test(t)) {
    return "yes";
  }
  return "unclear";
}
