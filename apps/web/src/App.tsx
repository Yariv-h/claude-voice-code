import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { MatrixRain } from "./components/MatrixRain";
import { Visualizer } from "./components/Visualizer";
import { useVoice, type VoiceSettings, type VoiceState } from "./hooks/useVoice";
import { hexA, THEME_ORDER, THEMES, VIZ_ORDER, type ThemeId, type VizId } from "./themes";

const mono = "'JetBrains Mono', monospace";

const LABEL: Record<VoiceState, string> = {
  off: "Tap to connect",
  idle: "Ready",
  listening: "Listening",
  thinking: "Thinking",
  speaking: "Responding",
};
const CAPTION: Record<VoiceState, string> = {
  off: "Start a voice session",
  idle: "Speak any time — I'm listening",
  listening: "Capturing your request",
  thinking: "Working on it…",
  speaking: "Speaking the reply",
};

// Kokoro v0.19 speakers (sid 0–10).
const VOICES = ["Default", "Bella", "Nicole", "Sarah", "Sky", "Adam", "Michael", "Emma", "Isabella", "George", "Lewis"];
const MODELS = [
  { v: "default", label: "Default" },
  { v: "opus", label: "Opus" },
  { v: "sonnet", label: "Sonnet" },
  { v: "haiku", label: "Haiku" },
];
const THINKING = [
  { v: "off", label: "Off" },
  { v: "think", label: "Think" },
  { v: "think-hard", label: "Hard" },
  { v: "ultra", label: "Ultra" },
];
// Whisper sizes (s/m/l) for testing latency vs accuracy; downloaded on first use.
const WHISPERS = [
  { v: "sherpa-onnx-whisper-small.en", label: "S" },
  { v: "sherpa-onnx-whisper-medium.en", label: "M" },
  { v: "sherpa-onnx-whisper-large-v3", label: "L" },
];

export function App() {
  const [themeId, setThemeId] = useState<ThemeId>("nova");
  const [viz, setViz] = useState<VizId>("orb");
  const [engine, setEngine] = useState<"local" | "elevenlabs">("local");
  const [model, setModel] = useState("default");
  const [speaker, setSpeaker] = useState(0);
  const [thinking, setThinking] = useState("off");
  const [concise, setConcise] = useState(true);
  const [whisper, setWhisper] = useState("sherpa-onnx-whisper-small.en");
  const [sessionName, setSessionName] = useState("voice");
  const [cwd, setCwd] = useState("");
  const [sessions, setSessions] = useState<{ name: string; cwd: string }[]>([]);

  const { state, muted, transcript, notice, start, stop, reconnect, interrupt, clearConversation, setMicMuted, micAnalyser, ttsAnalyser } =
    useVoice({ openMic: true });

  const t = THEMES[themeId];
  const dark = t.dark;
  const c = { ...t, dockBg: dark ? "rgba(15,16,19,0.82)" : "rgba(255,255,255,0.85)" };
  const connected = state !== "off";
  const active = connected && !muted;

  const settingsWith = (over: Partial<VoiceSettings>): VoiceSettings => ({
    stt: engine,
    tts: engine,
    kokoroSpeaker: speaker,
    model,
    thinking,
    concise,
    whisper,
    sessionName,
    ...(cwd ? { cwd } : {}),
    ...over,
  });
  const onMic = () => {
    if (state === "off") void start(settingsWith({}));
    else setMicMuted(!muted);
  };
  const changeEngine = (e: "local" | "elevenlabs") => {
    setEngine(e);
    if (connected) reconnect(settingsWith({ stt: e, tts: e }));
  };
  const changeModel = (m: string) => {
    setModel(m);
    if (connected) reconnect(settingsWith({ model: m, restartSession: true }));
  };
  const changeVoice = (s: number) => {
    setSpeaker(s);
    if (connected) reconnect(settingsWith({ kokoroSpeaker: s }));
  };
  const changeThinking = (th: string) => {
    setThinking(th);
    if (connected) reconnect(settingsWith({ thinking: th }));
  };
  const changeConcise = (v: boolean) => {
    setConcise(v);
    if (connected) reconnect(settingsWith({ concise: v }));
  };
  const changeWhisper = (w: string) => {
    setWhisper(w);
    if (connected) reconnect(settingsWith({ whisper: w }));
  };
  const switchSession = (name: string) => {
    setSessionName(name);
    const found = sessions.find((s) => s.name === `cvc-${name}`);
    if (connected) reconnect(settingsWith({ sessionName: name, ...(found?.cwd ? { cwd: found.cwd } : {}) }));
  };
  const newSession = () => {
    const name = window.prompt("New session name (letters, numbers, dashes):", "");
    if (!name || !/^[\w-]{1,40}$/.test(name)) return;
    const folder = (window.prompt("Project folder (absolute path; blank = current):", cwd || "") || "").trim();
    setSessionName(name);
    if (folder) setCwd(folder);
    if (connected) reconnect(settingsWith({ sessionName: name, ...(folder ? { cwd: folder } : {}) }));
  };

  // Auto-scroll the conversation to the latest line.
  const convRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = convRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [transcript, state]);

  // Keep the active-session list fresh (updates after connect / new session).
  useEffect(() => {
    let live = true;
    fetch("/api/sessions")
      .then((r) => r.json())
      .then((d) => live && setSessions(d.sessions ?? []))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [state]);

  const showHint = state === "off" || (state === "idle" && transcript.length === 0);
  let lastAgent = -1;
  transcript.forEach((l, i) => l.role === "agent" && (lastAgent = i));

  const sessionOptions = Array.from(
    new Set([sessionName, ...sessions.map((s) => s.name.replace(/^cvc-/, ""))]),
  ).map((n) => ({ v: n, label: n }));
  const pill: CSSProperties = {
    fontFamily: mono,
    fontSize: 11,
    color: c.dim,
    background: "transparent",
    border: `1px solid ${c.border}`,
    borderRadius: 6,
    padding: "3px 8px",
    cursor: "pointer",
  };

  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: c.bg,
        color: c.text,
        fontFamily: "'Space Grotesk', system-ui, sans-serif",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* ── ambient backdrops ── */}
      <div style={{ position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0, background: `radial-gradient(58% 46% at 50% 24%, ${c.glow}, transparent 72%)` }} />
      {t.fxType === "nova" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            zIndex: 0,
            backgroundImage: `linear-gradient(${c.grid} 1px, transparent 1px), linear-gradient(90deg, ${c.grid} 1px, transparent 1px)`,
            backgroundSize: "46px 46px",
            WebkitMaskImage: "radial-gradient(118% 92% at 50% 28%, #000 24%, transparent 72%)",
            maskImage: "radial-gradient(118% 92% at 50% 28%, #000 24%, transparent 72%)",
            animation: "gridDrift 9s linear infinite",
          }}
        />
      )}
      {t.fxType === "matrix" && <MatrixRain />}
      {t.fxType === "sentinel" && (
        <div style={{ position: "fixed", left: 0, right: 0, top: 0, height: 150, zIndex: 0, pointerEvents: "none", background: "linear-gradient(transparent, rgba(255,59,92,0.07), transparent)", animation: "scanBar 4.5s linear infinite" }} />
      )}

      {/* ── pinned top: header + stage + status + mic ── */}
      <div style={{ position: "relative", zIndex: 2, flexShrink: 0 }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 26px", maxWidth: 980, margin: "0 auto" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <div style={{ width: 9, height: 9, borderRadius: "50%", background: connected ? "#3ad07f" : c.dim, boxShadow: connected ? "0 0 10px #3ad07f" : "none", animation: connected ? "softpulse 2.4s ease-in-out infinite" : "none" }} />
            <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: "-.01em" }}>Claude Code</span>
            <span style={{ fontFamily: mono, fontSize: 11, letterSpacing: ".14em", textTransform: "uppercase", color: c.dim, padding: "3px 8px", border: `1px solid ${c.border}`, borderRadius: 6 }}>voice</span>
            <Picker value={sessionName} onChange={switchSession} options={sessionOptions} c={c} />
            <button onClick={newSession} title="New session" style={pill}>＋ new</button>
            {connected && (
              <button onClick={clearConversation} title="New conversation (/clear)" style={pill}>
                clear
              </button>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: mono, fontSize: 11, color: c.dim }}>
            <span style={{ opacity: 0.7 }}>{connected ? "connected" : "offline"}</span>
            {connected && (
              <button onClick={stop} style={{ fontFamily: mono, fontSize: 11, color: c.dim, background: "transparent", border: `1px solid ${c.border}`, borderRadius: 6, padding: "3px 8px", cursor: "pointer" }}>end</button>
            )}
          </div>
        </header>

        <section style={{ height: "clamp(160px,22vh,240px)", position: "relative", maxWidth: 760, margin: "0 auto" }}>
          <Visualizer state={state} viz={viz} theme={t} micAnalyser={micAnalyser} ttsAnalyser={ttsAnalyser} />
          {t.fxType === "nova" && <NovaBrackets accent={c.accent} />}
          {t.fxType === "sentinel" && <SentinelRing />}
        </section>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 14, marginTop: 4, paddingBottom: 14 }}>
          <div style={{ textAlign: "center" }}>
            <div style={{ fontFamily: mono, fontSize: 13, letterSpacing: ".22em", textTransform: "uppercase", color: c.accent, fontWeight: 500 }}>
              {muted && connected ? "Muted" : LABEL[state]}
            </div>
            <div style={{ fontSize: 13, color: c.dim, marginTop: 6 }}>{muted && connected ? "Tap the mic to unmute" : CAPTION[state]}</div>
            {notice && <div style={{ fontSize: 12, color: c.accent, marginTop: 6, fontFamily: mono }}>⏳ {notice}</div>}
          </div>
          <button
            onClick={onMic}
            aria-label={state === "off" ? "Connect" : muted ? "Unmute" : "Mute"}
            style={{
              width: 64,
              height: 64,
              borderRadius: "50%",
              border: `1px solid ${active ? "transparent" : c.border}`,
              background: active ? c.accent : dark ? "rgba(255,255,255,0.05)" : "#fff",
              color: active ? c.ink : c.text,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: active ? `0 0 44px ${c.glow}, 0 0 0 1px ${hexA(c.accent, 0.5)}` : "0 4px 18px rgba(0,0,0,0.12)",
              transition: "box-shadow .3s ease, background .3s ease",
            }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M6 11a6 6 0 0 0 12 0" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </button>
          {(state === "thinking" || state === "speaking") && (
            <button
              onClick={interrupt}
              title="Stop the current turn"
              style={{
                fontFamily: mono,
                fontSize: 11,
                letterSpacing: ".12em",
                textTransform: "uppercase",
                color: c.text,
                background: "transparent",
                border: `1px solid ${c.border}`,
                borderRadius: 9,
                padding: "5px 12px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: 7,
              }}
            >
              <span style={{ width: 8, height: 8, background: c.accent, borderRadius: 2 }} />
              Stop
            </button>
          )}
        </div>
      </div>

      {/* ── scrolling conversation ── */}
      <div
        ref={convRef}
        style={{
          position: "relative",
          zIndex: 2,
          flex: 1,
          overflowY: "auto",
          borderTop: `1px solid ${c.border}`,
          maskImage: "linear-gradient(to bottom, transparent, #000 18px)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent, #000 18px)",
        }}
      >
        <div style={{ maxWidth: 720, margin: "0 auto", padding: "20px 26px 150px", display: "flex", flexDirection: "column", gap: 18 }}>
          {showHint ? (
            <div style={{ textAlign: "center", padding: "22px 18px", border: `1px dashed ${c.border}`, borderRadius: 16 }}>
              <div style={{ fontSize: 13, color: c.dim, marginBottom: 8 }}>Try saying</div>
              <div style={{ fontSize: 16, fontWeight: 500 }}>&ldquo;Add a dark mode toggle to the settings page&rdquo;</div>
            </div>
          ) : (
            transcript.map((line, i) =>
              line.role === "user" ? (
                <div key={i} style={{ animation: "turnIn .4s ease both" }}>
                  <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: ".2em", textTransform: "uppercase", color: c.dim, marginBottom: 8 }}>You</div>
                  <div style={{ fontSize: 18, lineHeight: 1.5, fontWeight: 500, letterSpacing: "-.01em", opacity: line.partial ? 0.6 : 1, fontStyle: line.partial ? "italic" : "normal" }}>{line.text}</div>
                </div>
              ) : (
                <div
                  key={i}
                  style={{
                    animation: "turnIn .4s ease both",
                    // Highlight the reply that's currently being spoken.
                    ...(i === lastAgent && state === "speaking"
                      ? { borderLeft: `2px solid ${c.accent}`, paddingLeft: 14, background: hexA(c.accent, 0.06), borderRadius: 10, boxShadow: `0 0 30px ${c.glow}` }
                      : { borderLeft: "2px solid transparent", paddingLeft: 14 }),
                    transition: "background .3s ease, box-shadow .3s ease, border-color .3s ease",
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 18, height: 18, borderRadius: 5, background: c.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: c.ink }} />
                    </div>
                    <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: ".2em", textTransform: "uppercase", color: c.dim }}>Claude</span>
                    {i === lastAgent && state === "speaking" && (
                      <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".14em", textTransform: "uppercase", color: c.accent, opacity: 0.85 }}>▶ speaking</span>
                    )}
                  </div>
                  <div style={{ fontSize: 16, lineHeight: 1.6, color: c.text, whiteSpace: "pre-wrap" }}>{line.text}</div>
                </div>
              ),
            )
          )}
          {state === "thinking" && (
            <div style={{ display: "flex", alignItems: "center", gap: 10, animation: "turnIn .4s ease both" }}>
              <div style={{ display: "flex", gap: 5 }}>
                {[0, 0.18, 0.36].map((d) => (
                  <span key={d} style={{ width: 7, height: 7, borderRadius: "50%", background: c.accent, animation: `dotpulse 1.1s ease-in-out ${d}s infinite` }} />
                ))}
              </div>
              <span style={{ fontSize: 13, color: c.dim }}>Working on it…</span>
            </div>
          )}
        </div>
      </div>

      {/* ── dock ── */}
      <div
        style={{
          position: "fixed",
          left: "50%",
          bottom: 14,
          transform: "translateX(-50%)",
          zIndex: 10,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "flex-end",
          gap: 16,
          padding: "10px 16px",
          borderRadius: 18,
          background: c.dockBg,
          border: `1px solid ${c.border}`,
          backdropFilter: "blur(22px)",
          WebkitBackdropFilter: "blur(22px)",
          boxShadow: "0 12px 40px rgba(0,0,0,.3)",
          maxWidth: "96vw",
        }}
      >
        <DockGroup label="Theme">
          <div style={{ display: "flex", gap: 6 }}>
            {THEME_ORDER.map((id) => {
              const th = THEMES[id];
              const swatch = id === "nova" ? "linear-gradient(135deg,#3fe9ff,#c06bff)" : th.accent;
              return (
                <button key={id} title={th.label} onClick={() => setThemeId(id)} style={{ width: 22, height: 22, borderRadius: "50%", cursor: "pointer", background: swatch, border: `2px solid ${id === themeId ? th.accent : "transparent"}`, outline: `1px solid ${c.border}`, outlineOffset: 1, padding: 0 }} />
              );
            })}
          </div>
        </DockGroup>

        <Divider color={c.border} />

        <DockGroup label="Visual">
          <Segmented options={VIZ_ORDER.map((v) => ({ v: v.id, label: v.label }))} value={viz} onChange={(v) => setViz(v as VizId)} c={c} />
        </DockGroup>

        <Divider color={c.border} />

        <DockGroup label="Voice">
          <Picker value={String(speaker)} onChange={(v) => changeVoice(Number(v))} options={VOICES.map((n, i) => ({ v: String(i), label: n }))} c={c} />
        </DockGroup>

        <DockGroup label="Model">
          <Picker value={model} onChange={changeModel} options={MODELS} c={c} />
        </DockGroup>

        <DockGroup label="Thinking">
          <Picker value={thinking} onChange={changeThinking} options={THINKING} c={c} />
        </DockGroup>

        <DockGroup label="Brief">
          <Segmented
            options={[{ v: "on", label: "On" }, { v: "off", label: "Off" }]}
            value={concise ? "on" : "off"}
            onChange={(v) => changeConcise(v === "on")}
            c={c}
          />
        </DockGroup>

        <DockGroup label="Engine">
          <Segmented options={[{ v: "local", label: "Local" }, { v: "elevenlabs", label: "11Labs" }]} value={engine} onChange={(v) => changeEngine(v as "local" | "elevenlabs")} c={c} />
        </DockGroup>

        <DockGroup label="STT">
          <Segmented options={WHISPERS} value={whisper} onChange={changeWhisper} c={c} />
        </DockGroup>
      </div>
    </div>
  );
}

type Colors = { accent: string; ink: string; dim: string; border: string };

function DockGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
      <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".18em", textTransform: "uppercase", opacity: 0.7 }}>{label}</span>
      {children}
    </div>
  );
}

function Divider({ color }: { color: string }) {
  return <div style={{ width: 1, alignSelf: "stretch", background: color, margin: "2px 0" }} />;
}

function Segmented({ options, value, onChange, c }: { options: { v: string; label: string }[]; value: string; onChange: (v: string) => void; c: Colors }) {
  return (
    <div style={{ display: "flex", gap: 4 }}>
      {options.map((o) => {
        const on = o.v === value;
        return (
          <button key={o.v} onClick={() => onChange(o.v)} style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, fontWeight: 500, padding: "6px 10px", borderRadius: 9, cursor: "pointer", border: `1px solid ${on ? "transparent" : c.border}`, color: on ? c.ink : c.dim, background: on ? c.accent : "transparent" }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Picker({ options, value, onChange, c }: { options: { v: string; label: string }[]; value: string; onChange: (v: string) => void; c: Colors }) {
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      style={{ fontFamily: "'Space Grotesk', sans-serif", fontSize: 12, fontWeight: 500, padding: "6px 8px", borderRadius: 9, cursor: "pointer", border: `1px solid ${c.border}`, color: c.dim, background: "transparent", outline: "none" }}
    >
      {options.map((o) => (
        <option key={o.v} value={o.v} style={{ color: "#111", background: "#fff" }}>
          {o.label}
        </option>
      ))}
    </select>
  );
}

function NovaBrackets({ accent }: { accent: string }) {
  const corner = (pos: CSSProperties, borders: CSSProperties, delay: string): CSSProperties => ({ position: "absolute", width: 24, height: 24, ...pos, ...borders, animation: `brk 3s ease-in-out ${delay} infinite` });
  return (
    <div style={{ position: "absolute", inset: "10% 6%", pointerEvents: "none", overflow: "hidden" }}>
      <div style={corner({ top: 0, left: 0 }, { borderTop: `1.5px solid ${accent}`, borderLeft: `1.5px solid ${accent}` }, "0s")} />
      <div style={corner({ top: 0, right: 0 }, { borderTop: `1.5px solid ${accent}`, borderRight: `1.5px solid ${accent}` }, ".4s")} />
      <div style={corner({ bottom: 0, left: 0 }, { borderBottom: `1.5px solid ${accent}`, borderLeft: `1.5px solid ${accent}` }, ".8s")} />
      <div style={corner({ bottom: 0, right: 0 }, { borderBottom: `1.5px solid ${accent}`, borderRight: `1.5px solid ${accent}` }, "1.2s")} />
      <div style={{ position: "absolute", left: 0, right: 0, top: 0, height: 2, background: `linear-gradient(90deg, transparent, ${accent}, transparent)`, animation: "sweepY 3.4s ease-in-out infinite" }} />
    </div>
  );
}

function SentinelRing() {
  return (
    <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
      <div style={{ width: 220, height: 220, maxWidth: "60%", maxHeight: "80%", border: "1px dashed rgba(255,59,92,0.55)", borderRadius: "50%", animation: "spin 11s linear infinite" }} />
    </div>
  );
}
