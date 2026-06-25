# Voice Console — design reference

Source mockup for the web UI (`apps/web`), exported from a claude.ai design
canvas. `voice-console/Voice Console.dc.html` is the component; `support.js` is
the canvas runtime (we do **not** use it — the app reimplements this in React).
Open the `.dc.html` in a browser to view it rendered.

The real app reproduces this design, driving the visualizer's energy `level`
from **live mic/TTS analyser data** (the mockup uses synthetic sine motion).

## Type
- UI / sans: **Space Grotesk** (400–700)
- Mono / labels: **JetBrains Mono** (400–500) — tags, captions, code, diffs

## Themes (7; default **nova**)
Per-theme tokens: `bg, text, dim, border, surface, accent, accent2, glow, ink, dark`.

| theme | bg | accent | accent2 | fx |
|---|---|---|---|---|
| **nova** (default) | `#04060e` | `#3fe9ff` | `#c06bff` | drifting grid |
| carbon | `#08090a` | `#56c7e8` | `#7b9cf5` | — |
| aurora | `#080614` | `#a98bff` | `#56e0d8` | — |
| ember | `#15100d` | `#d97757` | `#e6a06a` | — (Claude orange) |
| paper (light) | `#f3f1ec` | `#c2512f` | `#d98a3d` | — |
| matrix | `#000600` | `#27ff6a` | `#9dffb4` | code-rain |
| sentinel | `#0b0406` | `#ff3b5c` | `#ff8a4c` | scan + tracking ring |

Derived: `dockBg` (translucent), `codeBg`, `addText`/`addBg` (diff green). `ink` =
contrast color used on accent fills (e.g. mic glyph, reply avatar dot).

## Voice states (4) → label / caption / what shows
- **idle** → "Tap to speak" / "Voice session ready" → hint card ("Try saying …")
- **listening** → "Listening" / "Capturing your request"
- **thinking** → "Thinking" / "Planning the change" → 3 pulsing dots
- **speaking** → "Responding" / "… typecheck passed" → Claude reply block

## Visualizers (4; default **orb**)
Canvas, audio-reactive via an eased `level` (lerp toward target at `dt*8`).
Energy targets: idle `.13`, listening `1`, thinking `.5`, speaking `.74` (each
modulated by sine + noise). Modes:
- **orb** — radial-gradient glow + solid core (radius pulses with level) +
  expanding fading rings (cadence by state) + highlight arc; fx themes add
  orbiting accent arcs.
- **wave** — mirrored vertical bars, gradient stroke, count ∝ width.
- **blob** — single wobbling metaball (sum-of-sines radius).
- **field** — 72 orbiting particles, alpha/size ∝ level.

Background canvas (`#vc-rain`) renders matrix code-rain only for the matrix theme.

## Layout (max-width ~760px, centered)
- **Header**: green pulse dot + "Claude Code" + `voice` badge (mono, bordered);
  right side: `claude-sonnet · connected` (mono, dim).
- **Stage**: visualizer section, height `clamp(230px,33vh,330px)`; nova draws
  corner brackets + a vertical sweep; sentinel draws a spinning dashed ring.
- **Controls**: centered status label (mono, uppercase, letter-spaced, accent) +
  caption (dim); 68px round mic button — idle = surface bg + border, active =
  accent fill + `glow` shadow + accent ring. SVG mic glyph.
- **Conversation** (gap 18px): hint card (dashed border) | "You" turn (18px,
  medium) | thinking dots | Claude reply: avatar+`CLAUDE` label, prose (with
  inline mono spans), a **diff card** (file header + `+N −0`, green-added rows),
  **file chips** (path + edited/new tag), a **command line** (`$ npm run
  typecheck` … `✓ 0 errors`). Entrance animation `turnIn` (fade + rise).
- **Dock** (fixed bottom-center, `backdrop-filter: blur(22px)`, translucent):
  three groups — **Theme** swatches (round, ring on active), **Visual** segmented
  (Orb/Wave/Blob/Field), **State** segmented (Idle/Listen/Think/Speak). In the
  app: Theme + Visual are real user settings; State reflects the live voice state.

## Animations (CSS)
`turnIn` (message entrance), `dotpulse` (thinking dots), `softpulse` (status dot),
`gridDrift` (nova grid), `sweepY`/`brk` (nova brackets), `spin`/`scanBar` (sentinel),
plus the JS canvas loops (visualizer + matrix rain).

See `voice-console/Voice Console.dc.html` for exact CSS and the canvas math to port.
