import { test } from "node:test";
import assert from "node:assert/strict";
import {
  defaultConfig,
  envOverrides,
  mergeConfig,
  resolveConfig,
  validateConfig,
} from "./config";

test("defaults are valid", () => {
  assert.deepEqual(validateConfig(defaultConfig()), []);
});

test("deep merge keeps untouched siblings", () => {
  const cfg = mergeConfig({ elevenlabs: { apiKey: "k" } });
  assert.equal(cfg.elevenlabs.apiKey, "k");
  assert.equal(cfg.elevenlabs.ttsModel, "eleven_flash_v2_5"); // default preserved
});

test("precedence: flag > env > file > default", () => {
  const cfg = mergeConfig(
    { stt: "local" }, // file
    { stt: "elevenlabs" }, // env
    { stt: "off" }, // flag
  );
  assert.equal(cfg.stt, "off");
});

test("envOverrides maps the documented vars", () => {
  const o = envOverrides({
    CVC_STT: "elevenlabs",
    ELEVENLABS_API_KEY: "secret",
    CVC_PORT: "8080",
    CVC_CLAUDE_CWD: "/tmp/proj",
  } as NodeJS.ProcessEnv);
  assert.equal(o.stt, "elevenlabs");
  assert.equal(o.elevenlabs?.apiKey, "secret");
  assert.equal(o.server?.port, 8080);
  assert.equal(o.tmux?.cwd, "/tmp/proj");
});

test("validate flags missing elevenlabs key", () => {
  const cfg = mergeConfig({ tts: "elevenlabs" });
  const errs = validateConfig(cfg);
  assert.ok(errs.some((e) => e.includes("elevenlabs")));
});

test("validate rejects bad side and port", () => {
  const cfg = mergeConfig({ stt: "bogus" as never, server: { port: 0 } });
  const errs = validateConfig(cfg);
  assert.ok(errs.some((e) => e.includes("stt")));
  assert.ok(errs.some((e) => e.includes("port")));
});

test("resolveConfig fills cwd and absolutizes a relative models dir", () => {
  const cfg = mergeConfig({ models: { dir: "./m" }, tmux: { cwd: null } });
  const r = resolveConfig(cfg, "/work/proj");
  assert.equal(r.tmux.cwd, "/work/proj");
  assert.equal(r.models.dir, "/work/proj/m");
});
