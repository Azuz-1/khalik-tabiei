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

function startedRoom(): RoomState {
  const room = createRoomState("ABCDE", testUid(99), 1);
  addPlayer(room, 1);
  addPlayer(room, 2);
  addPlayer(room, 3);
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
  for (const uid of round.participantUids) {
    engine.markReady(room, uid, deps);
  }
  engine.startCountdown(room, 5_000, deps);
  engine.toDiscussion(room, deps);
  engine.startVoting(room, room.hostUid, deps);
}

test("host and impostor never receive secret prompt or prompt id before result", () => {
  const room = startedRoom();
  const round = room.round!;
  const host = buildView(room, room.hostUid, "https://good.example/join/ABCDE");
  const impostor = buildView(
    room,
    round.impostorUid,
    "https://good.example/join/ABCDE",
  );

  assert.equal(host.myPrompt, undefined);
  assertNoPrompt(host, round.prompt, round.promptId);
  assert.equal(impostor.isImpostor, true);
  assert.equal(impostor.myPrompt, undefined);
  assertNoPrompt(impostor, round.prompt, round.promptId);
});

test("normal receives current prompt only during private prompt phase", () => {
  const room = startedRoom();
  const round = room.round!;
  const normalUid = round.participantUids.find((uid) => uid !== round.impostorUid)!;

  let view = buildView(room, normalUid, "https://good.example/join/ABCDE");
  assert.equal(view.myPrompt?.text, round.prompt);

  for (const uid of round.participantUids) {
    engine.markReady(room, uid, deps);
  }
  engine.startCountdown(room, 5_000, deps);

  view = buildView(room, normalUid, "https://good.example/join/ABCDE");
  assert.equal(view.myPrompt, undefined);
  assertNoPrompt(view, round.prompt, round.promptId);

  engine.toDiscussion(room, deps);
  assertNoPrompt(
    buildView(room, normalUid, "https://good.example/join/ABCDE"),
    round.prompt,
    round.promptId,
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

test("votes remain private until result", () => {
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

  const result = buildView(room, room.hostUid, "https://good.example/join/ABCDE");
  assert.equal(result.result?.voteBreakdown.length, 3);
  assert.equal(result.result?.prompt, round.prompt);
});

test("survived challenge 1/2 result keeps same-impostor secrets hidden", () => {
  const room = startedRoom();
  const round = room.round!;
  const prompt = round.prompt;
  const promptId = round.promptId;
  advanceToVoting(room);

  const [a, b, c] = round.participantUids;
  // Three-way tie: the impostor survives, so the same impostor must remain secret.
  engine.submitVote(room, a, b, deps);
  engine.submitVote(room, b, c, deps);
  engine.submitVote(room, c, a, deps);
  engine.computeResult(room, deps);

  assert.equal(round.groupFound, false);
  assert.equal(round.roundComplete, false);

  for (const recipient of [room.hostUid, ...round.participantUids]) {
    const view = buildView(room, recipient, "https://good.example/join/ABCDE");
    assert.equal(view.result?.roundComplete, false);
    assert.equal(view.result?.impostorUid, undefined);
    assert.equal(view.result?.impostorName, undefined);
    assert.equal(view.result?.prompt, undefined);
    assert.equal(view.result?.voteTally.length, 0);
    assert.equal(view.result?.voteBreakdown.length, 0);
    assertNoPrompt(view, prompt, promptId);
  }
});

test("completed result reveals prompt and impostor identity", () => {
  const room = startedRoom();
  const round = room.round!;
  advanceToVoting(room);

  const normals = round.participantUids.filter((uid) => uid !== round.impostorUid);
  engine.submitVote(room, normals[0], round.impostorUid, deps);
  engine.submitVote(room, normals[1], round.impostorUid, deps);
  engine.submitVote(room, round.impostorUid, normals[0], deps);
  engine.computeResult(room, deps);

  const result = buildView(
    room,
    room.hostUid,
    "https://good.example/join/ABCDE",
  ).result;
  assert.equal(result?.roundComplete, true);
  assert.equal(result?.prompt, round.prompt);
  assert.equal(result?.impostorUid, round.impostorUid);
  assert.equal(result?.voteBreakdown.length, 3);
});

test("game over still represents single and tied winners correctly", () => {
  for (const scores of [
    [3, 2, 1],
    [3, 3, 1],
    [3, 3, 3],
  ]) {
    const room = startedRoom();
    [...room.players.values()].forEach((player, index) => {
      player.score = scores[index];
    });
    room.phase = "GAME_OVER";

    const view = buildView(room, room.hostUid, "https://good.example/join/ABCDE");
    assert.equal(
      view.gameOver?.winners.length,
      scores.filter((score) => score === 3).length,
    );
    assert.ok(
      view.gameOver!.ranking
        .filter((row) => row.score === 3)
        .every((row) => row.rank === 1),
    );
  }
});
