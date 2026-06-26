// STT provider factory: pick the engine from config behind one interface.

import type { Config } from "../config";
import { ElevenLabsStt } from "./elevenlabs";
import { LocalStt } from "./local";
import type { SttProvider } from "./types";

export * from "./types";
export { LocalStt, whisperEncoderPath } from "./local";
export { ElevenLabsStt } from "./elevenlabs";

/** Build the configured STT provider, or null if stt is "off". */
export function createStt(config: Config): SttProvider | null {
  switch (config.stt) {
    case "off":
      return null;
    case "local":
      return new LocalStt(config);
    case "elevenlabs":
      return new ElevenLabsStt(config);
    default:
      throw new Error(`unknown stt engine: ${config.stt}`);
  }
}
