import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import * as engine from "../src/game/engine.js";
import { RoomManager } from "../src/game/roomManager.js";
import { createRoomState, type InternalPlayer, type RoomState } from "../src/game/state.js";
import { buildView } from "../src/game/view.js";
import {
  authenticatedConnection,
  createRoom,
  joinPlayer,
  lastMessage,
  wait,
} from "./helpers.js";

const deps = { rng: () => 0, now: () => 1_000 };

function addPlayer(room: RoomState, index: number): InternalPlayer {
  const player: InternalPlayer = {
    uid: `p${index}`,
    name: `لاعب${index}`,
    normalizedName: `لاعب${index}`,
    seatNumber: index,
    score: 0,
    connected: true,
    joinedAt: 1,
    lastSeen: 1,
    disconnectGeneration: 0,
    isHost: false,
  };
  room.players.set(player.uid, player);
  return player;
}

function roomWith(count = 4): RoomState {
  const room = createRoomState("ABCDE", "host", 1_000);
  for (let index = 1; index <= count; index += 1) addPlayer(room, index);
  return room;
}

function toVoting(room: RoomState): void {
  for (const uid of room.round!.participantUids) engine.markReady(room, uid, deps);
  engine.startCountdown(room, 6_000, deps);
  engine.toAction(room, 2_000, deps);
  engine.toHold(room, 3_000, deps);
  engine.revealPrompt(room, 3_500, deps);
  engine.toDiscussion(room, deps);
  engine.startVoting(room, "host", deps);
}

function submitVotes(room: RoomState, targets: Record<string, string>): void {
  for (const voterUid of room.round!.participantUids) {
    engine.submitVote(room, voterUid, targets[voterUid], deps);
  }
  engine.computeResult(room, deps);
}

function assertNoScoreLeak(view: ReturnType<typeof buildView>): void {
  assert.equal(view.scoreboard, undefined);
  const json = JSON.stringify(view);
  assert.equal(json.includes("roundDelta"), false);
  assert.equal(json.includes("pendingRoundScores"), false);
  assert.equal(json.includes("correctVoteStreakStart"), false);
}

function assertNoVoteMapping(view: ReturnType<typeof buildView>): void {
  const json = JSON.stringify(view);
  assert.equal(json.includes("voterUid"), false);
  assert.equal(json.includes("voterName"), false);
  assert.equal(json.includes("targetUid"), false);
  assert.equal(json.includes("voteBreakdown"), false);
}

test("single product ruleset starts as competitive INDIVIDUAL scoring", () => {
  const room = roomWith(4);
  assert.equal(room.playStyle, "INDIVIDUAL");
  engine.startGame(room, "host", deps);
  assert.equal(room.playStyle, "INDIVIDUAL");
  assert.equal(room.targetChallenges, 9);
  assert.equal(room.round?.maxChallenges, 3);

  toVoting(room);
  const round = room.round!;
  const impostor = round.impostorUid;
  const normals = round.participantUids.filter((uid) => uid !== impostor);
  submitVotes(room, {
    [normals[0]]: impostor,
    [normals[1]]: impostor,
    [normals[2]]: impostor,
    [impostor]: normals[0],
  });

  assert.equal(round.groupFound, true);
  assert.equal(round.roundComplete, true);
  for (const uid of normals) assert.equal(room.players.get(uid)?.score, 1);
  assert.equal(room.players.get(impostor)?.score, 0);

  const view = buildView(room, "host", "http://game/join/ABCDE");
  assert.ok(view.scoreboard);
  assert.equal(view.scoreboard.filter((row) => row.roundDelta === 1).length, normals.length);
  assertNoVoteMapping(view);
});

test("legacy playStyle setting cannot change the active match", () => {
  const room = roomWith();
  engine.setSettings(room, "host", { playStyle: "TEAM" }, deps);
  assert.equal(room.playStyle, "TEAM", "legacy protocol remains parse-compatible in Lobby");
  engine.startGame(room, "host", deps);
  assert.equal(room.playStyle, "INDIVIDUAL", "the product starts the one competitive ruleset");
  assert.throws(() => engine.setSettings(room, "host", { playStyle: "TEAM" }, deps), /INVALID_PHASE/);
});

test("correct-vote streak state and pending points stay server-only until the impostor stint ends", () => {
  const room = roomWith(4);
  engine.startGame(room, "host", deps);
  toVoting(room);

  const round = room.round!;
  const impostor = round.impostorUid;
  const normals = round.participantUids.filter((uid) => uid !== impostor);
  submitVotes(room, {
    [normals[0]]: impostor,
    [normals[1]]: impostor,
    [normals[2]]: normals[0],
    [impostor]: normals[0],
  });

  assert.equal(round.groupFound, false);
  assert.equal(round.roundComplete, false);
  assert.equal(room.correctVoteStreakStart.get(normals[0]), 1);
  assert.equal(room.correctVoteStreakStart.get(normals[1]), 1);
  assert.ok([...room.players.values()].every((player) => player.score === 0));
  for (const uid of ["host", ...round.participantUids]) {
    assertNoScoreLeak(buildView(room, uid, "http://game/join/ABCDE"));
  }
});

test("GAME_OVER exposes final ranking with shared ranks and no vote mapping", () => {
  const room = roomWith(3);
  room.phase = "GAME_OVER";
  room.players.get("p1")!.score = 5;
  room.players.get("p2")!.score = 5;
  room.players.get("p3")!.score = 2;
  room.completedChallenges = 10;
  room.roundOutcomes = [
    { roundIndex: 1, caught: true, challengeIndex: 1 },
    { roundIndex: 2, caught: false, challengeIndex: 2 },
  ];

  const view = buildView(room, "host", "http://game/join/ABCDE");
  assert.ok(view.scoreboard);
  const leaders = view.scoreboard.filter((row) => row.score === 5);
  assert.equal(leaders.length, 2);
  assert.equal(leaders[0]?.rank, 1);
  assert.equal(leaders[1]?.rank, 1);
  assert.equal(view.gameOver?.completedChallenges, 10);
  assertNoVoteMapping(view);
});

test("rematch keeps competitive mode but resets scores and hidden streak state", () => {
  const room = roomWith(3);
  room.phase = "GAME_OVER";
  room.players.get("p1")!.score = 4;
  room.players.get("p2")!.score = 2;
  room.pendingRoundScores.set("p1", 1);
  room.correctVoteStreakStart.set("p1", 1);

  engine.rematch(room, "host", deps);

  assert.equal(room.phase, "LOBBY");
  assert.equal(room.playStyle, "INDIVIDUAL");
  assert.equal(room.pendingRoundScores.size, 0);
  assert.equal(room.correctVoteStreakStart.size, 0);
  assert.equal(room.round, null);
  assert.ok([...room.players.values()].every((player) => player.score === 0));
  assert.equal(buildView(room, "host", "http://game/join/ABCDE").scoreboard, undefined);
});

async function setupCompetitiveManager(count = 4) {
  const manager = new RoomManager({
    rng: () => 0,
    hostDisconnectGraceMs: 100,
    countdownMs: 2,
    actionMs: 2,
    holdMs: 2,
    promptRevealMs: 2,
  });
  const host = createRoom(manager);
  const players = Array.from({ length: count }, (_, index) => joinPlayer(manager, host.code, index + 2));
  const room = manager.roomForTests(host.code)!;
  manager.handle(host.conn, { t: "START_GAME" });
  return { manager, host, players, room };
}

test("player and Host reconnect preserve competitive score and streak state", async () => {
  const { manager, host, players, room } = await setupCompetitiveManager(3);
  const player = players[0]!;
  room.players.get(player.uid)!.score = 3;
  room.pendingRoundScores.set(player.uid, 1);
  room.correctVoteStreakStart.set(player.uid, 1);
  const round = room.round;
  const impostorUid = room.round!.impostorUid;
  const challengeIndex = room.round!.challengeIndex;

  manager.disconnect(player.conn);
  const playerReconnect = authenticatedConnection(manager, player.uid);
  assert.equal(room.players.get(player.uid)?.score, 3);
  assert.equal(room.pendingRoundScores.get(player.uid), 1);
  assert.equal(room.correctVoteStreakStart.get(player.uid), 1);
  assert.equal(lastMessage(playerReconnect.socket, "STATE")?.view.room.playStyle, "INDIVIDUAL");

  manager.disconnect(host.conn);
  const hostReconnect = authenticatedConnection(manager, host.uid);
  assert.equal(room.hostConnected, true);
  assert.equal(room.round, round);
  assert.equal(room.round?.impostorUid, impostorUid);
  assert.equal(room.round?.challengeIndex, challengeIndex);
  assert.equal(lastMessage(hostReconnect.socket, "STATE")?.view.room.playStyle, "INDIVIDUAL");

  manager.dispose();
});

test("kicking a missing normal preserves committed ballots and never creates a ghost score row", async () => {
  const { manager, host, players, room } = await setupCompetitiveManager(4);
  for (const player of players) manager.handle(player.conn, { t: "MARK_READY" });
  const deadline = Date.now() + 200;
  while (room.phase !== "DISCUSSION" && Date.now() < deadline) await wait(2);
  assert.equal(room.phase, "DISCUSSION");
  manager.handle(host.conn, { t: "START_VOTING" });

  const impostor = players.find((player) => player.uid === room.round!.impostorUid)!;
  const normals = players.filter((player) => player.uid !== impostor.uid);
  const missing = normals.at(-1)!;
  const remainingNormals = normals.filter((player) => player.uid !== missing.uid);

  manager.handle(impostor.conn, { t: "SUBMIT_VOTE", targetUid: missing.uid });
  manager.handle(remainingNormals[0]!.conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
  manager.handle(remainingNormals[1]!.conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
  manager.handle(host.conn, { t: "KICK_PLAYER", uid: missing.uid });

  assert.equal(room.phase, "RESULT");
  assert.equal(room.round!.votes.get(impostor.uid), missing.uid, "wasted target remains committed");
  assert.equal(room.round!.groupFound, true, "3-player majority recalculates to two");
  assert.equal(room.players.has(missing.uid), false);
  assert.equal(room.pendingRoundScores.has(missing.uid), false);
  for (const normal of remainingNormals) assert.equal(room.players.get(normal.uid)?.score, 1);
  assert.equal(room.players.get(impostor.uid)?.score, 0);

  const view = lastMessage(host.socket, "STATE")!.view;
  assert.ok(view.scoreboard);
  assert.equal(view.scoreboard.some((row) => row.uid === missing.uid), false);
  assert.equal(view.result?.voteTally.some((row) => row.uid === missing.uid), false);
  assertNoVoteMapping(view);
  manager.dispose();
});

test("competitive UI uses challenge-based progress, hidden live tally, and phone countdown", async () => {
  const host = await readFile(new URL("../../client/src/screens/Host.tsx", import.meta.url), "utf8");
  const player = await readFile(new URL("../../client/src/screens/Player.tsx", import.meta.url), "utf8");

  assert.ok(host.includes("completedChallenges"));
  assert.ok(host.includes("targetChallenges"));
  assert.ok(host.includes("view.votesProgress"));
  assert.ok(host.includes("progress.submitted"));
  assert.ok(host.includes("progress.total"));
  assert.equal(host.includes("requiredVotes"), false, "Host must not expose a live quorum target");
  assert.equal(host.includes("liveVoteTally.map"), false);
  assert.ok(player.includes("view.votesProgress"));
  assert.ok(player.includes("progress.submitted"));
  assert.ok(player.includes("progress.total"));
  assert.equal(player.includes("requiredVotes"), false, "Player must not expose a live quorum target");
  assert.ok(player.includes("PlayerCountdown"));
  assert.ok(player.includes("PlayerAction"));
  assert.ok(player.includes("طالع الشاشة"));
  assert.equal(player.includes("مغادرة الغرفة"), false, "single-owner exit stays intact");
});