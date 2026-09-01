/** Same-origin HTTP + authoritative cookie-authenticated WebSocket server. */
import { createServer, type IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import express from "express";
import { WebSocketServer, type WebSocket } from "ws";
import { config } from "./config.js";
import { RoomManager } from "./game/roomManager.js";
import { Connection } from "./net/connection.js";
import { ensureAnonymousSession, readAnonymousSession } from "./auth/session.js";
import { canonicalOrigin, isAllowedWebSocketOrigin } from "./security/origin.js";
import { parseClientMessage } from "./security/messages.js";
import { AbuseGuard, clientIp } from "./security/rateLimit.js";
import { securityHeaders } from "./security/headers.js";
import { GameError } from "./game/errors.js";
import { totalPairs } from "./game/questions.js";

const sourceDir = dirname(fileURLToPath(import.meta.url));
const clientDist = join(sourceDir, "..", "..", "client", "dist");

interface UpgradeContext {
  uid: string;
  origin: string;
  ip: string;
}

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  if (!socket.writable) {
    socket.destroy();
    return;
  }
  const body = `${reason}\n`;
  socket.write(
    `HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`,
  );
  socket.destroy();
}

export function createGameServer() {
  const app = express();
  const manager = new RoomManager();
  const abuse = new AbuseGuard();
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxMessageBytes });
  const contexts = new WeakMap<WebSocket, UpgradeContext>();
  const connections = new WeakMap<WebSocket, Connection>();

  app.disable("x-powered-by");
  app.use(securityHeaders(config.production, config.publicOrigin));

  app.get("/healthz", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true });
  });

  app.get("/api/session", (req, res) => {
    const ip = clientIp(req, config.trustProxy);
    res.setHeader("Cache-Control", "no-store");
    if (!abuse.allowSession(ip)) {
      res.status(429).json({ ok: false, code: "RATE_LIMITED" });
      return;
    }
    ensureAnonymousSession(req, res, config.sessionSecret, config.production);
    res.json({ ok: true });
  });

  app.use(express.static(clientDist));
  app.get("*", (_req, res) => {
    res.sendFile(join(clientDist, "index.html"), (error) => {
      if (error && !res.headersSent) res.status(503).send("Client build unavailable.");
    });
  });

  server.on("upgrade", (req, socket, head) => {
    let pathname = "";
    try {
      pathname = new URL(req.url ?? "", "http://localhost").pathname;
    } catch {
      return rejectUpgrade(socket, 400, "Bad Request");
    }
    if (pathname !== "/ws") return rejectUpgrade(socket, 404, "Not Found");

    const ip = clientIp(req, config.trustProxy);
    if (!abuse.allowConnection(ip)) return rejectUpgrade(socket, 429, "Too Many Requests");
    const rawOrigin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
    if (!isAllowedWebSocketOrigin(rawOrigin, config.allowedOrigins, config.production)) {
      return rejectUpgrade(socket, 403, "Forbidden");
    }
    const session = readAnonymousSession(req, config.sessionSecret);
    if (!session) return rejectUpgrade(socket, 401, "Unauthorized");
    const origin = config.publicOrigin ??
      (rawOrigin ? canonicalOrigin(rawOrigin) : `http://localhost:${config.port}`);
    if (!origin) return rejectUpgrade(socket, 403, "Forbidden");

    wss.handleUpgrade(req, socket, head, (ws) => {
      contexts.set(ws, { uid: session.uid, origin, ip });
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    const context = contexts.get(ws);
    if (!context) return ws.close(1008, "missing connection context");
    const conn = new Connection(ws, context.origin, context.ip, config.maxBufferedBytes);
    connections.set(ws, conn);
    conn.startAuthenticationTimeout(config.authTimeoutMs);

    ws.on("message", (data) => {
      const msg = parseClientMessage(data, config.maxMessageBytes);
      if (!msg) {
        const allowed = abuse.allowMessage(conn.uid ?? `ip:${conn.ip}`);
        conn.send({ t: "ERROR", code: allowed ? "BAD_REQUEST" : "RATE_LIMITED" });
        return;
      }

      if (msg.t === "HELLO") {
        if (conn.uid !== null) {
          conn.send({ t: "ERROR", code: "BAD_REQUEST" });
          conn.closePolicy("duplicate authentication");
          return;
        }
        if (!abuse.allowSession(conn.ip)) {
          conn.send({ t: "ERROR", code: "RATE_LIMITED" });
          return;
        }
        conn.authenticate(context.uid);
        try {
          manager.register(conn);
        } catch (error) {
          const code = error instanceof GameError ? error.code : "INTERNAL";
          conn.send({ t: "ERROR", code });
          conn.closePolicy("connection rejected");
        }
        return;
      }

      if (!conn.uid) {
        conn.send({ t: "ERROR", code: "UNAUTHORIZED" });
        return;
      }
      if (!abuse.allowMessage(conn.uid, msg.t)) {
        conn.send({ t: "ERROR", code: "RATE_LIMITED" });
        return;
      }
      manager.handle(conn, msg);
    });

    ws.on("pong", () => {
      conn.alive = true;
    });
    const cleanup = () => manager.disconnect(conn);
    ws.on("close", cleanup);
    ws.on("error", cleanup);
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const conn = connections.get(ws);
      if (!conn) {
        ws.terminate();
        continue;
      }
      if (!conn.alive) {
        ws.terminate();
        continue;
      }
      conn.alive = false;
      try {
        ws.ping();
      } catch {
        ws.terminate();
      }
    }
  }, config.heartbeatMs);
  heartbeat.unref?.();

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearInterval(heartbeat);
    abuse.dispose();
    manager.dispose();
  };
  server.on("close", dispose);

  return { app, server, wss, manager, dispose };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const runtime = createGameServer();
  runtime.server.listen(config.port, config.host, () => {
    // eslint-disable-next-line no-console
    console.log(`«خلك طبيعي» listening on port ${config.port} (${totalPairs()} question pairs)`);
  });
}
