import { test } from "node:test";
import assert from "node:assert/strict";
import * as engine from "../src/game/engine.js";
import { buildView } from "../src/game/view.js";
import {
  createRoomState,
  type InternalPlayer,
  type RoomState,
} from "../src/game/state.js";
import { RoomManager } from "../src/game/roomManager.js";
import {
  authenticatedConnection,
  createRoom,
  joinPlayer,
  lastMessage,
  testUid,
  wait,
} from "./helpers.js";

function addPlayer(room: RoomState, uid: string, name: string): void {
  const player: InternalPlayer = {
    uid,
    name,
    normalizedName: name,
    score: 0,
    connected: true,
    joinedAt: 1,
    lastSeen: 1,
    disconnectGeneration: 0,
    isHost: false,
  };
  room.players.set(uid, player);
}

function baseRoom(count = 4): RoomState {
  const room = createRoomState("ABCDE", "host", 1);
  for (let index = 1; index <= count; index += 1) {
    addPlayer(room, `p${index}`, `لاعب${index}`);
  }
  room.totalRounds = 3;
  return room;
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

test("weighted impostor selector gives every active player positive-width tickets", () => {
  const room = baseRoom(3);
  room.impostorHistory = ["p2", "p3", "p3"];
  const total = 1 + 1 / 2 + 1 / 3;
  assert.equal(engine.selectImpostor(room, { now: () => 1, rng: () => 0 }), "p1");
  assert.equal(engine.selectImpostor(room, { now: () => 1, rng: () => 1.2 / total }), "p2");
  assert.equal(engine.selectImpostor(room, { now: () => 1, rng: () => 1.6 / total }), "p3");
});

test("consecutive impostor selection remains possible", () => {
  const room = baseRoom(3);
  room.impostorHistory = ["p1"];
  assert.equal(engine.selectImpostor(room, { now: () => 1, rng: () => 0.01 }), "p1");
});

test("seeded weighted selection stays broadly balanced without min-only forcing", () => {
  const room = baseRoom(6);
  const rng = lcg(0x5eed1234);
  const counts = new Map<string, number>();
  for (let round = 0; round < 1_200; round += 1) {
    const uid = engine.selectImpostor(room, { now: () => round, rng });
    room.impostorHistory.push(uid);
    counts.set(uid, (counts.get(uid) ?? 0) + 1);
  }
  const values = [...counts.values()];
  assert.equal(values.length, 6);
  assert.ok(Math.min(...values) > 150);
  assert.ok(Math.max(...values) - Math.min(...values) < 80);
});

test("mixed rejected settings update is atomic", () => {
  const room = baseRoom();
  room.totalRounds = 5;
  room.selectedModes = ["HANDS", "POINT"];
  room.playStyle = "TEAM";
  room.modeBag = ["NUMBER"];
  room.lastMode = "POINT";
  room.updatedAt = 123;
  assert.throws(
    () => engine.setSettings(room, "host", {
      totalRounds: 7,
      selectedModes: ["NUMBER"],
      playStyle: "INDIVIDUAL",
      categories: ["food"],
    }, { now: () => 999, rng: () => 0 }),
    /BAD_REQUEST/,
  );
  assert.equal(room.totalRounds, 5);
  assert.deepEqual(room.selectedModes, ["HANDS", "POINT"]);
  assert.equal(room.playStyle, "TEAM");
  assert.deepEqual(room.modeBag, ["NUMBER"]);
  assert.equal(room.lastMode, "POINT");
  assert.equal(room.updatedAt, 123);
});

function resolvedRoom(): RoomState {
  const room = baseRoom(4);
  const deps = { now: () => 5, rng: () => 0 };
  engine.startGame(room, "host", deps);
  for (const uid of room.round!.participantUids) engine.markReady(room, uid, deps);
  engine.startCountdown(room, 10, deps);
  engine.toAction(room, 11, deps);
  engine.toHold(room, 12, deps);
  engine.revealPrompt(room, 13, deps);
  engine.toDiscussion(room, deps);
  engine.startVoting(room, "host", deps);
  const impostor = room.round!.impostorUid;
  const normals = room.round!.participantUids.filter((uid) => uid !== impostor);
  for (const normal of normals) engine.submitVote(room, normal, impostor, deps);
  engine.submitVote(room, impostor, normals[0]!, deps);
  engine.computeResult(room, deps);
  return room;
}

test("result snapshots are authoritative before first projection and buildView is pure", () => {
  const room = resolvedRoom();
  const round = room.round!;
  const snapshot = {
    threshold: round.resultRequiredVotes,
    name: round.resultImpostorName,
    tally: JSON.stringify(round.resultVoteTally),
    updatedAt: room.updatedAt,
  };
  assert.equal(snapshot.threshold, 3);
  assert.equal(round.resultVoteTally?.length, 4);
  room.players.delete(round.participantUids[1]!);
  const first = buildView(room, "host", "https://example.test/join/ABCDE");
  const second = buildView(room, "host", "https://example.test/join/ABCDE");
  assert.deepEqual(second, first);
  assert.equal(first.result?.requiredVotes, snapshot.threshold);
  assert.equal(first.result?.impostorName, snapshot.name);
  assert.equal(JSON.stringify(first.result?.voteTally), snapshot.tally);
  assert.equal(room.updatedAt, snapshot.updatedAt);
});

async function completeManagerResult(playerCount = 3) {
  const manager = new RoomManager({ rng: () => 0, countdownMs: 2, actionMs: 2, holdMs: 2, promptRevealMs: 2 });
  const host = createRoom(manager);
  const players = Array.from({ length: playerCount }, (_, index) => joinPlayer(manager, host.code, index + 2));
  const room = manager.roomForTests(host.code)!;
  manager.handle(host.conn, { t: "START_GAME" });
  for (const player of players) manager.handle(player.conn, { t: "MARK_READY" });
  const deadline = Date.now() + 400;
  while (room.phase !== "DISCUSSION" && Date.now() < deadline) await wait(2);
  assert.equal(room.phase, "DISCUSSION");
  manager.handle(host.conn, { t: "START_VOTING" });
  const impostor = players.find((player) => player.uid === room.round!.impostorUid)!;
  const normals = players.filter((player) => player.uid !== impostor.uid);
  for (const normal of normals) manager.handle(normal.conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
  manager.handle(impostor.conn, { t: "SUBMIT_VOTE", targetUid: normals[0]!.uid });
  assert.equal(room.phase, "RESULT");
  return { manager, host, players, room, impostor, normals };
}

test("completed RESULT survives removal below minimum and final advance reaches GAME_OVER", async () => {
  const { manager, host, room, normals } = await completeManagerResult(3);
  const historical = JSON.stringify(lastMessage(host.socket, "STATE")!.view.result);
  manager.handle(host.conn, { t: "KICK_PLAYER", uid: normals[0]!.uid });
  assert.equal(room.phase, "RESULT");
  assert.equal(JSON.stringify(lastMessage(host.socket, "STATE")!.view.result), historical);
  room.currentRound = room.totalRounds;
  manager.handle(host.conn, { t: "NEXT_ROUND" });
  assert.equal(room.phase, "GAME_OVER");
  manager.dispose();
});

test("non-final insufficient roster warns then abandons/reset match only on Host advance", async () => {
  const { manager, host, room, normals } = await completeManagerResult(3);
  manager.handle(host.conn, { t: "KICK_PLAYER", uid: normals[0]!.uid });
  assert.equal(room.phase, "RESULT");
  assert.match(lastMessage(host.socket, "STATE")!.view.nextRoundWarning ?? "", /نحتاج 3 لاعبين/);
  manager.handle(host.conn, { t: "NEXT_ROUND" });
  assert.equal(room.phase, "LOBBY");
  assert.equal(room.round, null);
  assert.deepEqual(room.roundOutcomes, []);
  assert.equal(room.pendingRoundScores.size, 0);
  assert.equal(room.usedPromptIds.size, 0);
  assert.ok([...room.players.values()].every((player) => player.score === 0));
  manager.dispose();
});

test("QUESTION records ready while Host is absent but does not start countdown", () => {
  const manager = new RoomManager({ rng: () => 0, countdownMs: 10_000 });
  const host = createRoom(manager);
  const players = [2, 3, 4].map((index) => joinPlayer(manager, host.code, index));
  const room = manager.roomForTests(host.code)!;
  manager.handle(host.conn, { t: "START_GAME" });
  manager.disconnect(host.conn);
  for (const player of players) manager.handle(player.conn, { t: "MARK_READY" });
  assert.equal(room.phase, "QUESTION");
  assert.equal(room.pause?.originalPhase, "QUESTION");
  assert.ok(room.hostCloseDeadline);
  authenticatedConnection(manager, host.uid);
  assert.equal(room.phase, "COUNTDOWN");
  manager.dispose();
});

test("COUNTDOWN ACTION and HOLD restart same physical Challenge from preparation countdown", () => {
  for (const phase of ["COUNTDOWN", "ACTION", "HOLD"] as const) {
    const manager = new RoomManager({ rng: () => 0, countdownMs: 10_000, actionMs: 10_000, holdMs: 10_000 });
    const host = createRoom(manager);
    [2, 3, 4].forEach((index) => joinPlayer(manager, host.code, index));
    const room = manager.roomForTests(host.code)!;
    manager.handle(host.conn, { t: "START_GAME" });
    const before = { promptId: room.round!.promptId, mode: room.round!.mode, impostor: room.round!.impostorUid, participants: [...room.round!.participantUids] };
    const deps = { now: () => Date.now(), rng: () => 0 };
    engine.startCountdown(room, Date.now() + 10_000, deps);
    if (phase !== "COUNTDOWN") engine.toAction(room, Date.now() + 10_000, deps);
    if (phase === "HOLD") engine.toHold(room, Date.now() + 10_000, deps);
    manager.disconnect(host.conn);
    assert.equal(room.pause?.originalPhase, phase);
    authenticatedConnection(manager, host.uid);
    assert.equal(room.phase, "COUNTDOWN");
    assert.deepEqual({ promptId: room.round!.promptId, mode: room.round!.mode, impostor: room.round!.impostorUid, participants: room.round!.participantUids }, before);
    manager.dispose();
  }
});

test("PROMPT_REVEAL never rolls back and DISCUSSION remains forward-only", () => {
  let now = 1_000;
  const manager = new RoomManager({ rng: () => 0, now: () => now, promptRevealMs: 10_000 });
  const host = createRoom(manager);
  [2, 3, 4].forEach((index) => joinPlayer(manager, host.code, index));
  const room = manager.roomForTests(host.code)!;
  manager.handle(host.conn, { t: "START_GAME" });
  const deps = { now: () => now, rng: () => 0 };
  engine.startCountdown(room, now + 1, deps);
  engine.toAction(room, now + 1, deps);
  engine.toHold(room, now + 1, deps);
  engine.revealPrompt(room, now + 8_000, deps);
  now += 3_000;
  manager.disconnect(host.conn);
  assert.equal(room.pause?.remainingMs, 5_000);
  now += 500;
  const resumed = authenticatedConnection(manager, host.uid);
  assert.equal(room.phase, "PROMPT_REVEAL");
  assert.equal(room.phaseEndsAt, now + 5_000);
  engine.toDiscussion(room, deps);
  manager.disconnect(resumed.conn);
  assert.equal(room.phase, "DISCUSSION");
  authenticatedConnection(manager, host.uid);
  assert.equal(room.phase, "DISCUSSION");
  manager.dispose();
});

test("last offline vote seals participant set and later leave cannot rewrite outcome", () => {
  const manager = new RoomManager({ rng: () => 0 });
  const host = createRoom(manager);
  const players = [2, 3, 4, 5].map((index) => joinPlayer(manager, host.code, index));
  const room = manager.roomForTests(host.code)!;
  manager.handle(host.conn, { t: "START_GAME" });
  const deps = { now: () => Date.now(), rng: () => 0 };
  engine.startCountdown(room, Date.now() + 1, deps);
  engine.toAction(room, Date.now() + 1, deps);
  engine.toHold(room, Date.now() + 1, deps);
  engine.revealPrompt(room, Date.now() + 1, deps);
  engine.toDiscussion(room, deps);
  manager.handle(host.conn, { t: "START_VOTING" });
  manager.disconnect(host.conn);
  const impostor = players.find((player) => player.uid === room.round!.impostorUid)!;
  const normals = players.filter((player) => player.uid !== impostor.uid);
  for (const normal of normals) manager.handle(normal.conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
  manager.handle(impostor.conn, { t: "SUBMIT_VOTE", targetUid: normals[0]!.uid });
  assert.equal(room.phase, "VOTING");
  assert.equal(room.round!.resolutionSealed, true);
  const sealedNames = room.round!.sealedParticipants!.map((player) => player.name);
  manager.handle(normals[1]!.conn, { t: "LEAVE_ROOM" });
  authenticatedConnection(manager, host.uid);
  assert.equal(room.phase, "RESULT");
  assert.equal(room.round!.resultRequiredVotes, 3);
  assert.deepEqual(room.round!.resultVoteTally!.map((row) => row.name), sealedNames);
  manager.dispose();
});

test("stale physical callbacks cannot revive an explicitly aborted game", async () => {
  const manager = new RoomManager({ rng: () => 0, countdownMs: 5, actionMs: 5, holdMs: 5, promptRevealMs: 5 });
  const host = createRoom(manager);
  const players = [2, 3, 4].map((index) => joinPlayer(manager, host.code, index));
  const room = manager.roomForTests(host.code)!;
  manager.handle(host.conn, { t: "START_GAME" });
  for (const player of players) manager.handle(player.conn, { t: "MARK_READY" });
  manager.disconnect(host.conn);
  const impostor = players.find((player) => player.uid === room.round!.impostorUid)!;
  manager.handle(impostor.conn, { t: "LEAVE_ROOM" });
  assert.equal(room.phase, "LOBBY");
  await wait(40);
  assert.equal(room.phase, "LOBBY");
  manager.dispose();
});

test("one Host tab closing does not pause while another Host tab is live", () => {
  const manager = new RoomManager({ rng: () => 0 });
  const host = createRoom(manager);
  [2, 3, 4].forEach((index) => joinPlayer(manager, host.code, index));
  const second = authenticatedConnection(manager, testUid(1));
  const room = manager.roomForTests(host.code)!;
  manager.disconnect(host.conn);
  assert.equal(room.hostConnected, true);
  assert.equal(room.pause, undefined);
  manager.disconnect(second.conn);
  const after = manager.roomForTests(host.code)!;
  assert.equal(after.hostConnected, false);
  assert.equal(after.pause?.reason, "HOST_DISCONNECTED");
  manager.dispose();
});
