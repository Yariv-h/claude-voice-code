// Typed configuration: defaults, layered merge (flag > env > file > default),
// validation, and path resolution. IO is confined to loadConfig/findConfigFile.

import { homedir } from "node:os";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import type { Side } from "./types";
import { parseJsonc } from "./util/jsonc";

export interface ElevenLabsConfig {
  apiKey: string;
  ttsVoiceId: string;
  ttsModel: string;
  sttModel: string;
}
export interface ModelsConfig {
  dir: string;
  whisper: string;
  vad: string;
  kokoro: string;
  kokoroQuality: "int8" | "fp32";
}
export interface VadConfig {
  windowSize: number;
  threshold: number;
  minSilenceSec: number;
  minSpeechSec: number;
  maxSpeechSec: number;
}
export interface VoiceParams {
  kokoroSpeaker: number;
  speed: number;
}
export interface TmuxConfig {
  session: string;
  cwd: string | null;
  attach: string | null;
  socket: string | null;
}
export interface ReplyConfig {
  verbatimMaxChars: number;
  summarize: boolean;
}
export interface ServerConfig {
  port: number;
  host: string;
}

export interface Config {
  stt: Side;
  tts: Side;
  claudeBin: string;
  elevenlabs: ElevenLabsConfig;
  models: ModelsConfig;
  vad: VadConfig;
  voice: VoiceParams;
  tmux: TmuxConfig;
  reply: ReplyConfig;
  server: ServerConfig;
}

export type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K];
};

const SIDES: readonly Side[] = ["local", "elevenlabs", "off"];

/** A fresh default config (deep-copied each call). */
export function defaultConfig(): Config {
  return {
    stt: "local",
    tts: "local",
    claudeBin: "claude",
    elevenlabs: {
      apiKey: "",
      ttsVoiceId: "EXAVITQu4vr4xnSDxMaL", // "Sarah"
      ttsModel: "eleven_flash_v2_5",
      sttModel: "scribe_v1",
    },
    models: {
      dir: join(homedir(), ".cache", "claude-voice-code", "models"),
      whisper: "sherpa-onnx-whisper-small.en",
      vad: "silero_vad.onnx",
      kokoro: "kokoro-int8-en-v0_19",
      kokoroQuality: "int8",
    },
    vad: { windowSize: 512, threshold: 0.5, minSilenceSec: 0.5, minSpeechSec: 0.2, maxSpeechSec: 20 },
    voice: { kokoroSpeaker: 0, speed: 1.0 },
    tmux: { session: "cvc-voice", cwd: null, attach: null, socket: null },
    reply: { verbatimMaxChars: 220, summarize: false },
    server: { port: 5173, host: "127.0.0.1" },
  };
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepMerge<T>(base: T, patch: DeepPartial<T> | undefined): T {
  if (patch === undefined) return base;
  if (!isObj(base) || !isObj(patch)) return patch as unknown as T;
  const out: Record<string, unknown> = { ...base };
  for (const k of Object.keys(patch)) {
    const pv = (patch as Record<string, unknown>)[k];
    if (pv === undefined) continue;
    const bv = (base as Record<string, unknown>)[k];
    out[k] = isObj(bv) && isObj(pv) ? deepMerge(bv, pv as DeepPartial<typeof bv>) : pv;
  }
  return out as T;
}

/** Merge layers over the defaults, later layers winning. */
export function mergeConfig(...layers: Array<DeepPartial<Config> | undefined>): Config {
  let cfg = defaultConfig();
  for (const layer of layers) cfg = deepMerge(cfg, layer);
  return cfg;
}

/** Build a config patch from environment variables. */
export function envOverrides(env: NodeJS.ProcessEnv = process.env): DeepPartial<Config> {
  const o: DeepPartial<Config> = {};
  const asSide = (v?: string): Side | undefined =>
    v === "local" || v === "elevenlabs" || v === "off" ? v : undefined;

  const stt = asSide(env.CVC_STT);
  if (stt) o.stt = stt;
  const tts = asSide(env.CVC_TTS);
  if (tts) o.tts = tts;
  if (env.ELEVENLABS_API_KEY) o.elevenlabs = { apiKey: env.ELEVENLABS_API_KEY };
  if (env.CVC_MODELS_DIR) o.models = { dir: env.CVC_MODELS_DIR };
  if (env.CLAUDE_BIN) o.claudeBin = env.CLAUDE_BIN;

  const tmux: DeepPartial<TmuxConfig> = {};
  if (env.CVC_TMUX_SESSION) tmux.session = env.CVC_TMUX_SESSION;
  if (env.CVC_CLAUDE_CWD) tmux.cwd = env.CVC_CLAUDE_CWD;
  if (env.CVC_TMUX_ATTACH) tmux.attach = env.CVC_TMUX_ATTACH;
  if (env.CVC_TMUX_SOCKET) tmux.socket = env.CVC_TMUX_SOCKET;
  if (Object.keys(tmux).length) o.tmux = tmux;

  const server: DeepPartial<ServerConfig> = {};
  if (env.CVC_PORT) server.port = Number(env.CVC_PORT);
  if (env.CVC_HOST) server.host = env.CVC_HOST;
  if (Object.keys(server).length) o.server = server;

  return o;
}

function expandHome(p: string): string {
  if (p === "~") return homedir();
  if (p.startsWith("~/")) return join(homedir(), p.slice(2));
  return p;
}

/** Fill derived values: default cwd, expand ~, make models.dir absolute. */
export function resolveConfig(cfg: Config, cwd: string = process.cwd()): Config {
  const tmux = { ...cfg.tmux };
  const models = { ...cfg.models };
  tmux.cwd = tmux.cwd ? expandHome(tmux.cwd) : cwd;
  models.dir = expandHome(models.dir);
  if (!isAbsolute(models.dir)) models.dir = resolve(cwd, models.dir);
  return { ...cfg, tmux, models };
}

/** Pure validation. Returns human-readable error strings ([] = valid). */
export function validateConfig(cfg: Config): string[] {
  const errs: string[] = [];
  if (!SIDES.includes(cfg.stt)) errs.push(`stt must be local|elevenlabs|off (got "${cfg.stt}")`);
  if (!SIDES.includes(cfg.tts)) errs.push(`tts must be local|elevenlabs|off (got "${cfg.tts}")`);
  if ((cfg.stt === "elevenlabs" || cfg.tts === "elevenlabs") && !cfg.elevenlabs.apiKey)
    errs.push("elevenlabs selected but no API key (set ELEVENLABS_API_KEY or elevenlabs.apiKey)");
  if (cfg.models.kokoroQuality !== "int8" && cfg.models.kokoroQuality !== "fp32")
    errs.push(`models.kokoroQuality must be int8|fp32 (got "${cfg.models.kokoroQuality}")`);
  if (!Number.isInteger(cfg.server.port) || cfg.server.port < 1 || cfg.server.port > 65535)
    errs.push(`server.port must be 1-65535 (got ${cfg.server.port})`);
  if (cfg.vad.windowSize <= 0) errs.push("vad.windowSize must be > 0");
  if (cfg.reply.verbatimMaxChars < 0) errs.push("reply.verbatimMaxChars must be >= 0");
  return errs;
}

/** Locate a config file by precedence; null if none found. */
export function findConfigFile(cwd: string = process.cwd()): string | null {
  const candidates = [
    process.env.CVC_CONFIG,
    join(cwd, "cvc.config.jsonc"),
    join(cwd, "cvc.config.json"),
    join(homedir(), ".config", "cvc", "config.jsonc"),
  ].filter((p): p is string => !!p);
  for (const p of candidates) if (existsSync(p)) return p;
  return null;
}

export interface LoadResult {
  config: Config;
  sourcePath: string | null;
  errors: string[];
}

/** Load config from disk + env + flags, resolve and validate. */
export function loadConfig(
  opts: { flags?: DeepPartial<Config>; cwd?: string; env?: NodeJS.ProcessEnv } = {},
): LoadResult {
  const cwd = opts.cwd ?? process.cwd();
  const env = opts.env ?? process.env;
  const sourcePath = findConfigFile(cwd);
  let fileLayer: DeepPartial<Config> | undefined;
  if (sourcePath) {
    try {
      fileLayer = parseJsonc<DeepPartial<Config>>(readFileSync(sourcePath, "utf8"));
    } catch (e) {
      throw new Error(`Failed to parse config ${sourcePath}: ${(e as Error).message}`);
    }
  }
  const merged = mergeConfig(fileLayer, envOverrides(env), opts.flags);
  const config = resolveConfig(merged, cwd);
  return { config, sourcePath, errors: validateConfig(config) };
}
