#!/usr/bin/env node
// PreToolUse safety gate for voice-driven Claude Code. The voice session runs
// with --dangerously-skip-permissions (no prompts), so this hook is the backstop:
// it fires on matched tool calls, classifies the irreversible / external-effect
// ones, and for those asks the voice confirm channel before allowing.
//
// Allow  = exit 0 silently (normal flow proceeds).
// Deny   = emit a PreToolUse "deny" decision. Fail-closed (deny on any error).
// Toggle = VOICE_GUARD_ENABLED (1/true/on) or a flag file; disabled = inert.

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

const HOME = process.env.HOME || homedir();
const FLAG_FILE = process.env.VOICE_GUARD_FLAG_FILE || join(HOME, ".claude", "voice-guard.enabled");
const LOG_FILE = process.env.VOICE_GUARD_LOG || join(HOME, ".cache", "claude-voice-code", "voice-guard.log");
const CONFIRM_CMD = process.env.VOICE_GUARD_CONFIRM_CMD || "";
const TIMEOUT_MS = Number(process.env.VOICE_GUARD_CONFIRM_TIMEOUT_MS || 120000);

function enabled() {
  const e = process.env.VOICE_GUARD_ENABLED;
  if (e != null && e !== "") return /^(1|true|on|yes)$/i.test(e);
  return existsSync(FLAG_FILE);
}
function log(line) {
  try {
    mkdirSync(dirname(LOG_FILE), { recursive: true });
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* best-effort */
  }
}

// Returns { danger, reason } for a tool call.
function classify(tool, input) {
  if (/^mcp__/.test(tool)) {
    return { danger: true, reason: `use the ${tool.replace(/^mcp__/, "").replace(/__/g, " ")} integration` };
  }
  if (tool === "Bash") {
    const cmd = (input && input.command) || "";
    const rules = [
      [/\brm\s+-[a-z]*[rf]/i, "delete files (rm)"],
      [/\bgit\s+push\b.*(--force|-f)\b/i, "force-push with git"],
      [/\bgit\s+reset\s+--hard\b/i, "hard-reset git"],
      [/\b(dd|mkfs|fdisk|diskutil)\b/i, "run a disk command"],
      [/\bchmod\s+-R\b|\bchown\s+-R\b/i, "recursively change permissions"],
      [/\bsudo\b/i, "run sudo"],
      [/\b(kill|killall|pkill)\b/i, "kill processes"],
      [/(curl|wget)[^|]*\|\s*(sh|bash|zsh)/i, "pipe a download into a shell"],
      [/>\s*\/dev\/(sd|disk)|\bshutdown\b|\breboot\b/i, "run a destructive system command"],
      [/\b(npm|yarn|pnpm)\s+publish\b/i, "publish a package"],
      [/\bgit\s+push\b/i, "push to a remote"],
    ];
    for (const [re, label] of rules) if (re.test(cmd)) return { danger: true, reason: `${label}` };
    return { danger: false };
  }
  if (/^(Write|Edit|MultiEdit|NotebookEdit)$/.test(tool)) {
    const p = (input && (input.file_path || input.notebook_path)) || "";
    if (/(^\/(etc|usr|bin|sbin)\b|\/\.ssh\/|\/\.aws\/|\/\.env\b|id_rsa|\/\.git\/config)/.test(p)) {
      return { danger: true, reason: `write to a sensitive file` };
    }
    return { danger: false };
  }
  return { danger: false };
}

function deny(reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Voice guard denied: ${reason}`,
      },
    }),
  );
  process.exit(0);
}

let raw = "";
try {
  raw = readFileSync(0, "utf8");
} catch {
  /* no stdin */
}
if (!enabled()) process.exit(0);

let data = {};
try {
  data = JSON.parse(raw || "{}");
} catch {
  /* malformed */
}
const tool = data.tool_name || data.toolName || "";
const input = data.tool_input || data.toolInput || {};
const { danger, reason } = classify(tool, input);
if (!danger) process.exit(0); // allow silently

if (!CONFIRM_CMD) {
  log(`no confirm cmd → deny ${tool}: ${reason}`);
  deny(reason);
}
let out = "deny";
try {
  out = execFileSync("node", [CONFIRM_CMD, reason], { input: raw, encoding: "utf8", timeout: TIMEOUT_MS + 5000 });
} catch {
  out = "deny";
}
log(`${tool} (${reason}) → ${/allow/i.test(out) ? "allow" : "deny"}`);
if (/allow/i.test(out)) process.exit(0); // allow
deny(reason);
