// Shared primitives used across providers, the bridge, and the gateway.

/** Which engine powers a speech side. */
export type Side = "local" | "elevenlabs" | "off";

/** Turn-taking states. The web client adds "off" locally when disconnected. */
export type VoiceState = "off" | "idle" | "listening" | "thinking" | "speaking";

/** A (possibly partial) speech-to-text result. */
export interface Transcript {
  text: string;
  final: boolean;
}

// Audio invariant across module boundaries: signed 16-bit PCM, mono. Sample rate
// varies by stage, so it's always carried explicitly rather than assumed.
export const RATE_WEBRTC = 48000; // Opus / browser media
export const RATE_STT = 16000; // Whisper / Silero VAD
export const RATE_KOKORO = 24000; // Kokoro TTS native output
