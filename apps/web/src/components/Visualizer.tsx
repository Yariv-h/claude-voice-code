// Audio-reactive canvas visualizer (orb / wave / blob / field) — ported from the
// Voice Console mockup, but the energy `level` is driven by live analyser data
// (mic while listening, TTS while speaking) with the synthetic motion as fallback.

import { useEffect, useRef } from "react";
import type { AnalyserRef, VoiceState } from "../hooks/useVoice";
import { hexRgb, type Theme, type VizId } from "../themes";

function energy(an: AnalyserNode | null): number {
  if (!an) return 0;
  const buf = new Uint8Array(an.frequencyBinCount);
  an.getByteFrequencyData(buf);
  let s = 0;
  for (let i = 0; i < buf.length; i++) s += buf[i];
  return s / buf.length / 255;
}

export function Visualizer({
  state,
  viz,
  theme,
  micAnalyser,
  ttsAnalyser,
}: {
  state: VoiceState;
  viz: VizId;
  theme: Theme;
  micAnalyser: AnalyserRef;
  ttsAnalyser: AnalyserRef;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stateRef = useRef(state);
  stateRef.current = state;
  const vizRef = useRef(viz);
  vizRef.current = viz;
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    const cv = canvasRef.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;

    let W = 0;
    let H = 0;
    let raf = 0;
    let t = 0;
    let level = 0;
    let ringT = 0;
    let rings: { r: number; a: number }[] = [];
    const particles = Array.from({ length: 72 }, () => ({
      a: Math.random() * Math.PI * 2,
      r: 0.18 + Math.random() * 0.92,
      sp: 0.2 + Math.random() * 0.9,
      sz: 0.7 + Math.random() * 1.9,
      ph: Math.random() * Math.PI * 2,
      alt: Math.random() < 0.45,
    }));

    const fit = () => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.max(1, Math.round(r.width * dpr));
      cv.height = Math.max(1, Math.round(r.height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      W = r.width;
      H = r.height;
    };
    fit();
    const onResize = () => fit();
    window.addEventListener("resize", onResize);

    let last = performance.now();
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      t += dt;
      draw(dt);
      raf = requestAnimationFrame(loop);
    };

    const draw = (dt: number) => {
      const voice = stateRef.current;
      const mode = vizRef.current;
      const def = themeRef.current;
      ctx.clearRect(0, 0, W, H);
      const A = hexRgb(def.accent);
      const A2 = hexRgb(def.accent2 || def.accent);
      const rgba = (c: { r: number; g: number; b: number }, a: number) => `rgba(${c.r},${c.g},${c.b},${a})`;

      const Emap: Record<VoiceState, number> = { off: 0.05, idle: 0.13, listening: 1, thinking: 0.5, speaking: 0.74 };
      let target = Emap[voice];
      if (voice === "listening") {
        const e = energy(micAnalyser.current);
        target = e > 0.01 ? Math.min(1, e * 1.7) : Emap.listening * (0.5 + 0.5 * Math.abs(Math.sin(t * 6)));
      } else if (voice === "speaking") {
        const e = energy(ttsAnalyser.current);
        target = e > 0.01 ? Math.min(1, e * 1.7) : Emap.speaking * (0.6 + 0.4 * Math.abs(Math.sin(t * 4.5)));
      } else if (voice === "thinking") {
        target = Emap.thinking * (0.5 + 0.5 * Math.sin(t * 2));
      }
      level += (target - level) * Math.min(1, dt * 8);
      const L = Math.max(0, level);

      const cx = W / 2;
      const cy = H / 2;
      const base = Math.min(W, H) * 0.2;
      ctx.save();

      if (mode === "wave") {
        const n = Math.max(22, Math.floor(W / 15));
        const span = W * 0.82;
        const x0 = (W - span) / 2;
        const bw = span / n;
        ctx.lineCap = "round";
        for (let i = 0; i < n; i++) {
          const env = Math.sin((i / (n - 1)) * Math.PI);
          const ph = i * 0.4;
          let v = Math.abs(Math.sin(t * 3 + ph) * 0.5 + Math.sin(t * 1.7 + ph * 1.3 + 1) * 0.34);
          if (voice === "listening") v += 0.32 * Math.abs(Math.sin(t * 9 + i * 1.7));
          const amp = (0.06 + 0.94 * env) * L;
          const h = Math.max(bw * 0.5, v * amp * H * 0.4 + bw * 0.45);
          const x = x0 + i * bw + bw / 2;
          const grad = ctx.createLinearGradient(0, cy - h, 0, cy + h);
          grad.addColorStop(0, rgba(A2, 0.85));
          grad.addColorStop(0.5, rgba(A, 1));
          grad.addColorStop(1, rgba(A2, 0.85));
          ctx.strokeStyle = grad;
          ctx.lineWidth = Math.min(bw * 0.55, 6);
          ctx.shadowColor = rgba(A, 0.45);
          ctx.shadowBlur = 12;
          ctx.beginPath();
          ctx.moveTo(x, cy - h);
          ctx.lineTo(x, cy + h);
          ctx.stroke();
        }
      } else if (mode === "orb") {
        ringT += dt;
        const every = voice === "listening" ? 0.5 : voice === "speaking" ? 0.7 : voice === "thinking" ? 0.95 : 1.7;
        if (ringT > every) {
          ringT = 0;
          rings.push({ r: base * 0.9, a: 0.5 });
        }
        rings = rings.filter((r) => r.a > 0.012);
        rings.forEach((r) => {
          r.r += dt * 110 * (0.6 + L);
          r.a *= 1 - dt * 0.85;
          ctx.beginPath();
          ctx.arc(cx, cy, r.r, 0, 7);
          ctx.strokeStyle = rgba(A, r.a * 0.6);
          ctx.lineWidth = 1.5;
          ctx.stroke();
        });
        const R = base * (1.05 + 0.13 * L * Math.sin(t * 3));
        const g = ctx.createRadialGradient(cx, cy, R * 0.2, cx, cy, R * 2.5);
        g.addColorStop(0, rgba(A, 0.5));
        g.addColorStop(0.5, rgba(A, 0.12));
        g.addColorStop(1, rgba(A, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        const cg = ctx.createRadialGradient(cx - R * 0.32, cy - R * 0.32, R * 0.1, cx, cy, R);
        cg.addColorStop(0, rgba(A2, 1));
        cg.addColorStop(1, rgba(A, 0.86));
        ctx.beginPath();
        ctx.arc(cx, cy, R, 0, 7);
        ctx.fillStyle = cg;
        ctx.shadowColor = rgba(A, 0.6);
        ctx.shadowBlur = 34;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(cx - R * 0.25, cy - R * 0.25, R * 0.78, 0, 7);
        ctx.strokeStyle = "rgba(255,255,255,0.16)";
        ctx.lineWidth = 1;
        ctx.stroke();
        if (def.fxType) {
          ctx.shadowBlur = 0;
          ctx.beginPath();
          ctx.arc(cx, cy, R * 1.55, 0, 7);
          ctx.strokeStyle = rgba(A2, 0.16);
          ctx.lineWidth = 1;
          ctx.stroke();
          const a0 = t * 1.3;
          ctx.beginPath();
          ctx.arc(cx, cy, R * 1.55, a0, a0 + 0.95);
          ctx.strokeStyle = rgba(A2, 0.75);
          ctx.lineWidth = 2;
          ctx.shadowColor = rgba(A2, 0.6);
          ctx.shadowBlur = 12;
          ctx.stroke();
          ctx.beginPath();
          ctx.arc(cx, cy, R * 1.9, 0, 7);
          ctx.strokeStyle = rgba(A, 0.08);
          ctx.lineWidth = 1;
          ctx.shadowBlur = 0;
          ctx.stroke();
        }
      } else if (mode === "blob") {
        const g0 = ctx.createRadialGradient(cx, cy, base * 0.3, cx, cy, base * 2.2);
        g0.addColorStop(0, rgba(A, 0.2));
        g0.addColorStop(1, rgba(A, 0));
        ctx.fillStyle = g0;
        ctx.fillRect(0, 0, W, H);
        const pts = 90;
        ctx.beginPath();
        for (let i = 0; i <= pts; i++) {
          const ang = (i / pts) * Math.PI * 2;
          const wob = 1 + 0.2 * L * Math.sin(ang * 3 + t * 2) + 0.13 * L * Math.sin(ang * 5 - t * 1.6) + 0.06 * Math.sin(ang * 2 + t);
          const rr = base * 1.15 * wob;
          const x = cx + Math.cos(ang) * rr;
          const y = cy + Math.sin(ang) * rr;
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.closePath();
        const bg = ctx.createRadialGradient(cx - base * 0.4, cy - base * 0.4, base * 0.2, cx, cy, base * 1.7);
        bg.addColorStop(0, rgba(A2, 0.96));
        bg.addColorStop(1, rgba(A, 0.85));
        ctx.fillStyle = bg;
        ctx.shadowColor = rgba(A, 0.55);
        ctx.shadowBlur = 42;
        ctx.fill();
      } else if (mode === "field") {
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, base * 2.4);
        g.addColorStop(0, rgba(A, 0.16));
        g.addColorStop(1, rgba(A, 0));
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, W, H);
        const maxR = Math.min(W, H) * 0.42;
        particles.forEach((p) => {
          p.a += dt * p.sp * (0.3 + 0.8 * L) * 0.55;
          const pulse = 1 + 0.16 * L * Math.sin(t * 3 + p.ph);
          const rr = p.r * maxR * pulse;
          const x = cx + Math.cos(p.a) * rr;
          const y = cy + Math.sin(p.a) * rr * 0.9;
          const al = (0.22 + 0.6 * (1 - p.r)) * (0.45 + 0.55 * L);
          ctx.beginPath();
          ctx.arc(x, y, p.sz * (0.8 + 0.6 * L), 0, 7);
          ctx.fillStyle = rgba(p.alt ? A2 : A, al);
          ctx.shadowColor = rgba(A, 0.5);
          ctx.shadowBlur = 8;
          ctx.fill();
        });
      }
      ctx.restore();
      ctx.shadowBlur = 0;
    };

    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, [micAnalyser, ttsAnalyser]);

  return <canvas ref={canvasRef} style={{ width: "100%", height: "100%", display: "block" }} />;
}
