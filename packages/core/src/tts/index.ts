// TTS provider factory: pick the engine from config behind one interface.

import type { Config } from "../config";
import { LocalTts } from "./local";
import type { TtsProvider } from "./types";

export * from "./types";
export { LocalTts } from "./local";

/** Build the configured TTS provider, or null if tts is "off". */
export function createTts(config: Config): TtsProvider | null {
  switch (config.tts) {
    case "off":
      return null;
    case "local":
      return new LocalTts(config);
    case "elevenlabs":
      throw new Error("ElevenLabs TTS is added in the next build step.");
    default:
      throw new Error(`unknown tts engine: ${config.tts}`);
  }
}
