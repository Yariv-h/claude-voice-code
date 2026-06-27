import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Dev: vite serves the UI on 5174 and proxies signaling/health to `cvc serve`
// (default 5173). Prod: `vite build` → dist/, served by @cvc/server same-origin.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5174,
    proxy: {
      "/api/voice/signal": { target: "ws://localhost:5173", ws: true },
      "/api/sessions": "http://localhost:5173",
      "/health": "http://localhost:5173",
    },
  },
  build: { outDir: "dist", emptyOutDir: true },
});
