/**
 * RoomManager — the single authority that owns all rooms and connections.
 *
 * It authenticates every action against the connection's server-derived uid
 * (never a uid from the request body), delegates rules to the pure engine,
 * runs auto-advance timers, reconciles round completion when the active set
 * changes, and pushes tailored per-recipient views to sockets.
 */
import type { CategoryId, ClientMessage } from "../../../shared/types.js";
import { MAX_PLAYERS, TIMERS } from "../../../shared/constants.js";
import { track } from "../analytics.js";
import { Connection } from "../net/connection.js";
import { GameError, isGameError } from "./errors.js";
import { generateCode, normalizeCode } from "./code.js";
import * as engine from "./engine.js";
import { buildView } from "./view.js";
import {
  activePlayers,
  cleanName,
  createRoomState,
  normalizeArabic,
  type InternalPlayer,
  type RoomState,
} from "./state.js";

interface Deps {
  rng: () => number;
  now: () => number;
}

const IDLE_ROOM_MS = 30 * 60 * 1000; // GC rooms with no sockets for 30 min

export class RoomManager {
  private rooms = new Map<string, RoomState>();
  /** uid -> the set of that user's live connections. */
  private connsByUid = new Map<string, Set<Connection>>();
  /** roomCode -> pending timer handles keyed by purpose. */
  private timers = new Map<string, Map<string, NodeJS.Timeout>>();
  private deps: Deps;

  constructor(deps: Partial<Deps> = {}) {
    this.deps = { rng: deps.rng ?? Math.random, now: deps.now ?? Date.now };
    setInterval(() => this.gcIdleRooms(), 60_000).unref?.();
  }

  // ---- connection lifecycle ---------------------------------------------

  register(conn: Connection, uid: string): void {
    conn.uid = uid;
    let set = this.connsByUid.get(uid);
    if (!set) this.connsByUid.set(uid, (set = new Set()));
    set.add(conn);

    // Reconnect: if this uid belongs to an active room, restore the seat.
    const room = this.roomOf(uid);
    if (room) {
      conn.roomCode = room.code;
      const p = room.players.get(uid);
      if (p && !p.connected) {
        p.connected = true;
        p.lastSeen = this.deps.now();
      }
      this.broadcast(room);
    } else {
      this.sendState(conn); // idle "no room" state
    }
  }

  disconnect(conn: Connection): void {
    const uid = conn.uid;
    if (!uid) return;
    const set = this.connsByUid.get(uid);
    set?.delete(conn);
    const stillConnected = !!set && set.size > 0;
    if (set && set.size === 0) this.connsByUid.delete(uid);

    if (stillConnected) return; // another tab still open for this uid

    const room = this.roomOf(uid);
    if (!room) return;
    const p = room.players.get(uid);
    if (p) {
      p.connected = false;
      p.lastSeen = this.deps.now();
      // Losing a player from the active set may complete a phase.
      this.reconcile(room);
      this.broadcast(room);
    }
  }

  // ---- message dispatch --------------------------------------------------

  handle(conn: Connection, msg: ClientMessage): void {
    try {
      this.dispatch(conn, msg);
    } catch (e) {
      if (isGameError(e)) {
        conn.send({ t: "ERROR", code: e.code, message: e.message });
      } else {
        // Never leak internals to players.
        // eslint-disable-next-line no-console
        console.error("unexpected error handling", msg.t, e);
        conn.send({ t: "ERROR", code: "INTERNAL" });
      }
    }
  }

  private dispatch(conn: Connection, msg: ClientMessage): void {
    const uid = conn.uid;
    if (!uid) throw new GameError("UNAUTHORIZED");
    switch (msg.t) {
      case "PING":
        conn.send({ t: "PONG" });
        return;
      case "CREATE_ROOM":
        return this.createRoom(conn, uid);
      case "JOIN_ROOM":
        return this.joinRoom(conn, uid, msg.code, msg.name);
      case "LEAVE_ROOM":
        return this.leaveRoom(conn, uid);
      case "SET_SETTINGS":
        return this.withRoom(uid, (room) => {
          engine.setSettings(
            room,
            uid,
            { totalRounds: msg.totalRounds, categories: msg.categories },
            this.deps,
          );
          if (msg.categories) track("selected_category", { count: msg.categories.length });
          this.broadcast(room);
        });
      case "START_GAME":
        return this.startGame(uid);
      case "SUBMIT_ANSWER":
        return this.submitAnswer(uid, msg.answer);
      case "START_VOTING":
        return this.withRoom(uid, (room) => {
          engine.startVoting(room, uid, this.deps);
          this.broadcast(room);
        });
      case "SUBMIT_VOTE":
        return this.submitVote(uid, msg.targetUid);
      case "NEXT_ROUND":
        return this.nextRound(uid);
      case "KICK_PLAYER":
        return this.kick(uid, msg.uid);
      case "CLOSE_ROOM":
        return this.closeRoom(uid);
      case "REMATCH":
        return this.withRoom(uid, (room) => {
          engine.rematch(room, uid, this.deps);
          this.broadcast(room);
        });
      default:
        throw new GameError("BAD_REQUEST");
    }
  }

  // ---- actions -----------------------------------------------------------

  private createRoom(conn: Connection, uid: string): void {
    // Detach from any previous room first.
    this.detach(uid);
    const code = this.freshCode();
    const room = createRoomState(code, uid, this.deps.now());
    this.rooms.set(code, room);
    conn.roomCode = code;
    // Point all of this uid's connections at the new room.
    for (const c of this.connsByUid.get(uid) ?? []) c.roomCode = code;
    track("room_created", {});
    this.broadcast(room);
  }

  private joinRoom(conn: Connection, uid: string, rawCode: string, rawName: string): void {
    const code = normalizeCode(rawCode);
    const room = this.rooms.get(code);
    if (!room || room.closed) throw new GameError("ROOM_NOT_FOUND");
    if (room.phase === "CLOSED") throw new GameError("ROOM_CLOSED");

    // Existing player reconnecting via join -> just restore.
    if (room.players.has(uid)) {
      const p = room.players.get(uid)!;
      p.connected = true;
      p.lastSeen = this.deps.now();
      this.attach(uid, code);
      this.broadcast(room);
      return;
    }
    if (uid === room.hostUid) throw new GameError("ALREADY_IN_ROOM");
    if (room.phase !== "LOBBY") throw new GameError("ROOM_NOT_IN_LOBBY");
    if (room.players.size >= MAX_PLAYERS) throw new GameError("ROOM_FULL");

    const name = cleanName(rawName);
    const norm = normalizeArabic(name);
    for (const p of room.players.values()) {
      if (p.normalizedName === norm) throw new GameError("DUPLICATE_NAME");
    }
    const now = this.deps.now();
    const player: InternalPlayer = {
      uid,
      name,
      normalizedName: norm,
      score: 0,
      connected: true,
      joinedAt: now,
      lastSeen: now,
      isHost: false,
    };
    room.players.set(uid, player);
    this.attach(uid, code);
    track("player_count", { count: room.players.size });
    this.broadcast(room);
  }

  private leaveRoom(conn: Connection, uid: string): void {
    const room = this.roomOf(uid);
    if (!room) return;
    if (uid === room.hostUid) {
      return this.doClose(room, "host_left");
    }
    if (room.players.delete(uid)) {
      this.reconcile(room);
    }
    this.detach(uid);
    this.broadcast(room);
    this.sendState(conn);
  }

  private startGame(uid: string): void {
    this.withRoom(uid, (room) => {
      engine.startGame(room, uid, this.deps);
      track("game_started", {
        rounds: room.totalRounds,
        categories: room.categories.length,
        players: activePlayers(room).length,
      });
      this.broadcast(room);
      // QUESTION -> ANSWERING after the "get ready" beat.
      this.schedule(room, "q2a", TIMERS.QUESTION_TO_ANSWERING, () => {
        if (room.phase !== "QUESTION") return;
        engine.openAnswering(room, this.deps);
        this.broadcast(room);
      });
    });
  }

  private submitAnswer(uid: string, answer: string): void {
    this.withRoom(uid, (room) => {
      const { allSubmitted } = engine.submitAnswer(room, uid, answer, this.deps);
      if (allSubmitted) this.doReveal(room);
      this.broadcast(room);
    });
  }

  private submitVote(uid: string, targetUid: string): void {
    this.withRoom(uid, (room) => {
      const { allVoted } = engine.submitVote(room, uid, targetUid, this.deps);
      if (allVoted) engine.computeResult(room, this.deps);
      this.broadcast(room);
    });
  }

  private nextRound(uid: string): void {
    this.withRoom(uid, (room) => {
      const wasRound = room.currentRound;
      engine.nextRound(room, uid, this.deps);
      if (room.phase === "GAME_OVER") {
        track("game_completed", { rounds: wasRound });
        this.broadcast(room);
        return;
      }
      this.broadcast(room);
      this.schedule(room, "q2a", TIMERS.QUESTION_TO_ANSWERING, () => {
        if (room.phase !== "QUESTION") return;
        engine.openAnswering(room, this.deps);
        this.broadcast(room);
      });
    });
  }

  private kick(hostUid: string, targetUid: string): void {
    this.withRoom(hostUid, (room) => {
      if (room.hostUid !== hostUid) throw new GameError("NOT_HOST");
      if (!room.players.has(targetUid)) throw new GameError("NOT_PLAYER");
      room.players.delete(targetUid);
      this.reconcile(room);
      // Notify and detach the kicked user's sockets.
      for (const c of this.connsByUid.get(targetUid) ?? []) {
        if (c.roomCode === room.code) {
          c.roomCode = null;
          c.send({ t: "KICKED" });
        }
      }
      this.broadcast(room);
    });
  }

  private closeRoom(uid: string): void {
    const room = this.roomOf(uid);
    if (!room) return;
    if (room.hostUid !== uid) throw new GameError("NOT_HOST");
    this.doClose(room, "closed_by_host");
  }

  // ---- transitions helpers ----------------------------------------------

  private doReveal(room: RoomState): void {
    engine.reveal(room, this.deps);
    this.schedule(room, "r2d", TIMERS.REVEAL_TO_DISCUSSION, () => {
      if (room.phase !== "REVEAL") return;
      engine.toDiscussion(room, this.deps);
      this.broadcast(room);
    });
  }

  /**
   * After the active set shrinks (disconnect/leave/kick), a phase may now be
   * complete. Advance accordingly. Safe to call in any phase.
   */
  private reconcile(room: RoomState): void {
    if (room.phase === "ANSWERING" && engine.allAnswered(room)) {
      this.doReveal(room);
    } else if (room.phase === "VOTING" && engine.allVoted(room)) {
      engine.computeResult(room, this.deps);
    }
  }

  private doClose(room: RoomState, reason: string): void {
    room.closed = true;
    room.phase = "CLOSED";
    this.clearTimers(room.code);
    const memberUids = new Set<string>([room.hostUid, ...room.players.keys()]);
    for (const uid of memberUids) {
      for (const c of this.connsByUid.get(uid) ?? []) {
        if (c.roomCode === room.code) {
          c.roomCode = null;
          c.send({ t: "ROOM_CLOSED", reason });
        }
      }
    }
    this.rooms.delete(room.code);
  }

  // ---- broadcasting ------------------------------------------------------

  private broadcast(room: RoomState): void {
    for (const set of this.connsByUid.values()) {
      for (const conn of set) {
        if (conn.roomCode === room.code && conn.uid) {
          conn.send({
            t: "STATE",
            view: buildView(room, conn.uid, this.joinUrl(conn, room.code)),
          });
        }
      }
    }
  }

  /** Send the current state to a single connection (room or idle). */
  private sendState(conn: Connection): void {
    if (!conn.uid) return;
    const room = conn.roomCode ? this.rooms.get(conn.roomCode) : undefined;
    if (room) {
      conn.send({
        t: "STATE",
        view: buildView(room, conn.uid, this.joinUrl(conn, room.code)),
      });
    } else {
      // Minimal idle view so the client knows it's authenticated but roomless.
      conn.send({ t: "HELLO_OK", uid: conn.uid });
    }
  }

  private joinUrl(conn: Connection, code: string): string {
    return `${conn.origin}/join/${code}`;
  }

  // ---- small helpers -----------------------------------------------------

  private withRoom(uid: string, fn: (room: RoomState) => void): void {
    const room = this.roomOf(uid);
    if (!room) throw new GameError("NOT_IN_ROOM");
    fn(room);
  }

  private roomOf(uid: string): RoomState | undefined {
    for (const room of this.rooms.values()) {
      if (room.hostUid === uid || room.players.has(uid)) return room;
    }
    return undefined;
  }

  private attach(uid: string, code: string): void {
    for (const c of this.connsByUid.get(uid) ?? []) c.roomCode = code;
  }

  private detach(uid: string): void {
    for (const c of this.connsByUid.get(uid) ?? []) {
      // Only clear if pointing at a room this uid is no longer part of.
      c.roomCode = null;
    }
  }

  private freshCode(): string {
    for (let i = 0; i < 50; i++) {
      const code = generateCode();
      if (!this.rooms.has(code)) return code;
    }
    throw new GameError("INTERNAL", "could not allocate room code");
  }

  private schedule(room: RoomState, key: string, ms: number, fn: () => void): void {
    let map = this.timers.get(room.code);
    if (!map) this.timers.set(room.code, (map = new Map()));
    const existing = map.get(key);
    if (existing) clearTimeout(existing);
    const h = setTimeout(() => {
      map!.delete(key);
      try {
        fn();
      } catch (e) {
        // eslint-disable-next-line no-console
        console.error("timer error", key, e);
      }
    }, ms);
    map.set(key, h);
  }

  private clearTimers(code: string): void {
    const map = this.timers.get(code);
    if (map) {
      for (const h of map.values()) clearTimeout(h);
      this.timers.delete(code);
    }
  }

  private gcIdleRooms(): void {
    const now = this.deps.now();
    for (const room of [...this.rooms.values()]) {
      const memberUids = new Set<string>([room.hostUid, ...room.players.keys()]);
      let anyConnected = false;
      for (const uid of memberUids) {
        const set = this.connsByUid.get(uid);
        if (set && set.size > 0) {
          anyConnected = true;
          break;
        }
      }
      if (!anyConnected && now - room.updatedAt > IDLE_ROOM_MS) {
        this.clearTimers(room.code);
        this.rooms.delete(room.code);
      }
    }
  }

  // ---- introspection (tests/health) -------------------------------------
  get roomCount(): number {
    return this.rooms.size;
  }
}
