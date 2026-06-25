// Raw-mode keyboard for the terminal voice loop. TTYs have no key-up event, so
// SPACE toggles the mic (start/stop) rather than literal hold-to-talk.

export interface KeyHandlers {
  onToggle?: () => void; // SPACE / Enter
  onQuit?: () => void; // Ctrl-C / q
  onKey?: (key: string) => void;
}

const CTRL_C = String.fromCharCode(3);

export function startKeys(h: KeyHandlers): () => void {
  const stdin = process.stdin;
  const wasRaw = stdin.isTTY ? stdin.isRaw : false;
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdin.setEncoding("utf8");

  const onData = (key: string) => {
    if (key === CTRL_C || key === "q") return h.onQuit?.();
    if (key === " " || key === "\r" || key === "\n") return h.onToggle?.();
    h.onKey?.(key);
  };
  stdin.on("data", onData);

  return () => {
    stdin.off("data", onData);
    if (stdin.isTTY) stdin.setRawMode(wasRaw);
    stdin.pause();
  };
}
