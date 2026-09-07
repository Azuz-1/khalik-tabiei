import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import * as engine from "../src/game/engine.js";
import { createRoomState, type InternalPlayer, type RoomState } from "../src/game/state.js";
import { BASE_CHALLENGES, DEFAULT_ROUNDS, ROUND_OPTIONS } from "../../shared/constants.js";

const deps = { rng: () => 0, now: () => 1_000 };

function roomWithPlayers(count: number): RoomState {
  const room = createRoomState("LEN01", "host", 1_000);
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

function resolve(room: RoomState, catchImpostor: boolean): void {
  toVoting(room);
  const round = room.round!;
  const impostor = round.impostorUid;
  const normals = round.participantUids.filter((uid) => uid !== impostor);
  if (catchImpostor) {
    for (const normal of normals) engine.submitVote(room, normal, impostor, deps);
  } else {
    for (const normal of normals) {
      const wrong = normals.find((candidate) => candidate !== normal) ?? impostor;
      engine.submitVote(room, normal, wrong, deps);
    }
  }
  engine.submitVote(room, impostor, normals[0]!, deps);
  engine.computeResult(room, deps);
}

test("competitive match lengths are exactly 3, 6, 9 and 12 with 9 as default", () => {
  assert.deepEqual(ROUND_OPTIONS, [3, 6, 9, 12]);
  assert.equal(DEFAULT_ROUNDS, 9);
  assert.equal(BASE_CHALLENGES, 9);
  const room = roomWithPlayers(4);
  assert.equal(room.totalRounds, 9);
  assert.equal(room.targetChallenges, 9);
});

test("server accepts only selectable match lengths and startGame honors each choice", () => {
  for (const length of ROUND_OPTIONS) {
    const room = roomWithPlayers(4);
    engine.setSettings(room, "host", { totalRounds: length }, deps);
    assert.equal(room.targetChallenges, length);
    engine.startGame(room, "host", deps);
    assert.equal(room.targetChallenges, length);
    assert.equal(room.totalRounds, length);
  }

  const invalid = roomWithPlayers(4);
  assert.throws(
    () => engine.setSettings(invalid, "host", { totalRounds: 5 }, deps),
    (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "BAD_REQUEST",
  );
});

test("selected match length survives rematch back to Lobby", () => {
  const room = roomWithPlayers(4);
  engine.setSettings(room, "host", { totalRounds: 6 }, deps);
  engine.startGame(room, "host", deps);

  while (room.completedChallenges < 6) {
    resolve(room, true);
    if (room.completedChallenges < 6) engine.nextRound(room, "host", deps);
  }
  engine.nextRound(room, "host", deps);
  assert.equal(room.phase, "GAME_OVER");

  engine.rematch(room, "host", deps);
  assert.equal(room.phase, "LOBBY");
  assert.equal(room.targetChallenges, 6);
  assert.equal(room.totalRounds, 6);
});

test("three-player quick match finishes the active final impostor stint even past target 3", () => {
  const room = roomWithPlayers(3);
  engine.setSettings(room, "host", { totalRounds: 3 }, deps);
  engine.startGame(room, "host", deps);

  // Two one-Challenge stints end immediately, so a fresh impostor stint begins at global Challenge 3.
  resolve(room, true);
  engine.nextRound(room, "host", deps);
  resolve(room, true);
  engine.nextRound(room, "host", deps);
  assert.equal(room.completedChallenges, 2);
  assert.equal(room.round?.challengeIndex, 1);

  // Challenge 3 reaches the selected target, but the current impostor survives it.
  resolve(room, false);
  assert.equal(room.completedChallenges, 3);
  assert.equal(room.round?.roundComplete, false);
  engine.nextRound(room, "host", deps);
  assert.equal(room.phase, "QUESTION");
  assert.equal(room.round?.challengeIndex, 2);

  resolve(room, false);
  assert.equal(room.completedChallenges, 4);
  assert.equal(room.round?.roundComplete, true);
  engine.nextRound(room, "host", deps);
  assert.equal(room.phase, "GAME_OVER");
});

test("Host copy exposes compact length choices and explains final-stint continuation", () => {
  const host = fs.readFileSync(new URL("../../client/src/screens/Host.tsx", import.meta.url), "utf8");
  const home = fs.readFileSync(new URL("../../client/src/screens/Home.tsx", import.meta.url), "utf8");
  assert.match(host, /طول المباراة/);
  assert.match(host, /3: "سريعة"/);
  assert.match(host, /6: "خفيفة"/);
  assert.match(host, /9: "عادية"/);
  assert.match(host, /12: "طويلة"/);
  assert.match(host, /نكمل دور آخر متخفي، حتى لو تجاوزنا العدد المختار/);
  assert.match(home, /3 أو 6 أو 9 أو 12 تحديًا أساسيًا/);
});
