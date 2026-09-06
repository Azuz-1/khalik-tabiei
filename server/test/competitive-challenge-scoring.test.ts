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

test("three-player stint uses two Challenges and awards 2/1 continuous discovery", () => {
  const room = roomWithPlayers(3);
  engine.startGame(room, "host", deps);
  assert.equal(room.round?.maxChallenges, 2);

  const impostor = room.round!.impostorUid;
  const normals = room.round!.participantUids.filter((uid) => uid !== impostor);

  resolveChallenge(room, new Set([normals[0]!]));
  assert.equal(room.round?.roundComplete, false);
  assert.equal(room.players.get(impostor)?.score, 0, "hidden stint points are not applied early");
  assert.equal(buildView(room, "host", "http://game/join/PTS01").scoreboard, undefined);

  advance(room);
  resolveChallenge(room, new Set(normals));

  assert.equal(room.round?.roundComplete, true);
  assert.equal(room.players.get(normals[0]!)?.score, 2);
  assert.equal(room.players.get(normals[1]!)?.score, 1);
  assert.equal(room.players.get(impostor)?.score, 1, "impostor survived exactly one Challenge");
  assert.equal(room.completedChallenges, 2);
});

test("four-player stint awards 3/2/1 discovery and +1 per survived Challenge", () => {
  const room = roomWithPlayers(4);
  engine.startGame(room, "host", deps);
  assert.equal(room.round?.maxChallenges, 3);

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
  assert.equal(room.round?.roundScores.get(normals[0]!), 3);
  assert.equal(room.round?.roundScores.get(impostor), 2);
});

test("correct then wrong then correct restarts the streak at Challenge 3", () => {
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
  assert.equal(room.players.get(target)?.score, 1, "a broken streak cannot retain the C1 value");
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
  assert.equal(room.players.get(impostor)?.score, 3, "three survived Challenges award exactly three points");
});

test("the ninth base Challenge never truncates the final impostor stint", () => {
  const room = roomWithPlayers(4);
  engine.startGame(room, "host", deps);

  // Finish eight one-Challenge stints by catching immediately.
  for (let completed = 0; completed < 8; completed += 1) {
    const impostor = room.round!.impostorUid;
    const normals = room.round!.participantUids.filter((uid) => uid !== impostor);
    resolveChallenge(room, new Set(normals));
    assert.equal(room.round?.roundComplete, true);
    advance(room);
    assert.equal(room.phase, "QUESTION");
  }

  assert.equal(room.completedChallenges, 8);
  assert.equal(room.round?.challengeIndex, 1);

  // Challenge 9 starts a fresh three-Challenge stint and must be completed.
  resolveChallenge(room, new Set());
  assert.equal(room.completedChallenges, 9);
  assert.equal(room.round?.roundComplete, false);
  advance(room);
  assert.equal(room.phase, "QUESTION");
  assert.equal(room.round?.challengeIndex, 2);

  resolveChallenge(room, new Set());
  assert.equal(room.completedChallenges, 10);
  assert.equal(room.round?.roundComplete, false);
  advance(room);
  assert.equal(room.round?.challengeIndex, 3);

  resolveChallenge(room, new Set());
  assert.equal(room.completedChallenges, 11);
  assert.equal(room.round?.roundComplete, true);
  advance(room);
  assert.equal(room.phase, "GAME_OVER");
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
