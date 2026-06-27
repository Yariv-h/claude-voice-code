// Unix-socket server the PreToolUse hook calls to get a (spoken) human decision
// for a dangerous tool call. The client half-closes its write side after sending,
// so allowHalfOpen:true is REQUIRED or our reply never goes out. Fail-closed.

import net from "node:net";
import { existsSync, unlinkSync } from "node:fs";

export type ConfirmDecision = "allow" | "deny";
export type AskFn = (reason: string, payload: unknown) => Promise<ConfirmDecision>;

export class ConfirmBridge {
  private server: net.Server | null = null;

  constructor(
    private socketPath: string,
    private ask: AskFn,
    private fallback: ConfirmDecision = "deny",
  ) {}

  start(): Promise<void> {
    return new Promise((resolve) => {
      try {
        if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
      } catch {
        /* ignore */
      }
      this.server = net.createServer({ allowHalfOpen: true }, (conn) => this.handle(conn));
      this.server.on("error", () => {});
      this.server.listen(this.socketPath, () => resolve());
    });
  }

  private handle(conn: net.Socket): void {
    let buf = "";
    conn.setEncoding("utf8");
    conn.on("data", (d) => (buf += d));
    conn.on("error", () => {});
    conn.on("end", async () => {
      let reason = "(unknown)";
      let payload: unknown = {};
      try {
        const j = JSON.parse(buf || "{}");
        reason = typeof j.reason === "string" ? j.reason : reason;
        payload = j.payload;
      } catch {
        /* malformed → fall through */
      }
      let decision: ConfirmDecision;
      try {
        decision = await this.ask(reason, payload);
      } catch {
        decision = this.fallback;
      }
      try {
        conn.end(decision); // write "allow"/"deny", then FIN
      } catch {
        /* peer gone */
      }
    });
  }

  stop(): void {
    try {
      this.server?.close();
    } catch {
      /* ignore */
    }
    try {
      if (existsSync(this.socketPath)) unlinkSync(this.socketPath);
    } catch {
      /* ignore */
    }
    this.server = null;
  }
}
