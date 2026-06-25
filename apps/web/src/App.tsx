import { useState, type CSSProperties, type ReactNode } from "react";
import { MatrixRain } from "./components/MatrixRain";
import { Visualizer } from "./components/Visualizer";
import { useVoice, type VoiceState } from "./hooks/useVoice";
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

export function App() {
  const [themeId, setThemeId] = useState<ThemeId>("nova");
  const [viz, setViz] = useState<VizId>("orb");
  const { state, muted, transcript, start, stop, setMicMuted, micAnalyser, ttsAnalyser } = useVoice({ openMic: true });

  const t = THEMES[themeId];
  const dark = t.dark;
  const c = {
    ...t,
    dockBg: dark ? "rgba(15,16,19,0.74)" : "rgba(255,255,255,0.8)",
  };
  const connected = state !== "off";
  const active = connected && !muted;

  const onMic = () => {
    if (state === "off") void start();
    else setMicMuted(!muted);
  };

  const showHint = state === "off" || (state === "idle" && transcript.length === 0);
  const lines = transcript.slice(-8);

  return (
    <div
      style={{
        minHeight: "100%",
        background: c.bg,
        color: c.text,
        fontFamily: "'Space Grotesk', system-ui, sans-serif",
        position: "relative",
        overflowX: "hidden",
      }}
    >
      {/* ambient glow */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 0,
          background: `radial-gradient(58% 46% at 50% 26%, ${c.glow}, transparent 72%)`,
        }}
      />
      {/* nova drifting grid */}
      {t.fxType === "nova" && (
        <div
          style={{
            position: "fixed",
            inset: 0,
            pointerEvents: "none",
            zIndex: 0,
            backgroundImage: `linear-gradient(${c.grid} 1px, transparent 1px), linear-gradient(90deg, ${c.grid} 1px, transparent 1px)`,
            backgroundSize: "46px 46px",
            WebkitMaskImage: "radial-gradient(118% 92% at 50% 32%, #000 28%, transparent 76%)",
            maskImage: "radial-gradient(118% 92% at 50% 32%, #000 28%, transparent 76%)",
            animation: "gridDrift 9s linear infinite",
          }}
        />
      )}
      {t.fxType === "matrix" && <MatrixRain />}
      {/* sentinel scan */}
      {t.fxType === "sentinel" && (
        <div
          style={{
            position: "fixed",
            left: 0,
            right: 0,
            top: 0,
            height: 150,
            zIndex: 0,
            pointerEvents: "none",
            background: "linear-gradient(transparent, rgba(255,59,92,0.07), transparent)",
            animation: "scanBar 4.5s linear infinite",
          }}
        />
      )}

      {/* header */}
      <header
        style={{
          position: "relative",
          zIndex: 2,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "18px 26px",
          maxWidth: 980,
          margin: "0 auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
          <div
            style={{
              width: 9,
              height: 9,
              borderRadius: "50%",
              background: connected ? "#3ad07f" : c.dim,
              boxShadow: connected ? "0 0 10px #3ad07f" : "none",
              animation: connected ? "softpulse 2.4s ease-in-out infinite" : "none",
            }}
          />
          <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: "-.01em" }}>Claude Code</span>
          <span
            style={{
              fontFamily: mono,
              fontSize: 11,
              letterSpacing: ".14em",
              textTransform: "uppercase",
              color: c.dim,
              padding: "3px 8px",
              border: `1px solid ${c.border}`,
              borderRadius: 6,
            }}
          >
            voice
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontFamily: mono, fontSize: 11, color: c.dim }}>
          <span style={{ opacity: 0.7 }}>{connected ? "connected" : "offline"}</span>
          {connected && (
            <button
              onClick={stop}
              style={{
                fontFamily: mono,
                fontSize: 11,
                color: c.dim,
                background: "transparent",
                border: `1px solid ${c.border}`,
                borderRadius: 6,
                padding: "3px 8px",
                cursor: "pointer",
              }}
            >
              end
            </button>
          )}
        </div>
      </header>

      {/* main */}
      <main style={{ position: "relative", zIndex: 2, maxWidth: 760, margin: "0 auto", padding: "8px 26px 160px" }}>
        <section style={{ height: "clamp(230px,33vh,330px)", position: "relative", margin: "6px 0 4px" }}>
          <Visualizer state={state} viz={viz} theme={t} micAnalyser={micAnalyser} ttsAnalyser={ttsAnalyser} />
          {t.fxType === "nova" && <NovaBrackets accent={c.accent} />}
          {t.fxType === "sentinel" && <SentinelRing />}
        </section>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 18, marginTop: 6 }}>
          <div style={{ textAlign: "center" }}>
            <div
              style={{
                fontFamily: mono,
                fontSize: 13,
                letterSpacing: ".22em",
                textTransform: "uppercase",
                color: c.accent,
                fontWeight: 500,
              }}
            >
              {muted && connected ? "Muted" : LABEL[state]}
            </div>
            <div style={{ fontSize: 13, color: c.dim, marginTop: 6 }}>
              {muted && connected ? "Tap the mic to unmute" : CAPTION[state]}
            </div>
          </div>

          <button
            onClick={onMic}
            aria-label={state === "off" ? "Connect" : muted ? "Unmute" : "Mute"}
            style={{
              width: 68,
              height: 68,
              borderRadius: "50%",
              border: `1px solid ${active ? "transparent" : c.border}`,
              background: active ? c.accent : dark ? "rgba(255,255,255,0.05)" : "#ffffff",
              color: active ? c.ink : c.text,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: active ? `0 0 44px ${c.glow}, 0 0 0 1px ${hexA(c.accent, 0.5)}` : "0 4px 18px rgba(0,0,0,0.12)",
              transition: "box-shadow .3s ease, transform .3s ease, background .3s ease",
            }}
          >
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="9" y="3" width="6" height="11" rx="3" />
              <path d="M6 11a6 6 0 0 0 12 0" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </button>
        </div>

        {/* conversation */}
        <div style={{ marginTop: 34, display: "flex", flexDirection: "column", gap: 18 }}>
          {showHint ? (
            <div style={{ textAlign: "center", padding: "22px 18px", border: `1px dashed ${c.border}`, borderRadius: 16 }}>
              <div style={{ fontSize: 13, color: c.dim, marginBottom: 8 }}>Try saying</div>
              <div style={{ fontSize: 16, fontWeight: 500 }}>&ldquo;Add a dark mode toggle to the settings page&rdquo;</div>
            </div>
          ) : (
            lines.map((line, i) =>
              line.role === "user" ? (
                <div key={i} style={{ animation: "turnIn .4s ease both" }}>
                  <div style={{ fontFamily: mono, fontSize: 10, letterSpacing: ".2em", textTransform: "uppercase", color: c.dim, marginBottom: 8 }}>You</div>
                  <div style={{ fontSize: 18, lineHeight: 1.5, fontWeight: 500, letterSpacing: "-.01em", opacity: line.partial ? 0.6 : 1, fontStyle: line.partial ? "italic" : "normal" }}>
                    {line.text}
                  </div>
                </div>
              ) : (
                <div key={i} style={{ animation: "turnIn .4s ease both" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <div style={{ width: 18, height: 18, borderRadius: 5, background: c.accent, display: "flex", alignItems: "center", justifyContent: "center" }}>
                      <div style={{ width: 7, height: 7, borderRadius: "50%", background: c.ink }} />
                    </div>
                    <span style={{ fontFamily: mono, fontSize: 10, letterSpacing: ".2em", textTransform: "uppercase", color: c.dim }}>Claude</span>
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
                  <span
                    key={d}
                    style={{ width: 7, height: 7, borderRadius: "50%", background: c.accent, animation: `dotpulse 1.1s ease-in-out ${d}s infinite` }}
                  />
                ))}
              </div>
              <span style={{ fontSize: 13, color: c.dim }}>Working on it…</span>
            </div>
          )}
        </div>
      </main>

      {/* dock */}
      <div
        style={{
          position: "fixed",
          left: "50%",
          bottom: 16,
          transform: "translateX(-50%)",
          zIndex: 10,
          display: "flex",
          flexWrap: "wrap",
          justifyContent: "center",
          alignItems: "flex-end",
          gap: 20,
          padding: "12px 18px",
          borderRadius: 18,
          background: c.dockBg,
          border: `1px solid ${c.border}`,
          backdropFilter: "blur(22px)",
          WebkitBackdropFilter: "blur(22px)",
          boxShadow: "0 12px 40px rgba(0,0,0,.28)",
          maxWidth: "94vw",
        }}
      >
        <DockGroup label="Theme">
          <div style={{ display: "flex", gap: 7 }}>
            {THEME_ORDER.map((id) => {
              const th = THEMES[id];
              const swatch = id === "nova" ? "linear-gradient(135deg,#3fe9ff,#c06bff)" : th.accent;
              return (
                <button
                  key={id}
                  title={th.label}
                  onClick={() => setThemeId(id)}
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    cursor: "pointer",
                    background: swatch,
                    border: `2px solid ${id === themeId ? th.accent : "transparent"}`,
                    outline: `1px solid ${c.border}`,
                    outlineOffset: 1,
                    padding: 0,
                  }}
                />
              );
            })}
          </div>
        </DockGroup>

        <div style={{ width: 1, alignSelf: "stretch", background: c.border, margin: "2px 0" }} />

        <DockGroup label="Visual">
          <div style={{ display: "flex", gap: 4 }}>
            {VIZ_ORDER.map((v) => {
              const on = v.id === viz;
              return (
                <button
                  key={v.id}
                  onClick={() => setViz(v.id)}
                  style={{
                    fontFamily: "'Space Grotesk', sans-serif",
                    fontSize: 12,
                    fontWeight: 500,
                    padding: "6px 11px",
                    borderRadius: 9,
                    cursor: "pointer",
                    border: `1px solid ${on ? "transparent" : c.border}`,
                    color: on ? c.ink : c.dim,
                    background: on ? c.accent : "transparent",
                  }}
                >
                  {v.label}
                </button>
              );
            })}
          </div>
        </DockGroup>
      </div>
    </div>
  );
}

function DockGroup({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 7 }}>
      <span style={{ fontFamily: mono, fontSize: 9, letterSpacing: ".18em", textTransform: "uppercase", opacity: 0.7 }}>{label}</span>
      {children}
    </div>
  );
}

function NovaBrackets({ accent }: { accent: string }) {
  const corner = (pos: CSSProperties, borders: CSSProperties, delay: string): CSSProperties => ({
    position: "absolute",
    width: 26,
    height: 26,
    ...pos,
    ...borders,
    animation: `brk 3s ease-in-out ${delay} infinite`,
  });
  return (
    <div style={{ position: "absolute", inset: "7% 5%", pointerEvents: "none", overflow: "hidden" }}>
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
      <div style={{ width: 250, height: 250, maxWidth: "60%", maxHeight: "80%", border: "1px dashed rgba(255,59,92,0.55)", borderRadius: "50%", animation: "spin 11s linear infinite" }} />
      <div style={{ position: "absolute", width: 292, height: 292, maxWidth: "72%", maxHeight: "92%", border: "1px solid rgba(255,59,92,0.15)", borderRadius: "50%" }} />
    </div>
  );
}
