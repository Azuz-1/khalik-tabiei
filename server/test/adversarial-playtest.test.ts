import { test } from "node:test";
import assert from "node:assert/strict";
import type { GamePhase } from "../../shared/types.js";
import { RoomManager } from "../src/game/roomManager.js";
import type { RoomState } from "../src/game/state.js";
import {
  authenticatedConnection,
  createRoom,
  joinPlayer,
  lastMessage,
  wait,
} from "./helpers.js";

async function waitForPhase(
  room: RoomState,
  phase: GamePhase,
  timeoutMs = 400,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && room.phase !== phase) await wait(2);
  assert.equal(room.phase, phase, `expected ${phase}, got ${room.phase}`);
}

function setup(manager: RoomManager, count = 4) {
  const host = createRoom(manager);
  const players = Array.from({ length: count }, (_, index) =>
    joinPlayer(manager, host.code, index + 2),
  );
  const room = manager.roomForTests(host.code)!;
  return { host, players, room };
}

function startGame(
  manager: RoomManager,
  host: ReturnType<typeof createRoom>,
  rounds = 3,
): void {
  manager.handle(host.conn, {
    t: "SET_SETTINGS",
    totalRounds: rounds,
    selectedModes: ["HANDS", "POINT", "NUMBER"],
  });
  manager.handle(host.conn, { t: "START_GAME" });
}

async function advanceToDiscussion(
  manager: RoomManager,
  room: RoomState,
  playerConnections: Array<{ conn: Parameters<RoomManager["handle"]>[0] }>,
): Promise<void> {
  for (const player of playerConnections) manager.handle(player.conn, { t: "MARK_READY" });
  assert.equal(room.phase, "COUNTDOWN");
  await waitForPhase(room, "DISCUSSION");
}

function voteToCatch(
  manager: RoomManager,
  hostConn: Parameters<RoomManager["handle"]>[0],
  room: RoomState,
  playerConnections: Array<{ uid: string; conn: Parameters<RoomManager["handle"]>[0] }>,
): void {
  manager.handle(hostConn, { t: "START_VOTING" });
  const impostorUid = room.round!.impostorUid;
  const firstNormal = playerConnections.find((player) => player.uid !== impostorUid)!;

  for (const player of playerConnections) {
    manager.handle(player.conn, {
      t: "SUBMIT_VOTE",
      targetUid: player.uid === impostorUid ? firstNormal.uid : impostorUid,
    });
  }

  assert.equal(room.phase, "RESULT");
  assert.equal(room.round!.groupFound, true);
  assert.equal(room.round!.roundComplete, true);
}

test("three complete games survive rematches without stale round/game state", async () => {
  const manager = new RoomManager({
    rng: () => 0,
    countdownMs: 2,
    actionMs: 2,
    holdMs: 2,
    promptRevealMs: 2,
  });
  const { host, players, room } = setup(manager, 4);

  for (let game = 1; game <= 3; game += 1) {
    startGame(manager, host, 3);
    assert.equal(room.currentRound, 1);
    assert.equal(room.phase, "QUESTION");
    assert.equal(room.roundOutcomes.length, 0);

    for (let round = 1; round <= 3; round += 1) {
      await advanceToDiscussion(manager, room, players);
      voteToCatch(manager, host.conn, room, players);
      assert.equal(room.currentRound, round);
      manager.handle(host.conn, { t: "NEXT_ROUND" });

      if (round < 3) {
        assert.equal(room.phase, "QUESTION");
        assert.equal(room.currentRound, round + 1);
      }
    }

    assert.equal(room.phase, "GAME_OVER");
    assert.equal(room.roundOutcomes.length, 3);
    assert.ok(room.roundOutcomes.every((outcome) => outcome.caught));

    if (game < 3) {
      manager.handle(host.conn, { t: "REMATCH" });
      assert.equal(room.phase, "LOBBY");
      assert.equal(room.currentRound, 0);
      assert.equal(room.round, null);
      assert.equal(room.roundOutcomes.length, 0);
    }
  }

  manager.dispose();
});

test("player drop and reconnect during COUNTDOWN keeps the exact challenge synchronized", async () => {
  const manager = new RoomManager({
    rng: () => 0,
    countdownMs: 35,
    actionMs: 5,
    holdMs: 5,
    promptRevealMs: 5,
    disconnectGraceMs: 120,
  });
  const { host, players, room } = setup(manager, 4);
  startGame(manager, host, 3);

  for (const player of players) manager.handle(player.conn, { t: "MARK_READY" });
  assert.equal(room.phase, "COUNTDOWN");

  const roundBefore = room.round!;
  const reconnecting = players.find((player) => player.uid !== roundBefore.impostorUid)!;
  const promptId = roundBefore.promptId;
  const mode = roundBefore.mode;

  manager.disconnect(reconnecting.conn);
  let hostView = lastMessage(host.socket, "STATE")!.view;
  assert.equal(hostView.players.find((player) => player.uid === reconnecting.uid)?.connected, false);

  const reconnected = authenticatedConnection(manager, reconnecting.uid);
  hostView = lastMessage(host.socket, "STATE")!.view;
  assert.equal(hostView.players.find((player) => player.uid === reconnecting.uid)?.connected, true);

  await waitForPhase(room, "DISCUSSION");
  assert.equal(room.round, roundBefore);
  assert.equal(room.round!.promptId, promptId);
  assert.equal(room.round!.mode, mode);
  assert.equal(room.currentRound, 1);

  manager.handle(host.conn, { t: "START_VOTING" });
  for (const player of players) {
    const conn = player.uid === reconnecting.uid ? reconnected.conn : player.conn;
    const target = players.find((candidate) => candidate.uid !== player.uid)!.uid;
    manager.handle(conn, { t: "SUBMIT_VOTE", targetUid: target });
  }
  assert.equal(room.phase, "RESULT");
  manager.dispose();
});

test("player disconnect never auto-removes the seat or silently redeals the impostor", async () => {
  const manager = new RoomManager({
    rng: () => 0,
    disconnectGraceMs: 10,
  });
  const { host, players, room } = setup(manager, 4);
  startGame(manager, host, 3);

  const roundBefore = room.round!;
  const leaving = players.find((player) => player.uid !== roundBefore.impostorUid)!;
  const promptId = roundBefore.promptId;
  const impostorUid = roundBefore.impostorUid;

  manager.disconnect(leaving.conn);
  await wait(30);

  assert.equal(room.phase, "QUESTION");
  assert.equal(room.round, roundBefore);
  assert.equal(room.round!.promptId, promptId);
  assert.equal(room.round!.impostorUid, impostorUid);
  assert.equal(room.players.has(leaving.uid), true);
  assert.equal(room.players.get(leaving.uid)?.connected, false);
  assert.equal(room.round!.participantUids.includes(leaving.uid), true);

  const hostView = lastMessage(host.socket, "STATE")!.view;
  assert.equal(hostView.players.find((player) => player.uid === leaving.uid)?.connected, false);
  manager.dispose();
});

test("Host can remove a slow normal player in QUESTION and continue the same challenge", () => {
  const manager = new RoomManager({ rng: () => 0, countdownMs: 40 });
  const { host, players, room } = setup(manager, 4);
  startGame(manager, host, 3);

  const roundBefore = room.round!;
  const slow = players.find((player) => player.uid !== roundBefore.impostorUid)!;
  const promptId = roundBefore.promptId;
  const impostorUid = roundBefore.impostorUid;

  for (const player of players) {
    if (player.uid !== slow.uid) manager.handle(player.conn, { t: "MARK_READY" });
  }
  assert.equal(room.phase, "QUESTION");

  manager.handle(host.conn, { t: "KICK_PLAYER", uid: slow.uid });

  assert.equal(room.players.has(slow.uid), false);
  assert.equal(room.round, roundBefore);
  assert.equal(room.round!.promptId, promptId);
  assert.equal(room.round!.impostorUid, impostorUid);
  assert.equal(room.round!.participantUids.includes(slow.uid), false);
  assert.equal(room.phase, "COUNTDOWN");
  manager.dispose();
});

test("Host can remove a missing normal voter and finish VOTING without a redeal", async () => {
  const manager = new RoomManager({
    rng: () => 0,
    countdownMs: 2,
    actionMs: 2,
    holdMs: 2,
    promptRevealMs: 2,
  });
  const { host, players, room } = setup(manager, 4);
  startGame(manager, host, 3);
  await advanceToDiscussion(manager, room, players);
  manager.handle(host.conn, { t: "START_VOTING" });

  const roundBefore = room.round!;
  const slow = players.find((player) => player.uid !== roundBefore.impostorUid)!;
  const remaining = players.filter((player) => player.uid !== slow.uid);
  const firstNormal = remaining.find((player) => player.uid !== roundBefore.impostorUid)!;

  for (const player of remaining) {
    manager.handle(player.conn, {
      t: "SUBMIT_VOTE",
      targetUid: player.uid === roundBefore.impostorUid ? firstNormal.uid : roundBefore.impostorUid,
    });
  }
  assert.equal(room.phase, "VOTING");
  assert.equal(room.round!.votes.size, 3);

  manager.handle(host.conn, { t: "KICK_PLAYER", uid: slow.uid });

  assert.equal(room.round, roundBefore);
  assert.equal(room.round!.impostorUid, roundBefore.impostorUid);
  assert.equal(room.round!.participantUids.includes(slow.uid), false);
  assert.equal(room.phase, "RESULT");
  assert.equal(room.round!.groupFound, true);
  manager.dispose();
});

test("removing the current impostor is an explicit Lobby reset, never a hidden redeal", () => {
  const manager = new RoomManager({ rng: () => 0 });
  const { host, room } = setup(manager, 4);
  startGame(manager, host, 3);

  const impostorUid = room.round!.impostorUid;
  manager.handle(host.conn, { t: "KICK_PLAYER", uid: impostorUid });

  assert.equal(room.players.has(impostorUid), false);
  assert.equal(room.phase, "LOBBY");
  assert.equal(room.currentRound, 0);
  assert.equal(room.round, null);
  assert.equal(room.impostorHistory.length, 0);
  manager.dispose();
});

test("a normal player's explicit leave does not change the hidden impostor", () => {
  const manager = new RoomManager({ rng: () => 0, countdownMs: 40 });
  const { host, players, room } = setup(manager, 4);
  startGame(manager, host, 3);

  const roundBefore = room.round!;
  const leaving = players.find((player) => player.uid !== roundBefore.impostorUid)!;
  const impostorUid = roundBefore.impostorUid;
  const promptId = roundBefore.promptId;

  manager.handle(leaving.conn, { t: "LEAVE_ROOM" });

  assert.equal(room.players.has(leaving.uid), false);
  assert.equal(room.phase, "QUESTION");
  assert.equal(room.round, roundBefore);
  assert.equal(room.round!.impostorUid, impostorUid);
  assert.equal(room.round!.promptId, promptId);
  assert.equal(room.round!.participantUids.includes(leaving.uid), false);
  manager.dispose();
});

test("host reconnect inside grace keeps the running sequence and room alive", async () => {
  const manager = new RoomManager({
    rng: () => 0,
    countdownMs: 30,
    actionMs: 5,
    holdMs: 5,
    promptRevealMs: 5,
    disconnectGraceMs: 100,
  });
  const { host, players, room } = setup(manager, 3);
  startGame(manager, host, 3);
  for (const player of players) manager.handle(player.conn, { t: "MARK_READY" });
  assert.equal(room.phase, "COUNTDOWN");

  const roundBefore = room.round;
  const promptId = room.round!.promptId;
  manager.disconnect(host.conn);
  await wait(8);
  const hostReconnect = authenticatedConnection(manager, host.uid);

  assert.equal(manager.roomForTests(host.code), room);
  assert.equal(lastMessage(hostReconnect.socket, "STATE")!.view.room.phase, "COUNTDOWN");
  await waitForPhase(room, "DISCUSSION");
  assert.equal(room.round, roundBefore);
  assert.equal(room.round!.promptId, promptId);

  manager.handle(hostReconnect.conn, { t: "START_VOTING" });
  assert.equal(room.phase, "VOTING");
  manager.dispose();
});
