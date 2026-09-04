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

test("grace expiry during ACTION cancels the stale stage timer before redeal", async () => {
  const manager = new RoomManager({
    rng: () => 0,
    countdownMs: 2,
    actionMs: 70,
    holdMs: 70,
    promptRevealMs: 70,
    disconnectGraceMs: 12,
  });
  const { host, players, room } = setup(manager, 4);
  startGame(manager, host, 3);
  for (const player of players) manager.handle(player.conn, { t: "MARK_READY" });
  await waitForPhase(room, "ACTION");

  const oldRound = room.round!;
  const oldMode = oldRound.mode;
  const leaving = players.find((player) => player.uid !== oldRound.impostorUid)!;
  manager.disconnect(leaving.conn);

  await wait(25);
  assert.equal(room.phase, "QUESTION");
  assert.equal(room.players.has(leaving.uid), false);
  assert.notEqual(room.round, oldRound);
  assert.equal(room.round!.challengeIndex, 1);
  assert.equal(room.round!.mode, oldMode);
  assert.notEqual(room.round!.promptId, oldRound.promptId);

  // If the old ACTION timer was not cancelled, it would move this fresh deal
  // into HOLD later without anybody pressing Ready.
  await wait(80);
  assert.equal(room.phase, "QUESTION");
  assert.equal(room.round!.readyUids.size, 0);

  const hostView = lastMessage(host.socket, "STATE")!.view;
  assert.equal(hostView.publicPrompt, undefined);
  assert.equal(hostView.myPrompt, undefined);
  manager.dispose();
});

test("vote-stage disconnect expiry clears stale votes and live tally before redeal", async () => {
  const manager = new RoomManager({
    rng: () => 0,
    countdownMs: 2,
    actionMs: 2,
    holdMs: 2,
    promptRevealMs: 2,
    disconnectGraceMs: 12,
  });
  const { host, players, room } = setup(manager, 4);
  startGame(manager, host, 3);
  await advanceToDiscussion(manager, room, players);
  manager.handle(host.conn, { t: "START_VOTING" });

  manager.handle(players[0].conn, {
    t: "SUBMIT_VOTE",
    targetUid: players[1].uid,
  });
  assert.equal(room.round!.votes.size, 1);
  assert.equal(lastMessage(host.socket, "STATE")!.view.votesProgress?.submitted, 1);

  const leaving = players[2];
  manager.disconnect(leaving.conn);
  await wait(25);

  assert.equal(room.phase, "QUESTION");
  assert.equal(room.players.has(leaving.uid), false);
  assert.equal(room.round!.votes.size, 0);
  assert.equal(room.round!.resultComputed, false);
  assert.equal(room.round!.participantUids.length, 3);

  const hostView = lastMessage(host.socket, "STATE")!.view;
  assert.equal(hostView.liveVoteTally, undefined);
  assert.equal(hostView.votesProgress, undefined);
  assert.equal(hostView.publicPrompt, undefined);
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
