// Minimal, string-aware JSONC parser: strips // and /* */ comments and trailing
// commas without corrupting string contents, then JSON.parse. Two single passes
// (both string-aware) avoid the classic "regex matched inside a string" bug.

function stripComments(src: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (inStr) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i++;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === "/" && next === "/") {
      while (i < src.length && src[i] !== "\n") i++;
      out += "\n";
      continue;
    }
    if (c === "/" && next === "*") {
      i += 2;
      while (i < src.length && !(src[i] === "*" && src[i + 1] === "/")) i++;
      i++; // skip '*'; the for-loop's i++ skips '/'
      continue;
    }
    out += c;
  }
  return out;
}

function stripTrailingCommas(src: string): string {
  let out = "";
  let inStr = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const next = src[i + 1];
    if (inStr) {
      out += c;
      if (c === "\\") {
        out += next ?? "";
        i++;
      } else if (c === '"') {
        inStr = false;
      }
      continue;
    }
    if (c === '"') {
      inStr = true;
      out += c;
      continue;
    }
    if (c === ",") {
      let j = i + 1;
      while (j < src.length && /\s/.test(src[j])) j++;
      if (src[j] === "}" || src[j] === "]") continue; // drop trailing comma
    }
    out += c;
  }
  return out;
}

/** Parse JSON-with-comments-and-trailing-commas into a value. */
export function parseJsonc<T = unknown>(text: string): T {
  return JSON.parse(stripTrailingCommas(stripComments(text))) as T;
}
