import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import { CHALLENGE_OPTIONS, BASE_CHALLENGES } from "../../shared/constants.js";
import { validateClientMessage } from "../src/security/messages.js";
import * as engine from "../src/game/engine.js";
import { buildView } from "../src/game/view.js";
import { createRoomState, type InternalPlayer, type RoomState } from "../src/game/state.js";

const deps = { rng: () => 0, now: () => 1_000 };

function roomWithPlayers(count = 4): RoomState {
  const room = createRoomState("OPT01", "host", 1_000);
  for (let index = 1; index <= count; index += 1) {
    const player: InternalPlayer = {
      uid: `p${index}`,
      name: `لاعب${index}`,
      normalizedName: `لاعب${index}`,
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

function catchImpostor(room: RoomState): void {
  toVoting(room);
  const round = room.round!;
  const normals = round.participantUids.filter((uid) => uid !== round.impostorUid);
  for (const normal of normals) engine.submitVote(room, normal, round.impostorUid, deps);
  engine.submitVote(room, round.impostorUid, normals[0]!, deps);
  engine.computeResult(room, deps);
  assert.equal(room.round?.roundComplete, true);
}

function letImpostorSurvive(room: RoomState): void {
  toVoting(room);
  const participants = room.round!.participantUids;
  for (let index = 0; index < participants.length; index += 1) {
    engine.submitVote(room, participants[index]!, participants[(index + 1) % participants.length]!, deps);
  }
  engine.computeResult(room, deps);
  assert.equal(room.round?.groupFound, false);
}

test("Host challenge choices are exactly 3, 6, 9, and 12 with 9 as default", () => {
  assert.deepEqual(CHALLENGE_OPTIONS, [3, 6, 9, 12]);
  assert.equal(BASE_CHALLENGES, 9);
  const room = roomWithPlayers();
  assert.equal(room.totalRounds, 9);
  assert.equal(room.targetChallenges, 9);
});

test("SET_SETTINGS accepts only the four challenge-count choices", () => {
  for (const count of CHALLENGE_OPTIONS) {
    assert.deepEqual(validateClientMessage({ t: "SET_SETTINGS", totalRounds: count }), { t: "SET_SETTINGS", totalRounds: count });
  }
  for (const count of [1, 5, 7, 10, 13]) {
    assert.equal(validateClientMessage({ t: "SET_SETTINGS", totalRounds: count }), null);
  }
});

test("Lobby selection is authoritative in Host and Player views and survives game start", () => {
  for (const count of CHALLENGE_OPTIONS) {
    const room = roomWithPlayers();
    engine.setSettings(room, "host", { totalRounds: count }, deps);
    assert.equal(room.totalRounds, count);
    assert.equal(room.targetChallenges, count);
    assert.equal(buildView(room, "host", "https://game.test/join/OPT01").room.targetChallenges, count);
    assert.equal(buildView(room, "p1", "https://game.test/join/OPT01").room.targetChallenges, count);

    engine.startGame(room, "host", deps);
    assert.equal(room.totalRounds, count);
    assert.equal(room.targetChallenges, count);
  }
});

test("each selected target ends after exactly that many immediately-caught Challenges", () => {
  for (const count of CHALLENGE_OPTIONS) {
    const room = roomWithPlayers();
    engine.setSettings(room, "host", { totalRounds: count }, deps);
    engine.startGame(room, "host", deps);

    for (let completed = 1; completed <= count; completed += 1) {
      catchImpostor(room);
      assert.equal(room.completedChallenges, completed);
      engine.nextRound(room, "host", deps);
      assert.equal(room.phase, completed === count ? "GAME_OVER" : "QUESTION");
    }
  }
});

test("selected target ends the match even when the active impostor would otherwise continue", () => {
  const room = roomWithPlayers(4);
  engine.setSettings(room, "host", { totalRounds: 3 }, deps);
  engine.startGame(room, "host", deps);

  catchImpostor(room);
  engine.nextRound(room, "host", deps);
  catchImpostor(room);
  engine.nextRound(room, "host", deps);
  assert.equal(room.completedChallenges, 2);
  assert.equal(room.round?.challengeIndex, 1);

  letImpostorSurvive(room);
  assert.equal(room.completedChallenges, 3);
  assert.equal(room.round?.roundComplete, true, "Challenge 3 is the exact match boundary");
  engine.nextRound(room, "host", deps);
  assert.equal(room.phase, "GAME_OVER");
  assert.equal(room.completedChallenges, 3);
});

test("rematch returns to Lobby with the Host's selected challenge count preserved", () => {
  const room = roomWithPlayers();
  engine.setSettings(room, "host", { totalRounds: 3 }, deps);
  engine.startGame(room, "host", deps);
  for (let completed = 0; completed < 3; completed += 1) {
    catchImpostor(room);
    engine.nextRound(room, "host", deps);
  }
  assert.equal(room.phase, "GAME_OVER");

  engine.rematch(room, "host", deps);
  assert.equal(room.phase, "LOBBY");
  assert.equal(room.totalRounds, 3);
  assert.equal(room.targetChallenges, 3);
});

test("Host and Home source expose the four-choice exact-total UX", () => {
  const hostSource = readFileSync(new URL("../../client/src/screens/Host.tsx", import.meta.url), "utf8");
  const homeSource = readFileSync(new URL("../../client/src/screens/Home.tsx", import.meta.url), "utf8");
  assert.match(hostSource, /CHALLENGE_OPTIONS\.map/);
  assert.match(hostSource, /totalRounds: count/);
  assert.match(hostSource, /عدد التحديات/);
  assert.match(hostSource, /تنتهي عند عدد التحديات المختار بالضبط/);
  assert.match(homeSource, /CHALLENGE_OPTIONS\.join/);
  assert.match(homeSource, /تنتهي بالعدد المختار بالضبط/);
});
