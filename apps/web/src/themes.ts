// The 7 Voice Console themes (verbatim tokens from the design mockup).

export type ThemeId = "nova" | "carbon" | "aurora" | "ember" | "paper" | "matrix" | "sentinel";

export interface Theme {
  label: string;
  bg: string;
  text: string;
  dim: string;
  border: string;
  surface: string;
  accent: string;
  accent2: string;
  glow: string;
  ink: string;
  dark: boolean;
  grid?: string;
  fxType?: "nova" | "matrix" | "sentinel";
}

export const THEME_ORDER: ThemeId[] = ["carbon", "paper", "aurora", "ember", "nova", "matrix", "sentinel"];

export const THEMES: Record<ThemeId, Theme> = {
  carbon: { label: "Carbon", bg: "#08090a", text: "#e9eaec", dim: "#7e8288", border: "rgba(255,255,255,0.10)", surface: "rgba(255,255,255,0.04)", accent: "#56c7e8", accent2: "#7b9cf5", glow: "rgba(86,199,232,0.11)", dark: true, ink: "#04141a" },
  paper: { label: "Paper", bg: "#f3f1ec", text: "#1b1a17", dim: "#6c6a64", border: "rgba(0,0,0,0.11)", surface: "#ffffff", accent: "#c2512f", accent2: "#d98a3d", glow: "rgba(194,81,47,0.10)", dark: false, ink: "#ffffff" },
  aurora: { label: "Aurora", bg: "#080614", text: "#ece9f8", dim: "#8b85ad", border: "rgba(160,150,255,0.17)", surface: "rgba(255,255,255,0.045)", accent: "#a98bff", accent2: "#56e0d8", glow: "rgba(169,139,255,0.13)", dark: true, ink: "#0a0716" },
  ember: { label: "Ember", bg: "#15100d", text: "#f3eae3", dim: "#9d8d82", border: "rgba(217,119,87,0.20)", surface: "rgba(255,255,255,0.035)", accent: "#d97757", accent2: "#e6a06a", glow: "rgba(217,119,87,0.13)", dark: true, ink: "#1a0f09" },
  nova: { label: "Nova", bg: "#04060e", text: "#e3f4ff", dim: "#6d88a8", border: "rgba(90,200,255,0.20)", surface: "rgba(120,200,255,0.055)", accent: "#3fe9ff", accent2: "#c06bff", glow: "rgba(63,233,255,0.17)", dark: true, ink: "#031018", fxType: "nova", grid: "rgba(86,196,255,0.10)" },
  matrix: { label: "Matrix", bg: "#000600", text: "#bfffce", dim: "#3f8a55", border: "rgba(0,255,90,0.20)", surface: "rgba(0,40,15,0.32)", accent: "#27ff6a", accent2: "#9dffb4", glow: "rgba(20,255,90,0.13)", dark: true, ink: "#001a08", fxType: "matrix" },
  sentinel: { label: "Sentinel", bg: "#0b0406", text: "#ffe2e6", dim: "#9a6b72", border: "rgba(255,70,90,0.22)", surface: "rgba(255,60,80,0.05)", accent: "#ff3b5c", accent2: "#ff8a4c", glow: "rgba(255,59,92,0.15)", dark: true, ink: "#1a0408", fxType: "sentinel" },
};

export type VizId = "orb" | "wave" | "blob" | "field";
export const VIZ_ORDER: { id: VizId; label: string }[] = [
  { id: "orb", label: "Orb" },
  { id: "wave", label: "Wave" },
  { id: "blob", label: "Blob" },
  { id: "field", label: "Field" },
];

export function hexRgb(h: string): { r: number; g: number; b: number } {
  const x = h.replace("#", "");
  const f = x.length === 3 ? x.split("").map((s) => s + s).join("") : x;
  const n = parseInt(f, 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}
export function hexA(h: string, a: number): string {
  const c = hexRgb(h);
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}
