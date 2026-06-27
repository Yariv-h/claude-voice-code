// Boot the web server: static UI + /health over HTTP, and the WebRTC voice
// signaling WebSocket at /api/voice/signal.

import { createServer as createHttpServer } from "node:http";
import { WebSocketServer } from "ws";
import { listCvcSessions, resolveSocket, type Config } from "@cvc/core";
import { staticHandler } from "./http";
import { handleConnection } from "./signaling";

export * from "./transport";

export interface RunningServer {
  url: string;
  stop(): Promise<void>;
}

export function createServer(config: Config): { start(): Promise<RunningServer> } {
  return {
    start() {
      const http = createHttpServer((req, res) => {
        if (req.url && req.url.split("?")[0] === "/api/sessions") {
          const sessions = listCvcSessions(resolveSocket(config.tmux.socket));
          res.writeHead(200, { "content-type": "application/json" });
          res.end(JSON.stringify({ sessions, active: config.tmux.session }));
          return;
        }
        staticHandler(req, res);
      });
      const wss = new WebSocketServer({ noServer: true });

      http.on("upgrade", (req, socket, head) => {
        let pathname = "";
        try {
          pathname = new URL(req.url ?? "", "http://localhost").pathname;
        } catch {
          /* ignore */
        }
        if (pathname !== "/api/voice/signal") {
          socket.destroy();
          return;
        }
        wss.handleUpgrade(req, socket, head, (ws) => handleConnection(ws, config));
      });

      return new Promise((resolve) => {
        http.listen(config.server.port, config.server.host, () => {
          const url = `http://${config.server.host}:${config.server.port}`;
          resolve({
            url,
            stop: () =>
              new Promise((r) => {
                wss.close();
                http.close(() => r());
              }),
          });
        });
      });
    },
  };
}
