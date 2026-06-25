// STT provider factory: pick the engine from config behind one interface.

import type { Config } from "../config";
import { LocalStt } from "./local";
import type { SttProvider } from "./types";

export * from "./types";
export { LocalStt } from "./local";

/** Build the configured STT provider, or null if stt is "off". */
export function createStt(config: Config): SttProvider | null {
  switch (config.stt) {
    case "off":
      return null;
    case "local":
      return new LocalStt(config);
    case "elevenlabs":
      throw new Error("ElevenLabs STT is added in a later build step.");
    default:
      throw new Error(`unknown stt engine: ${config.stt}`);
  }
}
