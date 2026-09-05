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

function weightedRoom(): RoomState {
  const room = createRoomState("ABCDE", "host", 1);
  addPlayer(room, "p1", "واحد");
  addPlayer(room, "p2", "اثنين");
  addPlayer(room, "p3", "ثلاثة");
  room.impostorHistory = ["p2", "p3", "p3"];
  return room;
}

function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

test("weighted impostor selection keeps a positive interval for every active player", () => {
  const room = weightedRoom();
  const total = 1 + 1 / 2 + 1 / 3;
  assert.equal(engine.selectImpostor(room, { now: () => 1, rng: () => 0 }), "p1");
  assert.equal(
    engine.selectImpostor(room, { now: () => 1, rng: () => 1.2 / total }),
    "p2",
  );
  assert.equal(
    engine.selectImpostor(room, { now: () => 1, rng: () => 1.6 / total }),
    "p3",
  );
});

test("the same impostor can legitimately be selected in consecutive rounds", () => {
  const room = createRoomState("ABCDE", "host", 1);
  addPlayer(room, "p1", "واحد");
  addPlayer(room, "p2", "اثنين");
  addPlayer(room, "p3", "ثلاثة");
  room.impostorHistory = ["p1"];
  assert.equal(engine.selectImpostor(room, { now: () => 1, rng: () => 0 }), "p1");
});

test("seeded weighted selection remains broadly balanced without forcing a minimum-only pick", () => {
  const room = createRoomState("ABCDE", "host", 1);
  for (let index = 1; index <= 6; index += 1) addPlayer(room, `p${index}`, `لاعب${index}`);
  const rng = lcg(0x5eed1234);
  const counts = new Map<string, number>();

  for (let round = 0; round < 1_200; round += 1) {
    const uid = engine.selectImpostor(room, { now: () => round, rng });
    room.impostorHistory.push(uid);
    counts.set(uid, (counts.get(uid) ?? 0) + 1);
  }

  assert.equal(counts.size, 6);
  const values = [...counts.values()];
  assert.ok(Math.min(...values) > 150);
  assert.ok(Math.max(...values) - Math.min(...values) < 80);
});

test("rejected mixed settings update is atomic", () => {
  const room = createRoomState("ABCDE", "host", 100);
  room.totalRounds = 5;
  room.selectedModes = ["HANDS", "POINT"];
  room.playStyle = "TEAM";
  room.modeBag = ["NUMBER"];
  room.lastMode = "POINT";
  room.updatedAt = 123;

  assert.throws(
    () =>
      engine.setSettings(
        room,
        "host",
        {
          totalRounds: 7,
          selectedModes: ["NUMBER"],
          playStyle: "INDIVIDUAL",
          categories: ["food"],
        },
        { now: () => 999, rng: () => 0 },
      ),
    /BAD_REQUEST/,
  );

  assert.equal(room.totalRounds, 5);
  assert.deepEqual(room.selectedModes, ["HANDS", "POINT"]);
  assert.equal(room.playStyle, "TEAM");
  assert.deepEqual(room.modeBag, ["NUMBER"]);
  assert.equal(room.lastMode, "POINT");
  assert.equal(room.updatedAt, 123);
});

function directResultRoom(): RoomState {
  const room = createRoomState("ABCDE", "host", 1);
  for (let index = 1; index <= 4; index += 1) addPlayer(room, `p${index}`, `لاعب${index}`);
  room.totalRounds = 3;
  engine.startGame(room, "host", { now: () => 2, rng: () => 0 });
  for (const uid of room.round!.participantUids) engine.markReady(room, uid, { now: () => 3, rng: () => 0 });
  engine.startCountdown(room, 10, { now: () => 3, rng: () => 0 });
  engine.toAction(room, 11, { now: () => 3, rng: () => 0 });
  engine.toHold(room, 12, { now: () => 3, rng: () => 0 });
  engine.revealPrompt(room, 13, { now: () => 3, rng: () => 0 });
  engine.toDiscussion(room, { now: () => 3, rng: () => 0 });
  engine.startVoting(room, "host", { now: () => 3, rng: () => 0 });
  const impostor = room.round!.impostorUid;
  const normals = room.round!.participantUids.filter((uid) => uid !== impostor);
  for (const normal of normals) engine.submitVote(room, normal, impostor, { now: () => 4, rng: () => 0 });
  engine.submitVote(room, impostor, normals[0]!, { now: () => 4, rng: () => 0 });
  engine.computeResult(room, { now: () => 5, rng: () => 0 });
  return room;
}

test("result snapshots exist before the first view and buildView is pure", () => {
  const room = directResultRoom();
  const round = room.round!;
  assert.equal(round.resultRequiredVotes, 3);
  assert.equal(round.resultVoteTally?.length, 4);
  const frozenName = round.resultImpostorName;
  const frozenTally = JSON.stringify(round.resultVoteTally);
  const updatedAt = room.updatedAt;

  room.players.delete(round.participantUids[1]!);
  const first = buildView(room, "host", "https://example.test/join/ABCDE");
  const second = buildView(room, "host", "https://example.test/join/ABCDE");

  assert.equal(first.result?.impostorName, frozenName);
  assert.equal(JSON.stringify(first.result?.voteTally), frozenTally);
  assert.deepEqual(second, first);
  assert.equal(room.updatedAt, updatedAt);
  assert.equal(round.resultImpostorName, frozenName);
  assert.equal(JSON.stringify(round.resultVoteTally), frozenTally);
});

async function completeManagerResult(playerCount = 3) {
  const manager = new RoomManager({
    rng: () => 0,
    countdownMs: 2,
    actionMs: 2,
    holdMs: 2,
    promptRevealMs: 2,
  });
  const host = createRoom(manager);
  const players = Array.from({ length: playerCount }, (_, index) =>
    joinPlayer(manager, host.code, index + 2),
  );
  const room = manager.roomForTests(host.code)!;
  manager.handle(host.conn, { t: "START_GAME" });
  for (const player of players) manager.handle(player.conn, { t: "MARK_READY" });
  const deadline = Date.now() + 300;
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

test("completed RESULT survives removal below three and final NEXT_ROUND still reaches GAME_OVER", async () => {
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

test("non-final completed RESULT warns and abandons cleanly when connected players are insufficient", async () => {
  const { manager, host, room, normals } = await completeManagerResult(3);
  manager.handle(host.conn, { t: "KICK_PLAYER", uid: normals[0]!.uid });
  const view = lastMessage(host.socket, "STATE")!.view;
  assert.match(view.nextRoundWarning ?? "", /نحتاج 3 لاعبين/);
  assert.ok(room.roundOutcomes.length > 0);

  manager.handle(host.conn, { t: "NEXT_ROUND" });
  assert.equal(room.phase, "LOBBY");
  assert.equal(room.round, null);
  assert.deepEqual(room.roundOutcomes, []);
  assert.equal(room.pendingRoundScores.size, 0);
  assert.equal(room.usedPromptIds.size, 0);
  assert.ok([...room.players.values()].every((player) => player.score === 0));
  manager.dispose();
});

test("QUESTION accepts ready while Host is absent but countdown waits for reconnect", () => {
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
  assert.equal(room.pause, undefined);
  manager.dispose();
});

test("COUNTDOWN/ACTION/HOLD reconnect restarts the same Challenge from COUNTDOWN", () => {
  for (const phase of ["COUNTDOWN", "ACTION", "HOLD"] as const) {
    const manager = new RoomManager({ rng: () => 0, countdownMs: 10_000, actionMs: 10_000, holdMs: 10_000 });
    const host = createRoom(manager);
    const players = [2, 3, 4].map((index) => joinPlayer(manager, host.code, index));
    const room = manager.roomForTests(host.code)!;
    manager.handle(host.conn, { t: "START_GAME" });
    const promptId = room.round!.promptId;
    const mode = room.round!.mode;
    const impostorUid = room.round!.impostorUid;
    const deps = { now: () => Date.now(), rng: () => 0 };
    engine.startCountdown(room, Date.now() + 10_000, deps);
    if (phase === "ACTION" || phase === "HOLD") engine.toAction(room, Date.now() + 10_000, deps);
    if (phase === "HOLD") engine.toHold(room, Date.now() + 10_000, deps);

    manager.disconnect(host.conn);
    assert.equal(room.pause?.originalPhase, phase);
    authenticatedConnection(manager, host.uid);
    assert.equal(room.phase, "COUNTDOWN");
    assert.equal(room.round!.promptId, promptId);
    assert.equal(room.round!.mode, mode);
    assert.equal(room.round!.impostorUid, impostorUid);
    assert.deepEqual(room.round!.participantUids, players.map((player) => player.uid));
    manager.dispose();
  }
});

test("PROMPT_REVEAL resumes forward from remaining time and DISCUSSION stays put", () => {
  let now = 1_000;
  const manager = new RoomManager({
    rng: () => 0,
    now: () => now,
    promptRevealMs: 10_000,
  });
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
  authenticatedConnection(manager, host.uid);
  assert.equal(room.phase, "PROMPT_REVEAL");
  assert.equal(room.phaseEndsAt, now + 5_000);

  engine.toDiscussion(room, deps);
  const reconnect = authenticatedConnection(manager, host.uid);
  manager.disconnect(reconnect.conn);
  assert.equal(room.phase, "DISCUSSION");
  authenticatedConnection(manager, host.uid);
  assert.equal(room.phase, "DISCUSSION");
  manager.dispose();
});

test("last vote while Host is absent seals ballot; later leave cannot rewrite published RESULT", () => {
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
  assert.equal(room.round!.resultComputed, false);
  const sealedNames = room.round!.sealedParticipants!.map((player) => player.name);

  manager.handle(normals[1]!.conn, { t: "LEAVE_ROOM" });
  assert.equal(room.phase, "VOTING");
  authenticatedConnection(manager, host.uid);
  assert.equal(room.phase, "RESULT");
  assert.equal(room.round!.resultRequiredVotes, 3);
  assert.deepEqual(room.round!.resultVoteTally!.map((row) => row.name), sealedNames);
  manager.dispose();
});

test("RESULT reconnect does not recompute or duplicate INDIVIDUAL scoring", async () => {
  const { manager, host, room } = await completeManagerResult(4);
  room.playStyle = "INDIVIDUAL";
  const scores = new Map([...room.players].map(([uid, player]) => [uid, player.score]));
  const outcomeCount = room.roundOutcomes.length;
  manager.disconnect(host.conn);
  authenticatedConnection(manager, host.uid);
  assert.equal(room.phase, "RESULT");
  assert.deepEqual(new Map([...room.players].map(([uid, player]) => [uid, player.score])), scores);
  assert.equal(room.roundOutcomes.length, outcomeCount);
  manager.dispose();
});

test("stale physical timer cannot revive a game after an explicit abort", async () => {
  const manager = new RoomManager({
    rng: () => 0,
    countdownMs: 5,
    actionMs: 5,
    holdMs: 5,
    promptRevealMs: 5,
  });
  const host = createRoom(manager);
  const players = [2, 3, 4].map((index) => joinPlayer(manager, host.code, index));
  const room = manager.roomForTests(host.code)!;
  manager.handle(host.conn, { t: "START_GAME" });
  for (const player of players) manager.handle(player.conn, { t: "MARK_READY" });
  assert.equal(room.phase, "COUNTDOWN");
  manager.disconnect(host.conn);
  const impostor = players.find((player) => player.uid === room.round!.impostorUid)!;
  manager.handle(impostor.conn, { t: "LEAVE_ROOM" });
  assert.equal(room.phase, "LOBBY");
  await wait(40);
  assert.equal(room.phase, "LOBBY");
  manager.dispose();
});

test("one Host tab closing does not pause while another authenticated Host tab remains", () => {
  const manager = new RoomManager({ rng: () => 0 });
  const host = createRoom(manager);
  [2, 3, 4].forEach((index) => joinPlayer(manager, host.code, index));
  const second = authenticatedConnection(manager, testUid(1));
  const room = manager.roomForTests(host.code)!;
  manager.disconnect(host.conn);
  assert.equal(room.hostConnected, true);
  assert.equal(room.pause, undefined);
  manager.disconnect(second.conn);
  assert.equal(room.hostConnected, false);
  assert.equal(room.pause?.reason, "HOST_DISCONNECTED");
  manager.dispose();
});
