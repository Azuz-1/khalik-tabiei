/** Same-origin HTTP + authoritative cookie-authenticated WebSocket server. */
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { Duplex } from "node:stream";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import express from "express";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { ROOM_CODE_LENGTH } from "../../shared/constants.js";
import { config } from "./config.js";
import { track } from "./analytics.js";
import { ClientTelemetryIngestor } from "./clientTelemetry.js";
import { RoomManager } from "./game/roomManager.js";
import { normalizeCode } from "./game/code.js";
import { buildDisplayView, createDisplayToken, verifyDisplayToken } from "./game/display.js";
import { Connection } from "./net/connection.js";
import { ConnectionCapacity, type CapacityLease } from "./net/capacity.js";
import { ensureAnonymousSession, readAnonymousSession } from "./auth/session.js";
import { canonicalOrigin, isAllowedWebSocketOrigin } from "./security/origin.js";
import { parseClientMessage } from "./security/messages.js";
import { AbuseGuard, clientIp } from "./security/rateLimit.js";
import { securityHeaders } from "./security/headers.js";
import { GameError } from "./game/errors.js";
import { totalPairs } from "./game/questions.js";
import { createConfiguredSuggestionService, type SuggestionService } from "./suggestions.js";

const sourceDir = dirname(fileURLToPath(import.meta.url));
const clientDistCandidates = [
  join(sourceDir, "..", "..", "client", "dist"),
  join(sourceDir, "..", "..", "..", "..", "client", "dist"),
];
const clientDist = clientDistCandidates.find((candidate) => existsSync(candidate)) ?? clientDistCandidates[0]!;

type ConnectionKind = "participant" | "display";
interface UpgradeContext {
  uid: string;
  origin: string;
  ip: string;
  lease: CapacityLease;
  kind: ConnectionKind;
  displayCode?: string;
  displayCreatedAt?: number;
  displayHostUid?: string;
  displayEpoch?: number;
}

interface GameServerOptions {
  suggestions?: SuggestionService;
  clientTelemetry?: ClientTelemetryIngestor;
}

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

function deployedCommit(): string {
  return process.env.RENDER_GIT_COMMIT?.trim() || "unknown";
}

export function createGameServer(options: GameServerOptions = {}) {
  const app = express();
  const manager = new RoomManager({
    emptyLobbyExpiryMs: config.emptyLobbyExpiryMs,
    requestRetentionMs: config.requestRetentionMs,
    maxRequestsPerUid: config.maxRequestsPerUid,
  });
  const abuse = new AbuseGuard({ limits: config.abuseLimits });
  const suggestions = options.suggestions ?? createConfiguredSuggestionService();
  const clientTelemetry = options.clientTelemetry ?? new ClientTelemetryIngestor();
  const capacity = new ConnectionCapacity(config.maxConcurrentSockets, config.maxConcurrentSocketsPerIp);
  const server = createServer(app);
  const wss = new WebSocketServer({ noServer: true, maxPayload: config.maxMessageBytes });
  const contexts = new WeakMap<WebSocket, UpgradeContext>();
  const connections = new WeakMap<WebSocket, Connection>();
  const violations = new WeakMap<Connection, number>();
  const displayEpochs = new Map<string, number>();
  const activeDisplays = new Map<string, WebSocket>();
  let draining = false;
  let drainDeadlineMs: number | undefined;
  let drainTimer: NodeJS.Timeout | undefined;

  const displayRoomKey = (code: string, createdAt: number) => `${code}:${createdAt}`;
  const displayEpoch = (code: string, createdAt: number) => displayEpochs.get(displayRoomKey(code, createdAt)) ?? 0;
  const revokeDisplay = (code: string, createdAt: number) => {
    const key = displayRoomKey(code, createdAt);
    displayEpochs.set(key, (displayEpochs.get(key) ?? 0) + 1);
    const active = activeDisplays.get(key);
    if (active) {
      const activeConn = connections.get(active);
      activeConn?.send({ t: "ROOM_CLOSED", reason: "display_revoked" });
      activeConn?.closePolicy("display revoked");
      activeDisplays.delete(key);
    }
  };

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

  app.get("/version", (_req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ sha: deployedCommit() });
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

  app.get("/api/rooms/:code/display-link", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const session = readAnonymousSession(req, config.sessionSecret);
    if (!session) {
      res.status(401).json({ ok: false, code: "UNAUTHORIZED" });
      return;
    }
    const code = normalizeCode(req.params.code);
    if (code.length !== ROOM_CODE_LENGTH) {
      res.status(404).json({ ok: false, code: "ROOM_NOT_FOUND" });
      return;
    }
    const room = manager.roomForTests(code);
    if (!room || room.closed || room.hostUid !== session.uid) {
      // Do not reveal whether a valid room code belongs to someone else.
      res.status(404).json({ ok: false, code: "ROOM_NOT_FOUND" });
      return;
    }
    const epoch = displayEpoch(room.code, room.createdAt);
    const token = createDisplayToken(room, config.sessionSecret, epoch);
    // Fragments are not transmitted in HTTP requests or Referer headers. The
    // display client captures this capability locally and clears it immediately.
    res.json({ ok: true, path: `/display/${room.code}#token=${encodeURIComponent(token)}` });
  });

  app.delete("/api/rooms/:code/display-link", (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const session = readAnonymousSession(req, config.sessionSecret);
    if (!session) {
      res.status(401).json({ ok: false, code: "UNAUTHORIZED" });
      return;
    }
    const code = normalizeCode(req.params.code);
    const room = code.length === ROOM_CODE_LENGTH ? manager.roomForTests(code) : undefined;
    if (!room || room.closed || room.hostUid !== session.uid) {
      res.status(404).json({ ok: false, code: "ROOM_NOT_FOUND" });
      return;
    }
    revokeDisplay(room.code, room.createdAt);
    res.status(204).end();
  });

  app.post("/api/telemetry", express.json({ limit: "8kb", strict: true }), (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    const session = readAnonymousSession(req, config.sessionSecret);
    if (!session) {
      res.status(401).json({ ok: false, code: "UNAUTHORIZED" });
      return;
    }
    const result = clientTelemetry.ingest(session.uid, req.body);
    if (result.ok) {
      res.status(204).end();
      return;
    }
    res.status(result.code === "RATE_LIMITED" ? 429 : 400).json({ ok: false, code: result.code });
  });

  app.post("/api/suggestions", express.json({ limit: "2kb", strict: true }), async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    if (draining) {
      res.status(503).json({ ok: false, code: "SERVER_RESTARTING" });
      return;
    }
    const session = readAnonymousSession(req, config.sessionSecret);
    if (!session) {
      res.status(401).json({ ok: false, code: "UNAUTHORIZED" });
      return;
    }

    const result = await suggestions.submit(clientIp(req, config.clientIpMode), session.uid, req.body);
    if (result.ok) {
      track("suggestion_submitted", { category: result.category, lengthBucket: result.lengthBucket });
      res.status(201).json({ ok: true });
      return;
    }

    const status = result.code === "RATE_LIMITED"
      ? 429
      : result.code === "UNAVAILABLE" || result.code === "STORAGE_FAILED"
        ? 503
        : 400;
    res.status(status).json({ ok: false, code: result.code });
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
    let requestUrl: URL;
    try { requestUrl = new URL(req.url ?? "", "http://localhost"); }
    catch { return rejectUpgrade(socket, 400, "Bad Request"); }
    if (requestUrl.pathname !== "/ws") return rejectUpgrade(socket, 404, "Not Found");
    if (draining) return rejectUpgrade(socket, 503, "Service Restarting");

    const ip = clientIp(req, config.clientIpMode);
    const rawOrigin = Array.isArray(req.headers.origin) ? req.headers.origin[0] : req.headers.origin;
    if (!isAllowedWebSocketOrigin(rawOrigin, config.allowedOrigins, config.production)) return rejectUpgrade(socket, 403, "Forbidden");
    const origin = config.publicOrigin ?? (rawOrigin ? canonicalOrigin(rawOrigin) : `http://localhost:${config.port}`);
    if (!origin) return rejectUpgrade(socket, 403, "Forbidden");

    const requestedMode = requestUrl.searchParams.get("mode");
    if (requestedMode !== null && requestedMode !== "display") return rejectUpgrade(socket, 400, "Bad Request");

    let contextUid: string;
    let kind: ConnectionKind = "participant";
    let displayCode: string | undefined;

    if (requestedMode === "display") {
      const code = normalizeCode(requestUrl.searchParams.get("code"));
      // The room code itself is public. Do not probe room existence during the
      // HTTP upgrade; possession is proven by the first validated HELLO frame.
      if (code.length !== ROOM_CODE_LENGTH) return rejectUpgrade(socket, 400, "Bad Request");
      kind = "display";
      displayCode = code;
      contextUid = `display:${randomUUID()}`;
    } else {
      const session = readAnonymousSession(req, config.sessionSecret);
      if (!session) return rejectUpgrade(socket, 401, "Unauthorized");
      contextUid = session.uid;
    }

    if (!abuse.allowConnection(ip, contextUid)) return rejectUpgrade(socket, 429, "Too Many Requests");
    const lease = capacity.acquire(ip);
    if (!lease) return rejectUpgrade(socket, 503, "Capacity Reached");
    socket.once("close", () => lease.release());

    try {
      wss.handleUpgrade(req, socket, head, (ws) => {
        contexts.set(ws, {
          uid: contextUid,
          origin,
          ip,
          lease,
          kind,
          ...(displayCode ? { displayCode } : {}),
        });
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
    let displayTimer: NodeJS.Timeout | undefined;
    let lastDisplayFingerprint = "";

    const pushDisplayState = () => {
      if (context.kind !== "display" || !context.displayCode || !conn.uid) return;
      const room = manager.roomForTests(context.displayCode);
      const currentEpoch = room ? displayEpoch(room.code, room.createdAt) : -1;
      if (
        !room
        || room.closed
        || room.createdAt !== context.displayCreatedAt
        || room.hostUid !== context.displayHostUid
        || currentEpoch !== context.displayEpoch
      ) {
        conn.send({ t: "ROOM_CLOSED", reason: "display_access_ended" });
        conn.closePolicy("display access ended");
        return;
      }
      const view = buildDisplayView(room, `${context.origin}/join/${room.code}`, config.sessionSecret);
      const fingerprint = JSON.stringify(view);
      if (fingerprint === lastDisplayFingerprint) return;
      lastDisplayFingerprint = fingerprint;
      conn.send({ t: "STATE", view });
    };

    const violate = (code: "BAD_REQUEST" | "RATE_LIMITED", rid?: string) => {
      const strikes = (violations.get(conn) ?? 0) + 1;
      violations.set(conn, strikes);
      conn.send({ t: "ERROR", code, ...(rid ? { rid } : {}) });
      if (strikes >= 3) conn.closePolicy("sustained abuse");
    };

    ws.on("message", (data) => {
      if (!conn.canProcessIncoming()) return;
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
        if (context.kind === "display") {
          const room = context.displayCode ? manager.roomForTests(context.displayCode) : undefined;
          const epoch = room ? displayEpoch(room.code, room.createdAt) : -1;
          if (!room || room.closed || !verifyDisplayToken(room, config.sessionSecret, msg.displayToken, epoch)) {
            conn.send({ t: "ERROR", code: "UNAUTHORIZED", message: "invalid display capability", ...(msg.rid ? { rid: msg.rid } : {}) });
            conn.closePolicy("invalid display capability");
            return;
          }
          const key = displayRoomKey(room.code, room.createdAt);
          const existing = activeDisplays.get(key);
          if (existing && existing !== ws && existing.readyState <= 1) {
            conn.send({ t: "ERROR", code: "DISPLAY_IN_USE", message: "display already active", ...(msg.rid ? { rid: msg.rid } : {}) });
            conn.closePolicy("display already active");
            return;
          }
          if (existing && existing.readyState > 1) activeDisplays.delete(key);

          // Bind this authenticated connection to one exact room incarnation,
          // current owner, and revocation epoch. None of these affect gameplay
          // participant liveness/accounting.
          context.displayCreatedAt = room.createdAt;
          context.displayHostUid = room.hostUid;
          context.displayEpoch = epoch;
          activeDisplays.set(key, ws);
          conn.authenticate(context.uid);
          conn.roomCode = context.displayCode ?? null;
          pushDisplayState();
          displayTimer = setInterval(pushDisplayState, 250);
          displayTimer.unref?.();
          return;
        }
        if (msg.displayToken !== undefined) {
          conn.send({ t: "ERROR", code: "BAD_REQUEST", ...(msg.rid ? { rid: msg.rid } : {}) });
          conn.closePolicy("display capability on participant connection");
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
      if (context.kind === "display") {
        if (msg.t === "PING") {
          conn.send({ t: "PONG", ...(msg.sampleId ? { sampleId: msg.sampleId } : {}), serverMs: Date.now() });
        } else {
          const rid = "rid" in msg ? msg.rid : undefined;
          conn.send({ t: "ERROR", code: "UNAUTHORIZED", message: "display connection is read-only", ...(rid ? { rid } : {}) });
        }
        return;
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
      if (displayTimer) clearInterval(displayTimer);
      if (context.kind === "display") {
        if (context.displayCode && context.displayCreatedAt !== undefined) {
          const key = displayRoomKey(context.displayCode, context.displayCreatedAt);
          if (activeDisplays.get(key) === ws) activeDisplays.delete(key);
        }
        conn.markDisconnected();
      } else {
        manager.disconnect(conn);
      }
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
    displayEpochs.clear();
    activeDisplays.clear();
    abuse.dispose();
    suggestions.cleanup();
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
