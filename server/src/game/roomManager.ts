/** Authoritative room, connection, timer, and membership orchestration. */
import type { ClientMessage } from "../../../shared/types.js";
import {
  MAX_ACTIVE_ROOMS,
  MAX_CONNECTIONS_PER_UID,
  MAX_PLAYERS,
  TIMERS,
} from "../../../shared/constants.js";
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
  disconnectGraceMs: number;
  countdownMs: number;
  actionMs: number;
  holdMs: number;
  promptRevealMs: number;
  maxRooms: number;
  maxConnectionsPerUid: number;
}

const IDLE_ROOM_MS = 30 * 60 * 1_000;
const GC_INTERVAL_MS = 60_000;
const IMITATION_STAGE_TIMER = "imitation-stage";
const SAFE_REMOVAL_PHASES = new Set(["LOBBY", "GAME_OVER"]);

export class RoomManager {
  private readonly rooms = new Map<string, RoomState>();
  private readonly uidToRoomCode = new Map<string, string>();
  private readonly connsByUid = new Map<string, Set<Connection>>();
  private readonly timers = new Map<string, Map<string, NodeJS.Timeout>>();
  private readonly deps: Deps;
  private readonly gcTimer: NodeJS.Timeout;

  constructor(deps: Partial<Deps> = {}) {
    this.deps = {
      rng: deps.rng ?? Math.random,
      now: deps.now ?? Date.now,
      disconnectGraceMs: deps.disconnectGraceMs ?? TIMERS.DISCONNECT_GRACE,
      countdownMs: deps.countdownMs ?? TIMERS.COUNTDOWN,
      actionMs: deps.actionMs ?? TIMERS.ACTION,
      holdMs: deps.holdMs ?? TIMERS.HOLD,
      promptRevealMs: deps.promptRevealMs ?? TIMERS.PROMPT_REVEAL,
      maxRooms: deps.maxRooms ?? MAX_ACTIVE_ROOMS,
      maxConnectionsPerUid: deps.maxConnectionsPerUid ?? MAX_CONNECTIONS_PER_UID,
    };

    this.gcTimer = setInterval(() => this.gcIdleRooms(), GC_INTERVAL_MS);
    this.gcTimer.unref?.();
  }

  register(conn: Connection): void {
    const uid = conn.uid;
    if (!uid) throw new GameError("UNAUTHORIZED");

    let connections = this.connsByUid.get(uid);
    if (!connections) {
      connections = new Set();
      this.connsByUid.set(uid, connections);
    }
    if (!connections.has(conn) && connections.size >= this.deps.maxConnectionsPerUid) {
      throw new GameError("RATE_LIMITED", "too many connections");
    }
    connections.add(conn);

    const room = this.roomOf(uid);
    if (!room) {
      this.sendState(conn);
      return;
    }

    const player = room.players.get(uid);
    if (player?.pendingRemoval) {
      this.sendState(conn);
      return;
    }

    conn.roomCode = room.code;
    if (player) {
      player.disconnectGeneration += 1;
      player.disconnectedAt = undefined;
      player.connected = true;
      player.lastSeen = this.deps.now();
      this.cancelTimer(room.code, this.disconnectTimerKey(uid));
    } else if (uid === room.hostUid) {
      this.cancelTimer(room.code, this.disconnectTimerKey(uid));
    }

    room.updatedAt = this.deps.now();
    this.broadcast(room);
  }

  disconnect(conn: Connection): void {
    if (!conn.markDisconnected()) return;

    const uid = conn.uid;
    if (!uid) return;

    const roomCode = conn.roomCode ?? this.uidToRoomCode.get(uid) ?? null;
    conn.roomCode = null;

    const connections = this.connsByUid.get(uid);
    connections?.delete(conn);
    if (connections?.size === 0) this.connsByUid.delete(uid);

    if (!roomCode || this.hasRoomConnection(uid, roomCode)) return;

    const room = this.rooms.get(roomCode);
    if (!room || this.uidToRoomCode.get(uid) !== roomCode) return;
    room.updatedAt = this.deps.now();

    if (uid === room.hostUid) {
      this.schedule(room, this.disconnectTimerKey(uid), this.deps.disconnectGraceMs, () => {
        if (
          !this.hasRoomConnection(uid, room.code) &&
          this.uidToRoomCode.get(uid) === room.code
        ) {
          this.doClose(room, "host_disconnect_timeout");
        }
      });
      return;
    }

    const player = room.players.get(uid);
    if (!player) return;

    player.connected = false;
    player.lastSeen = this.deps.now();
    player.disconnectedAt = player.lastSeen;
    player.disconnectGeneration += 1;
    const generation = player.disconnectGeneration;

    this.schedule(room, this.disconnectTimerKey(uid), this.deps.disconnectGraceMs, () => {
      this.expirePlayerDisconnect(room, uid, generation);
    });
    this.broadcast(room);
  }

  handle(conn: Connection, message: ClientMessage): void {
    try {
      this.dispatch(conn, message);
    } catch (error) {
      if (isGameError(error)) {
        conn.send({ t: "ERROR", code: error.code, message: error.message });
      } else {
        console.error("unexpected error handling", message.t, error);
        conn.send({ t: "ERROR", code: "INTERNAL" });
      }
    }
  }

  private dispatch(conn: Connection, message: ClientMessage): void {
    const uid = conn.uid;
    if (!uid) throw new GameError("UNAUTHORIZED");

    switch (message.t) {
      case "HELLO":
        throw new GameError("BAD_REQUEST", "connection already authenticated");
      case "PING":
        conn.send({ t: "PONG" });
        return;
      case "CREATE_ROOM":
        return this.createRoom(uid);
      case "JOIN_ROOM":
        return this.joinRoom(uid, message.code, message.name);
      case "LEAVE_ROOM":
        return this.leaveRoom(uid);
      case "SET_SETTINGS":
        return this.withRoom(uid, (room) => {
          engine.setSettings(room, uid, message, this.deps);
          if (message.categories) {
            track("selected_category", { count: message.categories.length });
          }
          this.broadcast(room);
        });
      case "START_GAME":
        return this.startGame(uid);
      case "MARK_READY":
        return this.markReady(uid);
      case "SUBMIT_ANSWER":
        throw new GameError("INVALID_PHASE");
      case "START_VOTING":
        return this.withRoom(uid, (room) => {
          engine.startVoting(room, uid, this.deps);
          this.broadcast(room);
        });
      case "SUBMIT_VOTE":
        return this.submitVote(uid, message.targetUid);
      case "NEXT_ROUND":
        return this.nextRound(uid);
      case "KICK_PLAYER":
        return this.kick(uid, message.uid);
      case "CLOSE_ROOM":
        return this.closeRoom(uid);
      case "REMATCH":
        return this.withRoom(uid, (room) => {
          if (room.hostUid !== uid) throw new GameError("NOT_HOST");
          if (room.phase !== "GAME_OVER") throw new GameError("INVALID_PHASE");
          this.prunePendingPlayers(room);
          engine.rematch(room, uid, this.deps);
          this.broadcast(room);
        });
    }
  }

  private createRoom(uid: string): void {
    if (this.uidToRoomCode.has(uid)) throw new GameError("ALREADY_IN_ROOM");
    if (this.rooms.size >= this.deps.maxRooms) throw new GameError("RATE_LIMITED");

    const code = this.freshCode();
    const room = createRoomState(code, uid, this.deps.now());
    this.rooms.set(code, room);
    this.uidToRoomCode.set(uid, code);
    this.attachAll(uid, code);
    track("room_created", {});
    this.broadcast(room);
  }

  private joinRoom(uid: string, rawCode: string, rawName: string): void {
    const code = normalizeCode(rawCode);
    const indexedCode = this.uidToRoomCode.get(uid);
    if (indexedCode && indexedCode !== code) throw new GameError("ALREADY_IN_ROOM");

    const room = this.rooms.get(code);
    if (!room || room.closed) throw new GameError("ROOM_NOT_FOUND");
    if (room.phase === "CLOSED") throw new GameError("ROOM_CLOSED");

    if (indexedCode === code) {
      if (uid === room.hostUid) throw new GameError("ALREADY_IN_ROOM");
      const existing = room.players.get(uid);
      if (!existing || existing.pendingRemoval) throw new GameError("ALREADY_IN_ROOM");

      existing.disconnectGeneration += 1;
      existing.disconnectedAt = undefined;
      existing.connected = true;
      existing.lastSeen = this.deps.now();
      this.cancelTimer(code, this.disconnectTimerKey(uid));
      this.attachAll(uid, code);
      this.broadcast(room);
      return;
    }

    if (room.phase !== "LOBBY") throw new GameError("ROOM_NOT_IN_LOBBY");
    if (room.players.size >= MAX_PLAYERS) throw new GameError("ROOM_FULL");

    const name = cleanName(rawName);
    const normalizedName = normalizeArabic(name);
    for (const player of room.players.values()) {
      if (player.normalizedName === normalizedName) throw new GameError("DUPLICATE_NAME");
    }

    const now = this.deps.now();
    const player: InternalPlayer = {
      uid,
      name,
      normalizedName,
      score: 0,
      connected: true,
      joinedAt: now,
      lastSeen: now,
      disconnectGeneration: 0,
      isHost: false,
    };

    room.players.set(uid, player);
    room.updatedAt = now;
    this.uidToRoomCode.set(uid, code);
    this.attachAll(uid, code);
    track("player_count", { count: room.players.size });
    this.broadcast(room);
  }

  private leaveRoom(uid: string): void {
    const room = this.roomOf(uid);
    if (!room) return;

    if (uid === room.hostUid) {
      this.doClose(room, "host_left");
      return;
    }

    if (!SAFE_REMOVAL_PHASES.has(room.phase)) throw new GameError("INVALID_PHASE");
    this.removePlayer(room, uid);
    this.broadcast(room);
    this.sendIdleToUid(uid);
  }

  private startGame(uid: string): void {
    this.withRoom(uid, (room) => {
      engine.startGame(room, uid, this.deps);
      track("game_started", {
        rounds: room.totalRounds,
        modes: room.selectedModes.length,
        players: activePlayers(room).length,
      });
      this.broadcast(room);
    });
  }

  private markReady(uid: string): void {
    this.withRoom(uid, (room) => {
      const { allReady } = engine.markReady(room, uid, this.deps);
      if (allReady) this.beginPhysicalSequence(room);
      this.broadcast(room);
    });
  }

  private beginPhysicalSequence(room: RoomState): void {
    const endsAt = this.deps.now() + this.deps.countdownMs;
    engine.startCountdown(room, endsAt, this.deps);

    this.schedule(room, IMITATION_STAGE_TIMER, this.deps.countdownMs, () => {
      if (room.phase !== "COUNTDOWN") return;
      const actionEndsAt = this.deps.now() + this.deps.actionMs;
      engine.toAction(room, actionEndsAt, this.deps);
      this.broadcast(room);

      this.schedule(room, IMITATION_STAGE_TIMER, this.deps.actionMs, () => {
        if (room.phase !== "ACTION") return;
        const holdEndsAt = this.deps.now() + this.deps.holdMs;
        engine.toHold(room, holdEndsAt, this.deps);
        this.broadcast(room);

        this.schedule(room, IMITATION_STAGE_TIMER, this.deps.holdMs, () => {
          if (room.phase !== "HOLD") return;
          const revealEndsAt = this.deps.now() + this.deps.promptRevealMs;
          engine.revealPrompt(room, revealEndsAt, this.deps);
          this.broadcast(room);

          this.schedule(room, IMITATION_STAGE_TIMER, this.deps.promptRevealMs, () => {
            if (room.phase !== "PROMPT_REVEAL") return;
            engine.toDiscussion(room, this.deps);
            this.broadcast(room);
          });
        });
      });
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
      if (room.hostUid !== uid) throw new GameError("NOT_HOST");
      if (room.phase !== "RESULT") throw new GameError("INVALID_PHASE");

      const wasComplete = room.round?.roundComplete ?? false;
      const wasFinal = wasComplete && room.currentRound >= room.totalRounds;

      if (wasComplete && !wasFinal) {
        this.prunePendingPlayers(room);
        if (activePlayers(room).length < room.minPlayers) {
          engine.abortToLobby(room, this.deps);
          this.broadcast(room);
          return;
        }
      }

      engine.nextRound(room, uid, this.deps);
      if (wasFinal) track("game_completed", { rounds: room.currentRound });
      this.broadcast(room);
    });
  }

  private kick(hostUid: string, targetUid: string): void {
    this.withRoom(hostUid, (room) => {
      if (room.hostUid !== hostUid) throw new GameError("NOT_HOST");
      if (room.phase !== "LOBBY") throw new GameError("INVALID_PHASE");
      if (!room.players.has(targetUid)) throw new GameError("NOT_PLAYER");

      this.removePlayer(room, targetUid);
      for (const conn of this.connsByUid.get(targetUid) ?? []) {
        conn.send({ t: "KICKED" });
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

  private expirePlayerDisconnect(room: RoomState, uid: string, generation: number): void {
    if (this.rooms.get(room.code) !== room || this.uidToRoomCode.get(uid) !== room.code) {
      return;
    }

    const player = room.players.get(uid);
    if (
      !player ||
      player.connected ||
      player.disconnectGeneration !== generation ||
      this.hasRoomConnection(uid, room.code)
    ) {
      return;
    }

    // A survived challenge result is not the end of the round: the same hidden
    // impostor would otherwise carry a stale disconnected seat into the next
    // challenge. Expiry here cancels the incomplete round and redeals challenge
    // 1 with the same round mode if enough players remain.
    if (
      room.phase === "RESULT" &&
      room.round?.kind === "IMITATION" &&
      !room.round.roundComplete
    ) {
      const wasParticipant = room.round.participantUids.includes(uid);
      this.removePlayer(room, uid);
      if (!wasParticipant) {
        this.broadcast(room);
        return;
      }

      if (activePlayers(room).length < room.minPlayers) {
        engine.abortToLobby(room, this.deps);
      } else {
        engine.redealCurrentRound(room, this.deps);
      }
      this.broadcast(room);
      return;
    }

    if (room.phase === "RESULT" || room.phase === "GAME_OVER") {
      player.pendingRemoval = true;
      this.broadcast(room);
      return;
    }

    if (SAFE_REMOVAL_PHASES.has(room.phase)) {
      this.removePlayer(room, uid);
      this.broadcast(room);
      return;
    }

    const wasParticipant = room.round?.participantUids.includes(uid) ?? false;
    this.removePlayer(room, uid);
    if (!wasParticipant) {
      this.broadcast(room);
      return;
    }

    this.cancelTimer(room.code, IMITATION_STAGE_TIMER);
    if (activePlayers(room).length < room.minPlayers) {
      engine.abortToLobby(room, this.deps);
    } else {
      engine.redealCurrentRound(room, this.deps);
    }
    this.broadcast(room);
  }

  private prunePendingPlayers(room: RoomState): void {
    for (const player of [...room.players.values()]) {
      if (player.pendingRemoval) this.removePlayer(room, player.uid);
    }
  }

  private doClose(room: RoomState, reason: string): void {
    room.closed = true;
    room.phase = "CLOSED";
    const memberUids = [room.hostUid, ...room.players.keys()];

    for (const uid of memberUids) {
      for (const conn of this.connsByUid.get(uid) ?? []) {
        if (conn.roomCode === room.code) {
          conn.roomCode = null;
          conn.send({ t: "ROOM_CLOSED", reason });
        }
      }
      if (this.uidToRoomCode.get(uid) === room.code) this.uidToRoomCode.delete(uid);
    }

    this.clearTimers(room.code);
    this.rooms.delete(room.code);
  }

  private broadcast(room: RoomState): void {
    for (const uid of [room.hostUid, ...room.players.keys()]) {
      for (const conn of this.connsByUid.get(uid) ?? []) {
        if (conn.roomCode === room.code && conn.uid) {
          conn.send({
            t: "STATE",
            view: buildView(room, conn.uid, `${conn.origin}/join/${room.code}`),
          });
        }
      }
    }
  }

  private sendState(conn: Connection): void {
    if (!conn.uid) return;
    const room = conn.roomCode ? this.rooms.get(conn.roomCode) : undefined;
    if (room) {
      conn.send({
        t: "STATE",
        view: buildView(room, conn.uid, `${conn.origin}/join/${room.code}`),
      });
    } else {
      conn.send({ t: "HELLO_OK", uid: conn.uid });
    }
  }

  private sendIdleToUid(uid: string): void {
    for (const conn of this.connsByUid.get(uid) ?? []) this.sendState(conn);
  }

  private withRoom(uid: string, fn: (room: RoomState) => void): void {
    const room = this.roomOf(uid);
    if (!room) throw new GameError("NOT_IN_ROOM");
    fn(room);
  }

  private roomOf(uid: string): RoomState | undefined {
    const code = this.uidToRoomCode.get(uid);
    if (!code) return undefined;

    const room = this.rooms.get(code);
    if (!room || (room.hostUid !== uid && !room.players.has(uid))) {
      this.uidToRoomCode.delete(uid);
      return undefined;
    }
    return room;
  }

  private removePlayer(room: RoomState, uid: string): void {
    room.players.delete(uid);
    room.updatedAt = this.deps.now();
    this.cancelTimer(room.code, this.disconnectTimerKey(uid));
    if (this.uidToRoomCode.get(uid) === room.code) this.uidToRoomCode.delete(uid);
    this.detachAll(uid, room.code);
  }

  private attachAll(uid: string, code: string): void {
    for (const conn of this.connsByUid.get(uid) ?? []) conn.roomCode = code;
  }

  private detachAll(uid: string, code: string): void {
    for (const conn of this.connsByUid.get(uid) ?? []) {
      if (conn.roomCode === code) conn.roomCode = null;
    }
  }

  private hasRoomConnection(uid: string, code: string): boolean {
    for (const conn of this.connsByUid.get(uid) ?? []) {
      if (conn.roomCode === code) return true;
    }
    return false;
  }

  private freshCode(): string {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const code = generateCode();
      if (!this.rooms.has(code)) return code;
    }
    throw new GameError("INTERNAL", "could not allocate room code");
  }

  private disconnectTimerKey(uid: string): string {
    return `disconnect:${uid}`;
  }

  private schedule(room: RoomState, key: string, ms: number, fn: () => void): void {
    let roomTimers = this.timers.get(room.code);
    if (!roomTimers) {
      roomTimers = new Map();
      this.timers.set(room.code, roomTimers);
    }
    this.cancelTimer(room.code, key);

    const handle = setTimeout(() => {
      roomTimers?.delete(key);
      if (roomTimers?.size === 0) this.timers.delete(room.code);
      if (this.rooms.get(room.code) !== room) return;

      try {
        fn();
      } catch (error) {
        console.error("timer error", key, error);
      }
    }, ms);

    handle.unref?.();
    roomTimers.set(key, handle);
  }

  private cancelTimer(code: string, key: string): void {
    const roomTimers = this.timers.get(code);
    const handle = roomTimers?.get(key);
    if (handle) clearTimeout(handle);
    roomTimers?.delete(key);
    if (roomTimers?.size === 0) this.timers.delete(code);
  }

  private clearTimers(code: string): void {
    const roomTimers = this.timers.get(code);
    if (!roomTimers) return;
    for (const handle of roomTimers.values()) clearTimeout(handle);
    this.timers.delete(code);
  }

  private gcIdleRooms(): void {
    const now = this.deps.now();
    for (const room of [...this.rooms.values()]) {
      const memberUids = [room.hostUid, ...room.players.keys()];
      const hasConnection = memberUids.some((uid) =>
        this.hasRoomConnection(uid, room.code),
      );
      if (!hasConnection && now - room.updatedAt > IDLE_ROOM_MS) {
        this.clearTimers(room.code);
        for (const uid of memberUids) {
          if (this.uidToRoomCode.get(uid) === room.code) this.uidToRoomCode.delete(uid);
        }
        this.rooms.delete(room.code);
      }
    }
  }

  dispose(): void {
    clearInterval(this.gcTimer);
    for (const code of this.timers.keys()) this.clearTimers(code);
    this.rooms.clear();
    this.uidToRoomCode.clear();
    this.connsByUid.clear();
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  roomForTests(code: string): RoomState | undefined {
    return this.rooms.get(code);
  }

  roomCodeForUidForTests(uid: string): string | undefined {
    return this.uidToRoomCode.get(uid);
  }

  connectionCountForUidForTests(uid: string): number {
    return this.connsByUid.get(uid)?.size ?? 0;
  }

  runGcForTests(): void {
    this.gcIdleRooms();
  }
}
