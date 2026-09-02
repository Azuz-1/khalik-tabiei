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
  engine.startCountdown(room, NOW() + 5_000, deps);
  engine.toAction(room, NOW() + 1_000, deps);
  engine.toHold(room, NOW() + 2_000, deps);
  engine.revealPrompt(room, NOW() + 2_500, deps);
  engine.toDiscussion(room, deps);
  engine.startVoting(room, "host", deps);
}

function voteNoMajority(room: RoomState): void {
  const participants = room.round!.participantUids;
  for (let index = 0; index < participants.length; index += 1) {
    const voter = participants[index];
    const target = participants[(index + 1) % participants.length];
    engine.submitVote(room, voter, target, deps);
  }
  engine.computeResult(room, deps);
}

function voteCatch(room: RoomState): void {
  const round = room.round!;
  const impostorUid = round.impostorUid;
  const normals = round.participantUids.filter((uid) => uid !== impostorUid);
  const required = engine.requiredVotesFor(round.participantUids.length);

  for (let index = 0; index < normals.length; index += 1) {
    const voterUid = normals[index];
    const targetUid = index < required ? impostorUid : normals[(index + 1) % normals.length];
    engine.submitVote(room, voterUid, targetUid, deps);
  }
  engine.submitVote(room, impostorUid, normals[0], deps);
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

test("majority threshold is floor(n / 2) + 1 for 3-10 players", () => {
  const expected = new Map([
    [3, 2],
    [4, 3],
    [5, 3],
    [6, 4],
    [7, 4],
    [8, 5],
    [9, 5],
    [10, 6],
  ]);

  for (const [count, required] of expected) {
    assert.equal(engine.requiredVotesFor(count), required);
  }
});

test("only selected mode is used for every round when one mode is selected", () => {
  const room = roomWith(3);
  room.totalRounds = 3;
  engine.setSettings(room, "host", { selectedModes: ["POINT"] }, deps);
  engine.startGame(room, "host", deps);

  for (let roundIndex = 1; roundIndex <= 3; roundIndex += 1) {
    assert.equal(room.round?.mode, "POINT");
    readyToVote(room);
    voteCatch(room);
    if (roundIndex < 3) engine.nextRound(room, "host", deps);
  }
});

test("mode stays fixed across challenges while prompt changes", () => {
  const room = roomWith(3);
  engine.startGame(room, "host", deps);

  const impostorUid = room.round!.impostorUid;
  const mode = room.round!.mode;
  const firstPromptId = room.round!.promptId;

  readyToVote(room);
  voteNoMajority(room);
  assert.equal(room.round!.roundComplete, false);
  engine.nextRound(room, "host", deps);

  assert.equal(room.round!.challengeIndex, 2);
  assert.equal(room.round!.impostorUid, impostorUid);
  assert.equal(room.round!.mode, mode);
  assert.notEqual(room.round!.promptId, firstPromptId);
});

test("balanced shuffle is consumed between rounds, not between challenges", () => {
  const room = roomWith(3);
  room.totalRounds = 3;
  engine.startGame(room, "host", deps);
  const roundModes: GameMode[] = [];

  for (let roundIndex = 1; roundIndex <= 3; roundIndex += 1) {
    roundModes.push(room.round!.mode);
    readyToVote(room);
    voteCatch(room);
    if (roundIndex < 3) engine.nextRound(room, "host", deps);
  }

  assert.equal(new Set(roundModes).size, 3);
  assert.deepEqual(new Set(roundModes), new Set(["HANDS", "POINT", "NUMBER"]));
});

test("normal receives private prompt while impostor wire contains neither prompt nor promptId pre-reveal", () => {
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

test("physical sequence is explicit and prompt becomes public only at PROMPT_REVEAL", () => {
  const room = roomWith(3);
  engine.startGame(room, "host", deps);
  const prompt = room.round!.prompt;

  for (const uid of room.round!.participantUids) engine.markReady(room, uid, deps);
  engine.startCountdown(room, 6_000, deps);
  assert.equal(room.phase, "COUNTDOWN");
  assert.equal(buildView(room, room.hostUid, "https://x").publicPrompt, undefined);

  engine.toAction(room, 7_000, deps);
  assert.equal(room.phase, "ACTION");
  assert.equal(buildView(room, room.round!.impostorUid, "https://x").publicPrompt, undefined);

  engine.toHold(room, 9_000, deps);
  assert.equal(room.phase, "HOLD");
  assert.equal(buildView(room, room.hostUid, "https://x").publicPrompt, undefined);

  engine.revealPrompt(room, 11_500, deps);
  assert.equal(room.phase, "PROMPT_REVEAL");
  assert.equal(buildView(room, room.hostUid, "https://x").publicPrompt?.text, prompt);
  assert.equal(buildView(room, room.round!.impostorUid, "https://x").publicPrompt?.text, prompt);

  engine.toDiscussion(room, deps);
  assert.equal(room.phase, "DISCUSSION");
  assert.equal(room.phaseEndsAt, undefined);
});

test("less than majority on impostor does not catch them even when they have the unique most votes", () => {
  const room = roomWith(4);
  engine.startGame(room, "host", deps);
  const round = room.round!;
  const impostor = round.impostorUid;
  const normals = round.participantUids.filter((uid) => uid !== impostor);

  readyToVote(room);
  engine.submitVote(room, normals[0], impostor, deps);
  engine.submitVote(room, normals[1], impostor, deps);
  engine.submitVote(room, normals[2], normals[0], deps);
  engine.submitVote(room, impostor, normals[1], deps);
  engine.computeResult(room, deps);

  assert.equal(engine.requiredVotesFor(4), 3);
  assert.equal(room.round!.groupFound, false);
  assert.equal(room.round!.roundComplete, false);
});

test("majority on a normal player still lets impostor survive", () => {
  const room = roomWith(4);
  engine.startGame(room, "host", deps);
  const round = room.round!;
  const impostor = round.impostorUid;
  const normals = round.participantUids.filter((uid) => uid !== impostor);
  const wrong = normals[0];

  readyToVote(room);
  engine.submitVote(room, impostor, wrong, deps);
  engine.submitVote(room, normals[1], wrong, deps);
  engine.submitVote(room, normals[2], wrong, deps);
  engine.submitVote(room, wrong, normals[1], deps);
  engine.computeResult(room, deps);

  assert.equal(room.round!.groupFound, false);
  assert.equal(room.round!.roundComplete, false);
});

test("impostor majority catches them, ends round immediately, but game continues to next round", () => {
  const room = roomWith(4);
  room.totalRounds = 3;
  engine.startGame(room, "host", deps);
  const firstImpostor = room.round!.impostorUid;

  readyToVote(room);
  voteCatch(room);
  assert.equal(room.round!.challengeIndex, 1);
  assert.equal(room.round!.groupFound, true);
  assert.equal(room.round!.roundComplete, true);
  assert.equal(room.phase, "RESULT");
  assert.equal(room.currentRound, 1);

  engine.nextRound(room, "host", deps);
  assert.equal(room.phase, "QUESTION");
  assert.equal(room.currentRound, 2);
  assert.notEqual(room.round!.impostorUid, firstImpostor);
});

test("surviving challenge three ends the round with no points", () => {
  const room = roomWith(3);
  engine.startGame(room, "host", deps);
  const impostorUid = room.round!.impostorUid;

  for (let challenge = 1; challenge <= 3; challenge += 1) {
    assert.equal(room.round!.challengeIndex, challenge);
    assert.equal(room.round!.impostorUid, impostorUid);
    readyToVote(room);
    voteNoMajority(room);

    if (challenge < 3) {
      assert.equal(room.round!.roundComplete, false);
      engine.nextRound(room, "host", deps);
    }
  }

  assert.equal(room.round!.roundComplete, true);
  assert.equal(room.round!.groupFound, false);
  assert.ok([...room.players.values()].every((player) => player.score === 0));
});

test("prompt ids do not repeat within a game until that mode pool is exhausted", () => {
  const room = roomWith(3);
  room.totalRounds = 5;
  engine.setSettings(room, "host", { selectedModes: ["HANDS"] }, deps);
  engine.startGame(room, "host", deps);
  const seen: string[] = [];

  while (seen.length < 11) {
    seen.push(room.round!.promptId);
    readyToVote(room);
    voteNoMajority(room);
    engine.nextRound(room, "host", deps);
  }

  assert.equal(new Set(seen.slice(0, 10)).size, 10);
  assert.ok(seen.slice(0, 10).includes(seen[10]));
});

test("game over happens only after configured round count and tracks group outcomes", () => {
  const room = roomWith(3);
  room.totalRounds = 3;
  engine.startGame(room, "host", deps);

  for (let roundIndex = 1; roundIndex <= 3; roundIndex += 1) {
    readyToVote(room);
    voteCatch(room);
    assert.equal(room.round!.roundComplete, true);
    assert.equal(room.phase, "RESULT");
    engine.nextRound(room, "host", deps);

    if (roundIndex < 3) {
      assert.equal(room.phase, "QUESTION");
      assert.equal(room.currentRound, roundIndex + 1);
    }
  }

  assert.equal(room.phase, "GAME_OVER");
  assert.equal(room.roundOutcomes.length, 3);
  assert.equal(room.roundOutcomes.filter((outcome) => outcome.caught).length, 3);
});

test("Arabic display-name sanitization remains intact", () => {
  assert.equal(cleanName("  س\u202Eلمان\u0000  "), "سلمان");
});
