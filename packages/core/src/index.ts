// @cvc/core — engine-agnostic brains: speech providers, the Claude tmux bridge,
// and the turn-taking gateway. This is the package's public surface.

export const VERSION = "0.1.0";

export * from "./types";
export * from "./config";
export * from "./audio/pcm";
export * from "./audio/resample";
export * from "./audio/markdown";
export * from "./audio/wav";
export * from "./bridge";
export * from "./tts";
export * from "./stt";
export * from "./gateway";
export { parseJsonc } from "./util/jsonc";
