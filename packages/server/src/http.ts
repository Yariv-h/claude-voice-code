// Minimal static host for the built web UI (SPA fallback to index.html) + /health.

import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const WEB_DIST = fileURLToPath(new URL("../../../apps/web/dist/", import.meta.url));

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json",
};

function notBuiltPage(): string {
  return `<!doctype html><meta charset=utf-8><title>cvc</title>
<body style="font:16px system-ui;max-width:40rem;margin:4rem auto;padding:0 1rem">
<h1>cvc web UI isn't built yet</h1>
<p>Build it once, then reload:</p>
<pre style="background:#f4f4f5;padding:1rem;border-radius:8px">npm run web:build</pre>
<p>The voice signaling endpoint is live at <code>/api/voice/signal</code>.</p>`;
}

export function staticHandler(req: IncomingMessage, res: ServerResponse): void {
  if (req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end('{"ok":true}');
    return;
  }
  if (!existsSync(WEB_DIST)) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(notBuiltPage());
    return;
  }
  const urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  let filePath = join(WEB_DIST, normalize(urlPath));
  if (!filePath.startsWith(WEB_DIST)) {
    res.writeHead(403);
    res.end("forbidden");
    return;
  }
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = join(WEB_DIST, "index.html"); // SPA fallback
  }
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end("not found");
    return;
  }
  res.writeHead(200, { "content-type": MIME[extname(filePath)] ?? "application/octet-stream" });
  createReadStream(filePath).pipe(res);
}
