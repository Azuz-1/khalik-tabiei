import { test } from "node:test";
import assert from "node:assert/strict";
import { buildView } from "../src/game/view.js";
import * as engine from "../src/game/engine.js";
import {
  createRoomState,
  type InternalPlayer,
  type RoomState,
} from "../src/game/state.js";
import { testUid } from "./helpers.js";

const deps = { rng: () => 0, now: () => 1_000 };

function addPlayer(room: RoomState, index: number): InternalPlayer {
  const player: InternalPlayer = {
    uid: testUid(index),
    name: `لاعب${index}`,
    normalizedName: `لاعب${index}`,
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

function startedRoom(count = 3): RoomState {
  const room = createRoomState("ABCDE", testUid(99), 1);
  for (let index = 1; index <= count; index += 1) addPlayer(room, index);
  room.totalRounds = 3;
  engine.startGame(room, room.hostUid, deps);
  return room;
}

function assertNoPrompt(
  view: ReturnType<typeof buildView>,
  prompt: string,
  promptId: string,
): void {
  const serialized = JSON.stringify(view);
  assert.ok(!serialized.includes(prompt));
  assert.ok(!serialized.includes(promptId));
}

function advanceToVoting(room: RoomState): void {
  const round = room.round!;
  for (const uid of round.participantUids) engine.markReady(room, uid, deps);
  engine.startCountdown(room, 6_000, deps);
  engine.toAction(room, 7_000, deps);
  engine.toHold(room, 9_000, deps);
  engine.revealPrompt(room, 11_500, deps);
  engine.toDiscussion(room, deps);
  engine.startVoting(room, room.hostUid, deps);
}

test("host and impostor receive no prompt or promptId before prompt reveal", () => {
  const room = startedRoom();
  const round = room.round!;

  for (const phase of ["QUESTION", "COUNTDOWN", "ACTION", "HOLD"] as const) {
    if (phase === "COUNTDOWN") engine.startCountdown(room, 6_000, deps);
    if (phase === "ACTION") engine.toAction(room, 7_000, deps);
    if (phase === "HOLD") engine.toHold(room, 9_000, deps);

    const host = buildView(room, room.hostUid, "https://good.example/join/ABCDE");
    const impostor = buildView(
      room,
      round.impostorUid,
      "https://good.example/join/ABCDE",
    );

    assert.equal(host.myPrompt, undefined);
    assert.equal(host.publicPrompt, undefined);
    assertNoPrompt(host, round.prompt, round.promptId);
    assert.equal(impostor.isImpostor, true);
    assert.equal(impostor.myPrompt, undefined);
    assert.equal(impostor.publicPrompt, undefined);
    assertNoPrompt(impostor, round.prompt, round.promptId);
  }
});

test("normal keeps private prompt during secret phases for reconnect recovery", () => {
  const room = startedRoom();
  const round = room.round!;
  const normalUid = round.participantUids.find((uid) => uid !== round.impostorUid)!;

  let view = buildView(room, normalUid, "https://good.example/join/ABCDE");
  assert.equal(view.myPrompt?.text, round.prompt);

  for (const uid of round.participantUids) engine.markReady(room, uid, deps);
  engine.startCountdown(room, 6_000, deps);
  view = buildView(room, normalUid, "https://good.example/join/ABCDE");
  assert.equal(view.myPrompt?.text, round.prompt);

  engine.toAction(room, 7_000, deps);
  view = buildView(room, normalUid, "https://good.example/join/ABCDE");
  assert.equal(view.myPrompt?.text, round.prompt);

  engine.toHold(room, 9_000, deps);
  view = buildView(room, normalUid, "https://good.example/join/ABCDE");
  assert.equal(view.myPrompt?.text, round.prompt);
});

test("prompt becomes public to host and impostor only after HOLD", () => {
  const room = startedRoom();
  const round = room.round!;
  for (const uid of round.participantUids) engine.markReady(room, uid, deps);
  engine.startCountdown(room, 6_000, deps);
  engine.toAction(room, 7_000, deps);
  engine.toHold(room, 9_000, deps);

  assertNoPrompt(
    buildView(room, room.hostUid, "https://good.example/join/ABCDE"),
    round.prompt,
    round.promptId,
  );

  engine.revealPrompt(room, 11_500, deps);
  const host = buildView(room, room.hostUid, "https://good.example/join/ABCDE");
  const impostor = buildView(
    room,
    round.impostorUid,
    "https://good.example/join/ABCDE",
  );
  assert.equal(host.publicPrompt?.text, round.prompt);
  assert.equal(impostor.publicPrompt?.text, round.prompt);
  assert.ok(!JSON.stringify(host).includes(round.promptId));
  assert.ok(!JSON.stringify(impostor).includes(round.promptId));

  engine.toDiscussion(room, deps);
  assert.equal(
    buildView(room, room.hostUid, "https://good.example/join/ABCDE").publicPrompt?.text,
    round.prompt,
  );
});

test("spectator/non-participant never receives a private prompt", () => {
  const room = startedRoom();
  const outsider = addPlayer(room, 7);
  const view = buildView(room, outsider.uid, "https://good.example/join/ABCDE");

  assert.equal(view.self.role, "player");
  assert.equal(view.myPrompt, undefined);
  assertNoPrompt(view, room.round!.prompt, room.round!.promptId);
});

test("votes remain private and no voter-to-target mapping is ever serialized", () => {
  const room = startedRoom();
  const round = room.round!;
  advanceToVoting(room);

  const [a, b, c] = round.participantUids;
  engine.submitVote(room, a, b, deps);

  const hostMid = buildView(room, room.hostUid, "https://good.example/join/ABCDE");
  assert.equal(hostMid.votesProgress?.submitted, 1);
  assert.equal(hostMid.result, undefined);
  assert.ok(!JSON.stringify(hostMid).includes(`\"targetUid\":\"${b}\"`));

  engine.submitVote(room, b, a, deps);
  engine.submitVote(room, c, a, deps);
  engine.computeResult(room, deps);

  const resultView = buildView(room, room.hostUid, "https://good.example/join/ABCDE");
  const json = JSON.stringify(resultView);
  assert.equal(resultView.result?.roundComplete, true);
  assert.equal(resultView.result?.voteTally.length, 3);
  assert.ok(!json.includes("voteBreakdown"));
  assert.ok(!json.includes("voterUid"));
  assert.ok(!json.includes("targetUid"));
  assert.ok(!json.includes("roundScores"));
});

test("survived challenge 1/2 result hides identity and tally but keeps already-public prompt public", () => {
  const room = startedRoom();
  const round = room.round!;
  const prompt = round.prompt;
  const promptId = round.promptId;
  advanceToVoting(room);

  const [a, b, c] = round.participantUids;
  engine.submitVote(room, a, b, deps);
  engine.submitVote(room, b, c, deps);
  engine.submitVote(room, c, a, deps);
  engine.computeResult(room, deps);

  assert.equal(round.groupFound, false);
  assert.equal(round.roundComplete, false);

  for (const recipient of [room.hostUid, ...round.participantUids]) {
    const view = buildView(room, recipient, "https://good.example/join/ABCDE");
    const json = JSON.stringify(view);
    assert.equal(view.result?.roundComplete, false);
    assert.equal(view.result?.impostorUid, undefined);
    assert.equal(view.result?.impostorName, undefined);
    assert.deepEqual(view.result?.voteTally, []);
    assert.equal(view.publicPrompt?.text, prompt);
    assert.ok(!json.includes(promptId));
    assert.ok(!json.includes("voteBreakdown"));
    assert.ok(!json.includes("scoreboard"));
  }
});

test("round-end result exposes anonymous aggregate tally including zero-vote players", () => {
  const room = startedRoom(4);
  const round = room.round!;
  advanceToVoting(room);
  const impostor = round.impostorUid;
  const normals = round.participantUids.filter((uid) => uid !== impostor);

  engine.submitVote(room, normals[0], impostor, deps);
  engine.submitVote(room, normals[1], impostor, deps);
  engine.submitVote(room, normals[2], impostor, deps);
  engine.submitVote(room, impostor, normals[0], deps);
  engine.computeResult(room, deps);

  const view = buildView(room, room.hostUid, "https://good.example/join/ABCDE");
  const tally = view.result?.voteTally ?? [];
  assert.equal(view.result?.roundComplete, true);
  assert.equal(view.result?.impostorUid, impostor);
  assert.equal(tally.length, 4);
  assert.equal(tally.reduce((sum, row) => sum + row.votes, 0), 4);
  assert.ok(tally.some((row) => row.votes === 0));
});

test("current client views expose no score, scoreboard, ranking, points, or winner payload", () => {
  const room = startedRoom();
  const lobbyLike = buildView(room, room.hostUid, "https://good.example/join/ABCDE");
  const json = JSON.stringify(lobbyLike);
  assert.ok(!json.includes("\"score\""));
  assert.ok(!json.includes("scoreboard"));
  assert.ok(!json.includes("ranking"));
  assert.ok(!json.includes("roundScores"));
  assert.ok(!json.includes("winners"));
});

test("game over exposes only caught/escaped group summary", () => {
  const room = startedRoom();
  room.roundOutcomes = [
    { roundIndex: 1, caught: true, challengeIndex: 1 },
    { roundIndex: 2, caught: false, challengeIndex: 3 },
    { roundIndex: 3, caught: true, challengeIndex: 2 },
  ];
  room.phase = "GAME_OVER";

  const view = buildView(room, room.hostUid, "https://good.example/join/ABCDE");
  assert.deepEqual(view.gameOver, {
    totalRounds: 3,
    caughtRounds: 2,
    escapedRounds: 1,
  });
  const json = JSON.stringify(view);
  assert.ok(!json.includes("ranking"));
  assert.ok(!json.includes("winner"));
  assert.ok(!json.includes("scoreboard"));
});
