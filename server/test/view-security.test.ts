import { test } from "node:test";
import assert from "node:assert/strict";
import { buildView } from "../src/game/view.js";
import * as engine from "../src/game/engine.js";
import { createRoomState, type InternalPlayer, type RoomState } from "../src/game/state.js";
import { testUid } from "./helpers.js";

const deps = { rng: () => 0, now: () => 1000 };

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
  room.categories = ["food"];
  room.totalRounds = 3;
  engine.startGame(room, room.hostUid, deps);
  room.round!.normalQuestion = "NORMAL-SECRET-QUESTION";
  room.round!.impostorQuestion = "IMPOSTOR-SECRET-QUESTION";
  return room;
}

function assertNoSharedSecretFields(serialized: string): void {
  for (const field of [
    "impostorUid",
    "impostorQuestion",
    "normalQuestion",
    "voteTally",
    "voteBreakdown",
    "roundScores",
  ]) {
    assert.ok(!serialized.includes(`\"${field}\"`), field);
  }
}

function assertPreResultViews(room: RoomState): void {
  const round = room.round!;
  const impostor = round.impostorUid;
  const normal = round.participantUids.find((uid) => uid !== impostor)!;
  const recipients = [room.hostUid, normal, impostor, testUid(500)];

  for (const uid of recipients) {
    const view = buildView(room, uid, "https://good.example/join/ABCDE");
    const serialized = JSON.stringify(view);
    assertNoSharedSecretFields(serialized);
    if (room.phase === "QUESTION" || room.phase === "ANSWERING") {
      if (uid === normal) {
        assert.equal(view.myQuestion, round.normalQuestion);
        assert.ok(!serialized.includes(round.impostorQuestion));
      } else if (uid === impostor) {
        assert.equal(view.myQuestion, round.impostorQuestion);
        assert.ok(!serialized.includes(round.normalQuestion));
      } else {
        assert.equal(view.myQuestion, undefined);
        assert.ok(!serialized.includes(round.normalQuestion));
        assert.ok(!serialized.includes(round.impostorQuestion));
      }
    } else {
      assert.equal(view.myQuestion, undefined);
      assert.ok(!serialized.includes(round.normalQuestion));
      assert.ok(!serialized.includes(round.impostorQuestion));
    }
  }
}

test("serialized per-recipient views preserve secrecy in every pre-result phase", () => {
  const room = startedRoom();
  assert.equal(room.phase, "QUESTION");
  assertPreResultViews(room);

  engine.openAnswering(room, deps);
  const first = room.round!.participantUids[0];
  engine.submitAnswer(room, first, "UNREVEALED-ANSWER-ALPHA", deps);
  assertPreResultViews(room);
  for (const uid of [room.hostUid, ...room.round!.participantUids, testUid(500)]) {
    assert.ok(!JSON.stringify(buildView(room, uid, "https://good.example/join/ABCDE"))
      .includes("UNREVEALED-ANSWER-ALPHA"));
  }

  for (const uid of room.round!.participantUids.slice(1)) {
    engine.submitAnswer(room, uid, `جواب-${uid.slice(-1)}`, deps);
  }
  engine.reveal(room, deps);
  assertPreResultViews(room);
  engine.toDiscussion(room, deps);
  assertPreResultViews(room);
  engine.startVoting(room, room.hostUid, deps);
  const uids = room.round!.participantUids;
  engine.submitVote(room, uids[0], uids[1], deps);
  assertPreResultViews(room);

  engine.submitVote(room, uids[1], uids[0], deps);
  engine.submitVote(room, uids[2], uids[0], deps);
  engine.computeResult(room, deps);
  const resultView = buildView(room, room.hostUid, "https://good.example/join/ABCDE");
  const resultJson = JSON.stringify(resultView);
  assert.ok(resultJson.includes("NORMAL-SECRET-QUESTION"));
  assert.ok(resultJson.includes("IMPOSTOR-SECRET-QUESTION"));
  assert.ok(resultJson.includes("impostorUid"));
  assert.equal(resultView.result?.voteBreakdown.length, 3);
  assert.deepEqual(
    resultView.result?.voteBreakdown.map((vote) => [vote.voterUid, vote.targetUid]),
    [[uids[0], uids[1]], [uids[1], uids[0]], [uids[2], uids[0]]],
  );
});

test("non-participants never receive a private question after a later-round reconnect", () => {
  const room = startedRoom();
  const outsider = addPlayer(room, 7);
  const view = buildView(room, outsider.uid, "https://good.example/join/ABCDE");
  assert.equal(view.self.role, "player");
  assert.equal(view.myQuestion, undefined);
  assert.ok(!JSON.stringify(view).includes(room.round!.normalQuestion));
});

test("game over represents single, two-way, and three-way winners", () => {
  for (const scores of [[3, 2, 1], [3, 3, 1], [3, 3, 3]]) {
    const room = startedRoom();
    [...room.players.values()].forEach((player, index) => {
      player.score = scores[index];
    });
    room.phase = "GAME_OVER";
    const view = buildView(room, room.hostUid, "https://good.example/join/ABCDE");
    assert.equal(view.gameOver?.winners.length, scores.filter((score) => score === 3).length);
    const topRows = view.gameOver!.ranking.filter((row) => row.score === 3);
    assert.ok(topRows.every((row) => row.rank === 1));
  }
});
