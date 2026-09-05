/** Same-origin HTTP + authoritative cookie-authenticated WebSocket server. */
import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import express from "express";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { config } from "./config.js";
import { RoomManager } from "./game/roomManager.js";
import { Connection } from "./net/connection.js";
import { ConnectionCapacity, type CapacityLease } from "./net/capacity.js";
import { ensureAnonymousSession, readAnonymousSession } from "./auth/session.js";
import { canonicalOrigin, isAllowedWebSocketOrigin } from "./security/origin.js";
import { parseClientMessage } from "./security/messages.js";
import { AbuseGuard, clientIp } from "./security/rateLimit.js";
import { securityHeaders } from "./security/headers.js";
import { GameError } from "./game/errors.js";
import { totalPairs } from "./game/questions.js";

const sourceDir = dirname(fileURLToPath(import.meta.url));
const clientDistCandidates = [
  join(sourceDir, "..", "..", "client", "dist"),
  join(sourceDir, "..", "..", "..", "..", "client", "dist"),
];
const clientDist = clientDistCandidates.find((candidate) => existsSync(candidate)) ?? clientDistCandidates[0]!;

interface UpgradeContext { uid: string; origin: string; ip: string; lease: CapacityLease }

function rejectUpgrade(socket: Duplex, status: number, reason: string): void {
  if (!socket.writable) {
    socket.destroy();
    return;
  }
  const body = `${reason}\n`;
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Type: text/plain\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
  socket.destroy();
}

function rawDataBytes(data: RawData): number {
  if (Array.isArray(data)) return data.reduce((sum, part) => sum + part.byteLength, 0);
  return data.byteLength;
}

export function createGameServer() {
  const app = express();
  const manager = new RoomManager({ emptyLobbyExpiryMs: config.emptyLobbyExpiryMs });
  const abuse = new AbuseGuard();
  const capacity = new ConnectionCapacity(config.maxConcurrentSockets, config.maxConcurrentSocketsPerIp);
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxMessageBytes });
  const contexts = new WeakMap<WebSocket, UpgradeContext>();
  const connections = new WeakMap<WebSocket, Connection>();
  const violations = new WeakMap<Connection, number>();
  let draining = false;
  let drainDeadlineMs: number | undefined;
  let drainTimer: NodeJS.Timeout | undefined;

  app.disable("x-powered-by");
  app.use(securityHeaders(config.production, config.publicOrigin));

  app.get("/healthz", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true });
  });

  app.get("/readyz", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.status(draining ? 503 : 200).json({ ok: !draining, draining, ...(drainDeadlineMs ? { deadlineMs: drainDeadlineMs } : {}) });
  });

  app.get("/api/session", (req, res) => {
    if (draining) {
      res.setHeader("Cache-Control", "no-store");
      res.status(503).json({ ok: false, code: "SERVER_RESTARTING", ...(drainDeadlineMs ? { deadlineMs: drainDeadlineMs } : {}) });
      return;
    }
    const ip = clientIp(req, config.clientIpMode);
    const existingSession = readAnonymousSession(req, config.sessionSecret);
    res.setHeader("Cache-Control", "no-store");
    if (!abuse.allowSession(ip, existingSession?.uid)) {
      res.status(429).json({ ok: false, code: "RATE_LIMITED" });
      return;
    }
    ensureAnonymousSession(req, res, config.sessionSecret, config.production);
    res.json({ ok: true });
  });

  app.use(express.static(clientDist));
  app.get("*", (req, res) => {
    const ip = clientIp(req, config.clientIpMode);
    if (!abuse.allowHttpFallback(ip)) return void res.status(429).type("text/plain").send("Too Many Requests");
    res.sendFile(join(clientDist, "index.html"), (error) => {
      if (error && !res.headersSent) res.status(503).send("Client build unavailable.");
    });
  });

  server.on("upgrade", (req, socket, head) => {
    let pathname = "";
    try { pathname = new URL(req.url ?? "", "http://localhost").pathname; }
    catch { return rejectUpgrade(socket, 400, "Bad Request"); }
    if (pathname !== "/ws") return rejectUpgrade(socket, 404, "Not Found");
    if (draining) return rejectUpgrade(socket, 503, "Service Restarting");

    const ip = clientIp(req, config.clientIpMode);
    const rawOrigin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
    if (!isAllowedWebSocketOrigin(rawOrigin, config.allowedOrigins, config.production)) return rejectUpgrade(socket, 403, "Forbidden");
    const session = readAnonymousSession(req, config.sessionSecret);
    if (!session) return rejectUpgrade(socket, 401, "Unauthorized");
    if (!abuse.allowConnection(ip, session.uid)) return rejectUpgrade(socket, 429, "Too Many Requests");
    const lease = capacity.acquire(ip);
    if (!lease) return rejectUpgrade(socket, 503, "Capacity Reached");
    const origin = config.publicOrigin ?? (rawOrigin ? canonicalOrigin(rawOrigin) : `http://localhost:${config.port}`);
    if (!origin) {
      lease.release();
      return rejectUpgrade(socket, 403, "Forbidden");
    }

    try {
      wss.handleUpgrade(req, socket, head, (ws) => {
        contexts.set(ws, { uid: session.uid, origin, ip, lease });
        wss.emit("connection", ws, req);
      });
    } catch (error) {
      lease.release();
      throw error;
    }
  });

  wss.on("connection", (ws) => {
    const context = contexts.get(ws);
    if (!context) return ws.close(1008, "missing connection context");
    const conn = new Connection(ws, context.origin, context.ip, config.maxBufferedBytes);
    connections.set(ws, conn);
    conn.startAuthenticationTimeout(config.authTimeoutMs);

    const violate = (code: "BAD_REQUEST" | "RATE_LIMITED", rid?: string) => {
      const strikes = (violations.get(conn) ?? 0) + 1;
      violations.set(conn, strikes);
      conn.send({ t: "ERROR", code, ...(rid ? { rid } : {}) });
      if (strikes >= 3) conn.closePolicy("sustained abuse");
    };

    ws.on("message", (data) => {
      // Reject oversized input before UTF-8 conversion / JSON parsing.
      if (rawDataBytes(data) > config.maxMessageBytes) {
        violate("BAD_REQUEST");
        if (ws.readyState === 1) ws.close(1009, "message too large");
        return;
      }
      const msg = parseClientMessage(data, config.maxMessageBytes);
      if (!msg) {
        violate(abuse.allowMessage(conn.uid ?? `ip:${conn.ip}`) ? "BAD_REQUEST" : "RATE_LIMITED");
        return;
      }

      if (msg.t === "HELLO") {
        // An upgrade may have completed immediately before draining began. Do
        // not let a delayed HELLO turn that transport into a newly admitted
        // authenticated connection after readiness has already gone false.
        if (draining) {
          conn.send({ t: "ERROR", code: "SERVER_RESTARTING", ...(msg.rid ? { rid: msg.rid } : {}) });
          conn.closePolicy("server draining");
          return;
        }
        if (conn.uid !== null) {
          conn.send({ t: "ERROR", code: "BAD_REQUEST", ...(msg.rid ? { rid: msg.rid } : {}) });
          conn.closePolicy("duplicate authentication");
          return;
        }
        if (!abuse.allowSession(conn.ip, context.uid)) return violate("RATE_LIMITED", msg.rid);
        conn.authenticate(context.uid);
        try { manager.register(conn); }
        catch (error) {
          const code = error instanceof GameError ? error.code : "INTERNAL";
          conn.send({ t: "ERROR", code, ...(msg.rid ? { rid: msg.rid } : {}) });
          conn.closePolicy("connection rejected");
        }
        return;
      }

      if (!conn.uid) {
        const rid = "rid" in msg ? msg.rid : undefined;
        conn.send({ t: "ERROR", code: "UNAUTHORIZED", ...(rid ? { rid } : {}) });
        return;
      }
      if (!abuse.allowMessage(conn.uid, msg.t)) {
        return violate("RATE_LIMITED", "rid" in msg ? msg.rid : undefined);
      }
      if (msg.t === "CREATE_ROOM" && !abuse.allowRoomCreation(conn.ip, conn.uid)) {
        violate("RATE_LIMITED", msg.rid);
        return;
      }
      manager.handle(conn, msg);
    });

    ws.on("pong", () => { conn.alive = true; });
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      manager.disconnect(conn);
      context.lease.release();
    };
    ws.on("close", cleanup);
    ws.on("error", cleanup);
  });

  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      const conn = connections.get(ws);
      if (!conn || !conn.alive) {
        ws.terminate();
        continue;
      }
      conn.alive = false;
      try { ws.ping(); } catch { ws.terminate(); }
    }
  }, config.heartbeatMs);
  heartbeat.unref?.();

  const finishDrain = () => {
    if (!draining) return;
    if (drainTimer) { clearTimeout(drainTimer); drainTimer = undefined; }
    for (const ws of wss.clients) {
      if (ws.readyState === 0 || ws.readyState === 1) ws.close(1012, "service restarting");
    }
    server.close();
    const force = setTimeout(() => { for (const ws of wss.clients) ws.terminate(); }, 1_000);
    force.unref?.();
  };

  const beginDrain = (graceMs = config.drainTimeoutMs): number => {
    if (draining && drainDeadlineMs) return drainDeadlineMs;
    draining = true;
    drainDeadlineMs = Date.now() + Math.max(1, graceMs);
    manager.setDraining(true);
    for (const ws of wss.clients) {
      const conn = connections.get(ws);
      if (conn) conn.send({ t: "SERVER_RESTARTING", deadlineMs: drainDeadlineMs });
    }
    drainTimer = setTimeout(finishDrain, Math.max(1, graceMs));
    return drainDeadlineMs;
  };

  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    clearInterval(heartbeat);
    if (drainTimer) clearTimeout(drainTimer);
    abuse.dispose();
    manager.dispose();
    for (const ws of wss.clients) ws.terminate();
  };
  server.on("close", dispose);
  return { app, server, wss, manager, dispose, capacity, beginDrain, finishDrain, isReady: () => !draining };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  const runtime = createGameServer();
  runtime.server.listen(config.port, config.host, () => {
    console.log(`«خلك طبيعي» listening on port ${config.port} (${totalPairs()} legacy question pairs)`);
  });
  let signalHandled = false;
  const shutdown = (signal: NodeJS.Signals) => {
    if (signalHandled) return;
    signalHandled = true;
    const deadlineMs = runtime.beginDrain(config.drainTimeoutMs);
    console.log(`${signal}: draining until ${new Date(deadlineMs).toISOString()}`);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
}
