// Matrix-theme background: falling katakana/digit rain (ported from the mockup).

import { useEffect, useRef } from "react";

const GLYPHS =
  "ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾄﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓ0123456789".split("");
const FS = 16;

export function MatrixRain() {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const ctx = cv.getContext("2d");
    if (!ctx) return;
    let W = 0;
    let H = 0;
    let raf = 0;
    let last = performance.now();
    let cols: { x: number; y: number; sp: number }[] = [];
    const init = () => {
      const n = Math.max(1, Math.floor(W / FS));
      cols = Array.from({ length: n }, (_, i) => ({ x: i * FS, y: Math.random() * H, sp: FS * (13 + Math.random() * 17) }));
    };
    const fit = () => {
      const r = cv.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      cv.width = Math.round(r.width * dpr);
      cv.height = Math.round(r.height * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      W = r.width;
      H = r.height;
      init();
    };
    fit();
    const onResize = () => fit();
    window.addEventListener("resize", onResize);
    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.fillStyle = "rgba(0,5,0,0.085)";
      ctx.fillRect(0, 0, W, H);
      ctx.font = `${FS}px 'JetBrains Mono', monospace`;
      ctx.textBaseline = "top";
      for (const col of cols) {
        ctx.fillStyle = "rgba(205,255,215,0.95)";
        ctx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], col.x, col.y);
        ctx.fillStyle = "rgba(39,255,106,0.55)";
        ctx.fillText(GLYPHS[(Math.random() * GLYPHS.length) | 0], col.x, col.y - FS);
        col.y += col.sp * dt;
        if (col.y > H + Math.random() * 240) {
          col.y = -FS * 2;
          col.sp = FS * (13 + Math.random() * 17);
        }
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", onResize);
    };
  }, []);
  return <canvas ref={ref} style={{ position: "fixed", inset: 0, width: "100%", height: "100%", zIndex: 0, pointerEvents: "none" }} />;
}
