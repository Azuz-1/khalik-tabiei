import { test } from "node:test";
import assert from "node:assert/strict";
import type { GameMode } from "../../shared/types.js";
import { GAME_MODE_IDS } from "../../shared/constants.js";
import {
  cleanName,
  createRoomState,
  type InternalPlayer,
  type RoomState,
} from "../src/game/state.js";
import * as engine from "../src/game/engine.js";
import { buildView } from "../src/game/view.js";

const NOW = () => 1_000;
const deps = { rng: () => 0, now: NOW };

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

function roomWith(count = 4): RoomState {
  const room = createRoomState("ABCDE", "host", NOW());
  for (let index = 1; index <= count; index += 1) {
    addPlayer(room, `p${index}`, `لاعب${index}`);
  }
  room.totalRounds = 3;
  return room;
}

function readyToVote(room: RoomState): void {
  for (const uid of room.round!.participantUids) {
    engine.markReady(room, uid, deps);
  }
  engine.startCountdown(room, NOW() + 4_000, deps);
  engine.toDiscussion(room, deps);
  engine.startVoting(room, "host", deps);
}

function voteTie(room: RoomState): void {
  const [a, b, c, d] = room.round!.participantUids;
  assert.ok(d, "tie helper requires four players");
  engine.submitVote(room, a, b, deps);
  engine.submitVote(room, b, a, deps);
  engine.submitVote(room, c, d, deps);
  engine.submitVote(room, d, c, deps);
  engine.computeResult(room, deps);
}

function voteWrongUnique(room: RoomState): void {
  const impostorUid = room.round!.impostorUid;
  const others = room.round!.participantUids.filter((uid) => uid !== impostorUid);
  const wrongUid = others[0];

  for (const uid of room.round!.participantUids) {
    engine.submitVote(room, uid, uid === wrongUid ? others[1] : wrongUid, deps);
  }
  engine.computeResult(room, deps);
}

test("host can select one, two, or all three modes", () => {
  for (const modes of [
    ["POINT"],
    ["POINT", "HANDS"],
    ["HANDS", "POINT", "NUMBER"],
  ] as GameMode[][]) {
    const room = roomWith();
    engine.setSettings(room, "host", { selectedModes: modes }, deps);
    assert.deepEqual(room.selectedModes, modes);
  }
});

test("cannot select zero modes and non-host cannot change modes", () => {
  const room = roomWith();
  assert.throws(
    () => engine.setSettings(room, "host", { selectedModes: [] }, deps),
    /NO_MODE_SELECTED/,
  );
  assert.throws(
    () => engine.setSettings(room, "p1", { selectedModes: ["POINT"] }, deps),
    /NOT_HOST/,
  );
});

test("settings lock after game starts", () => {
  const room = roomWith();
  engine.startGame(room, "host", deps);
  assert.throws(
    () => engine.setSettings(room, "host", { selectedModes: ["POINT"] }, deps),
    /INVALID_PHASE/,
  );
});

test("legacy TEXT_PAIR cannot be selected through current settings and is absent from mode catalog", () => {
  const room = roomWith();
  assert.deepEqual(GAME_MODE_IDS, ["HANDS", "POINT", "NUMBER"]);
  assert.throws(
    () => engine.setSettings(room, "host", { categories: ["food"] }, deps),
    (error: unknown) =>
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "BAD_REQUEST",
  );
});

test("only selected modes are chosen", () => {
  const room = roomWith();
  engine.setSettings(room, "host", { selectedModes: ["POINT"] }, deps);
  engine.startGame(room, "host", deps);
  assert.equal(room.round?.mode, "POINT");

  for (let index = 0; index < 5; index += 1) {
    assert.equal(engine.pickBalancedMode(room, deps), "POINT");
  }
});

test("balanced mode rotation uses every selected mode before refilling and avoids boundary repeats", () => {
  const room = roomWith();
  room.selectedModes = ["HANDS", "POINT", "NUMBER"];
  const firstCycle = [
    engine.pickBalancedMode(room, deps),
    engine.pickBalancedMode(room, deps),
    engine.pickBalancedMode(room, deps),
  ];
  const fourth = engine.pickBalancedMode(room, deps);
  assert.deepEqual(new Set(firstCycle), new Set(room.selectedModes));
  assert.notEqual(fourth, firstCycle[2]);

  const two = roomWith();
  two.selectedModes = ["HANDS", "POINT"];
  const sequence = Array.from({ length: 8 }, () => engine.pickBalancedMode(two, deps));
  for (let index = 1; index < sequence.length; index += 1) {
    assert.notEqual(sequence[index], sequence[index - 1]);
  }
});

test("startGame requires minimum players", () => {
  const room = roomWith(2);
  assert.throws(() => engine.startGame(room, "host", deps), /NOT_ENOUGH_PLAYERS/);
});

test("same impostor persists across challenges and each challenge gets a new prompt", () => {
  const room = roomWith(4);
  room.selectedModes = ["HANDS"];
  engine.startGame(room, "host", deps);

  const impostorUid = room.round!.impostorUid;
  const firstPromptId = room.round!.promptId;
  readyToVote(room);
  voteTie(room);

  assert.equal(room.round!.roundComplete, false);
  engine.nextRound(room, "host", deps);
  assert.equal(room.round!.challengeIndex, 2);
  assert.equal(room.round!.impostorUid, impostorUid);
  assert.notEqual(room.round!.promptId, firstPromptId);
});

test("normal player receives prompt while impostor payload contains neither prompt nor promptId", () => {
  const room = roomWith(3);
  engine.startGame(room, "host", deps);
  const round = room.round!;
  const normalUid = round.participantUids.find((uid) => uid !== round.impostorUid)!;
  const normalView = buildView(room, normalUid, "https://x/join/ABCDE");
  const impostorView = buildView(room, round.impostorUid, "https://x/join/ABCDE");

  assert.equal(normalView.myPrompt?.text, round.prompt);
  assert.equal(normalView.isImpostor, false);
  assert.equal(impostorView.isImpostor, true);
  assert.equal(impostorView.myPrompt, undefined);

  const json = JSON.stringify(impostorView);
  assert.ok(!json.includes(round.prompt));
  assert.ok(!json.includes(round.promptId));
});

test("correct unique top vote catches impostor and only correct normal voters score +1", () => {
  const room = roomWith(3);
  engine.startGame(room, "host", deps);
  const impostorUid = room.round!.impostorUid;
  const normals = room.round!.participantUids.filter((uid) => uid !== impostorUid);

  readyToVote(room);
  engine.submitVote(room, normals[0], impostorUid, deps);
  engine.submitVote(room, normals[1], impostorUid, deps);
  engine.submitVote(room, impostorUid, normals[0], deps);
  engine.computeResult(room, deps);

  assert.equal(room.round!.groupFound, true);
  assert.equal(room.round!.roundComplete, true);
  assert.equal(room.players.get(impostorUid)!.score, 0);
  assert.equal(room.players.get(normals[0])!.score, 1);
  assert.equal(room.players.get(normals[1])!.score, 1);
});

test("tie lets impostor survive to next challenge with no early survival points", () => {
  const room = roomWith(4);
  engine.startGame(room, "host", deps);
  const impostorUid = room.round!.impostorUid;

  readyToVote(room);
  voteTie(room);
  assert.equal(room.round!.groupFound, false);
  assert.equal(room.round!.roundComplete, false);
  assert.equal(room.players.get(impostorUid)!.score, 0);

  engine.nextRound(room, "host", deps);
  assert.equal(room.round!.challengeIndex, 2);
});

test("wrong unique top vote lets impostor survive", () => {
  const room = roomWith(4);
  engine.startGame(room, "host", deps);
  const impostorUid = room.round!.impostorUid;

  readyToVote(room);
  voteWrongUnique(room);
  assert.equal(room.round!.groupFound, false);
  assert.equal(room.round!.roundComplete, false);
  assert.equal(room.players.get(impostorUid)!.score, 0);
});

test("surviving challenge three ends round and awards impostor +2 only once", () => {
  const room = roomWith(4);
  engine.startGame(room, "host", deps);
  const impostorUid = room.round!.impostorUid;

  for (let challenge = 1; challenge <= 3; challenge += 1) {
    assert.equal(room.round!.challengeIndex, challenge);
    assert.equal(room.round!.impostorUid, impostorUid);
    readyToVote(room);
    voteTie(room);

    if (challenge < 3) {
      assert.equal(room.players.get(impostorUid)!.score, 0);
      assert.equal(room.round!.roundComplete, false);
      engine.nextRound(room, "host", deps);
    }
  }

  assert.equal(room.round!.roundComplete, true);
  assert.equal(room.players.get(impostorUid)!.score, 2);
});

test("completed round advances to a new round and fair impostor selection can rotate", () => {
  const room = roomWith(3);
  room.totalRounds = 2;
  engine.startGame(room, "host", deps);

  const firstImpostorUid = room.round!.impostorUid;
  const normals = room.round!.participantUids.filter((uid) => uid !== firstImpostorUid);
  readyToVote(room);
  engine.submitVote(room, normals[0], firstImpostorUid, deps);
  engine.submitVote(room, normals[1], firstImpostorUid, deps);
  engine.submitVote(room, firstImpostorUid, normals[0], deps);
  engine.computeResult(room, deps);
  engine.nextRound(room, "host", deps);

  assert.equal(room.currentRound, 2);
  assert.notEqual(room.round!.impostorUid, firstImpostorUid);
});

test("Arabic display-name sanitization remains intact", () => {
  assert.equal(cleanName("  س\u202Eلمان\u0000  "), "سلمان");
});
