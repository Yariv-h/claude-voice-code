// TTS provider factory: pick the engine from config behind one interface.

import type { Config } from "../config";
import { ElevenLabsTts } from "./elevenlabs";
import { LocalTts } from "./local";
import type { TtsProvider } from "./types";

export * from "./types";
export { LocalTts } from "./local";
export { ElevenLabsTts } from "./elevenlabs";

/** Build the configured TTS provider, or null if tts is "off". */
export function createTts(config: Config): TtsProvider | null {
  switch (config.tts) {
    case "off":
      return null;
    case "local":
      return new LocalTts(config);
    case "elevenlabs":
      return new ElevenLabsTts(config);
    default:
      throw new Error(`unknown tts engine: ${config.tts}`);
  }
}
