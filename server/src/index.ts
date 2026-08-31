/**
 * Server bootstrap: one HTTP server serves the built client AND upgrades the
 * WebSocket connection on the same origin, so QR/join URLs and `wss://` work
 * through a tunnel or custom domain with no CORS or cross-origin concerns.
 */
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import express from "express";
import { WebSocketServer } from "ws";
import type { ClientMessage } from "../../shared/types.js";
import { config } from "./config.js";
import { RoomManager } from "./game/roomManager.js";
import { Connection } from "./net/connection.js";
import { isValidClientKey, uidFromClientKey } from "./auth/session.js";
import { totalPairs } from "./game/questions.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// In dev (tsx) __dirname = server/src; in build (tsc) = server/dist. The built
// client is at ../../client/dist relative to the repo, i.e. two up from src.
const clientDist = join(__dirname, "..", "..", "client", "dist");

const app = express();
app.disable("x-powered-by");

app.get("/healthz", (_req, res) => {
  res.json({ ok: true, rooms: manager.roomCount, questions: totalPairs() });
});

// Static assets + SPA fallback (so /join/:code deep-links load the app).
app.use(express.static(clientDist));
app.get("*", (_req, res) => {
  res.sendFile(join(clientDist, "index.html"), (err) => {
    if (err) res.status(200).send("Client not built. Run `npm run build`.");
  });
});

const server = createServer(app);
const manager = new RoomManager();
const wss = new WebSocketServer({ server, path: "/ws", maxPayload: config.maxMessageBytes });

function originFor(req: import("node:http").IncomingMessage): string {
  if (config.publicOrigin) return config.publicOrigin;
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
  const proto =
    (req.headers["x-forwarded-proto"] as string | undefined) ??
    (String(host).startsWith("localhost") || String(host).startsWith("127.")
      ? "http"
      : "https");
  return `${proto}://${Array.isArray(host) ? host[0] : host}`;
}

wss.on("connection", (ws, req) => {
  const conn = new Connection(ws, originFor(req));

  ws.on("message", (data) => {
    let msg: ClientMessage;
    try {
      const text = typeof data === "string" ? data : data.toString("utf8");
      if (text.length > config.maxMessageBytes) return;
      msg = JSON.parse(text) as ClientMessage;
    } catch {
      conn.send({ t: "ERROR", code: "BAD_REQUEST" });
      return;
    }
    if (!msg || typeof msg !== "object" || typeof (msg as { t?: unknown }).t !== "string") {
      conn.send({ t: "ERROR", code: "BAD_REQUEST" });
      return;
    }

    // HELLO establishes identity before anything else.
    if (msg.t === "HELLO") {
      if (!isValidClientKey(msg.clientKey)) {
        conn.send({ t: "ERROR", code: "UNAUTHORIZED" });
        return;
      }
      const uid = uidFromClientKey(msg.clientKey);
      conn.send({ t: "HELLO_OK", uid });
      manager.register(conn, uid);
      return;
    }
    if (!conn.uid) {
      conn.send({ t: "ERROR", code: "UNAUTHORIZED" });
      return;
    }
    manager.handle(conn, msg);
  });

  ws.on("pong", () => {
    conn.alive = true;
  });

  ws.on("close", () => manager.disconnect(conn));
  ws.on("error", () => manager.disconnect(conn));
});

// Heartbeat: drop dead sockets so presence stays accurate.
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    const c = ws as unknown as { alive?: boolean };
    if (c.alive === false) {
      ws.terminate();
      continue;
    }
    c.alive = false;
    try {
      ws.ping();
    } catch {
      /* ignore */
    }
  }
}, config.heartbeatMs);
wss.on("close", () => clearInterval(heartbeat));

// Track per-connection liveness for the heartbeat.
wss.on("connection", (ws) => {
  (ws as unknown as { alive?: boolean }).alive = true;
  ws.on("pong", () => ((ws as unknown as { alive?: boolean }).alive = true));
});

server.listen(config.port, config.host, () => {
  // eslint-disable-next-line no-console
  console.log(
    `«خلك طبيعي» server listening on http://${config.host}:${config.port}  (${totalPairs()} question pairs)`,
  );
});
