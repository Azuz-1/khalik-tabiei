import test from "node:test";
import assert from "node:assert/strict";
import * as engine from "../src/game/engine.js";
import { buildView } from "../src/game/view.js";
import { createRoomState, type InternalPlayer, type RoomState } from "../src/game/state.js";

const deps = { rng: () => 0, now: () => 1_000 };

function roomWithPlayers(count: number): RoomState {
  const room = createRoomState("PTS01", "host", 1_000);
  for (let index = 1; index <= count; index += 1) {
    const player: InternalPlayer = {
      uid: `p${index}`,
      name: `لاعب${index}`,
      normalizedName: `لاعب${index}`,
      seatNumber: index,
      score: 0,
      connected: true,
      joinedAt: index,
      lastSeen: index,
      disconnectGeneration: 0,
      isHost: false,
    };
    room.players.set(player.uid, player);
  }
  return room;
}

function toVoting(room: RoomState): void {
  for (const uid of room.round!.participantUids) engine.markReady(room, uid, deps);
  engine.startCountdown(room, 2_000, deps);
  engine.toAction(room, 2_100, deps);
  engine.toHold(room, 2_200, deps);
  engine.revealPrompt(room, 2_300, deps);
  engine.toDiscussion(room, deps);
  engine.startVoting(room, "host", deps);
}

function resolveChallenge(room: RoomState, correctNormals: Set<string>): void {
  toVoting(room);
  const round = room.round!;
  const impostor = round.impostorUid;
  const normals = round.participantUids.filter((uid) => uid !== impostor);

  for (const normal of normals) {
    const wrongTarget = normals.find((candidate) => candidate !== normal) ?? impostor;
    engine.submitVote(room, normal, correctNormals.has(normal) ? impostor : wrongTarget, deps);
  }
  engine.submitVote(room, impostor, normals[0]!, deps);
  engine.computeResult(room, deps);
  assert.equal(room.phase, "RESULT");
}

function advance(room: RoomState): void {
  engine.nextRound(room, "host", deps);
}

test("three-player stints also allow three Challenges", () => {
  const room = roomWithPlayers(3);
  engine.startGame(room, "host", deps);
  assert.equal(room.round?.maxChallenges, 3);
  assert.equal(buildView(room, "host", "http://game/join/PTS01").challenge?.max, 3);
});

test("catching the impostor on Challenge 1 awards correct voters one point only", () => {
  const room = roomWithPlayers(4);
  engine.startGame(room, "host", deps);
  const impostor = room.round!.impostorUid;
  const normals = room.round!.participantUids.filter((uid) => uid !== impostor);

  resolveChallenge(room, new Set(normals));

  assert.equal(room.round?.roundComplete, true);
  for (const normal of normals) assert.equal(room.players.get(normal)?.score, 1);
  assert.equal(room.players.get(impostor)?.score, 0);
});

test("trailing correct streaks award 3/2/1 when a stint reaches Challenge 3", () => {
  const room = roomWithPlayers(4);
  engine.startGame(room, "host", deps);
  const impostor = room.round!.impostorUid;
  const normals = room.round!.participantUids.filter((uid) => uid !== impostor);

  resolveChallenge(room, new Set([normals[0]!]));
  assert.equal(room.round?.roundComplete, false);
  advance(room);

  resolveChallenge(room, new Set([normals[0]!, normals[1]!]));
  assert.equal(room.round?.roundComplete, false);
  advance(room);

  resolveChallenge(room, new Set(normals));
  assert.equal(room.round?.roundComplete, true);

  assert.equal(room.players.get(normals[0]!)?.score, 3);
  assert.equal(room.players.get(normals[1]!)?.score, 2);
  assert.equal(room.players.get(normals[2]!)?.score, 1);
  assert.equal(room.players.get(impostor)?.score, 2);
});

test("correct then wrong then correct restarts the streak at one point", () => {
  const room = roomWithPlayers(4);
  engine.startGame(room, "host", deps);
  const impostor = room.round!.impostorUid;
  const normals = room.round!.participantUids.filter((uid) => uid !== impostor);
  const target = normals[0]!;

  resolveChallenge(room, new Set([target]));
  advance(room);
  resolveChallenge(room, new Set([normals[1]!]));
  advance(room);
  resolveChallenge(room, new Set([target, normals[1]!, normals[2]!]));

  assert.equal(room.round?.roundComplete, true);
  assert.equal(room.players.get(target)?.score, 1);
});

test("a normal whose final vote is wrong earns zero for the stint", () => {
  const room = roomWithPlayers(4);
  engine.startGame(room, "host", deps);
  const impostor = room.round!.impostorUid;
  const normals = room.round!.participantUids.filter((uid) => uid !== impostor);
  const target = normals[0]!;

  resolveChallenge(room, new Set([target]));
  advance(room);
  resolveChallenge(room, new Set([target]));
  advance(room);
  resolveChallenge(room, new Set());

  assert.equal(room.round?.roundComplete, true);
  assert.equal(room.players.get(target)?.score, 0);
  assert.equal(room.players.get(impostor)?.score, 3);
});

test("the selected match total ends exactly on that Challenge without extending the active stint", () => {
  const room = roomWithPlayers(4);
  engine.setSettings(room, "host", { totalRounds: 3 }, deps);
  engine.startGame(room, "host", deps);

  for (let completed = 0; completed < 2; completed += 1) {
    const impostor = room.round!.impostorUid;
    const normals = room.round!.participantUids.filter((uid) => uid !== impostor);
    resolveChallenge(room, new Set(normals));
    advance(room);
  }

  assert.equal(room.completedChallenges, 2);
  assert.equal(room.round?.challengeIndex, 1, "Challenge 3 begins a fresh impostor stint");
  const finalImpostor = room.round!.impostorUid;
  const finalNormals = room.round!.participantUids.filter((uid) => uid !== finalImpostor);

  resolveChallenge(room, new Set([finalNormals[0]!]));
  assert.equal(room.completedChallenges, 3);
  assert.equal(room.round?.groupFound, false);
  assert.equal(room.round?.roundComplete, true, "the selected total ends the match even mid-stint");
  assert.equal(room.players.get(finalNormals[0]!)?.score, 1, "a one-Challenge trailing correct streak is worth one");
  assert.equal(room.round?.roundScores.get(finalImpostor), 1, "the impostor gets one point for surviving the final Challenge");

  advance(room);
  assert.equal(room.phase, "GAME_OVER");
  assert.equal(room.completedChallenges, 3);
});

test("Host receives vote progress but no live target tally during VOTING", () => {
  const room = roomWithPlayers(4);
  engine.startGame(room, "host", deps);
  toVoting(room);
  const impostor = room.round!.impostorUid;
  const voter = room.round!.participantUids.find((uid) => uid !== impostor)!;
  engine.submitVote(room, voter, impostor, deps);

  const view = buildView(room, "host", "http://game/join/PTS01");
  assert.equal(view.room.phase, "VOTING");
  assert.equal(view.votesProgress?.submitted, 1);
  assert.equal(view.liveVoteTally, undefined);
  assert.equal(JSON.stringify(view).includes("correctVoteStreakStart"), false);
  assert.equal(JSON.stringify(view).includes("pendingRoundScores"), false);
});
