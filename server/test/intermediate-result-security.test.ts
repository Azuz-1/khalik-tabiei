import { test } from "node:test";
import assert from "node:assert/strict";
import { createRoomState, type InternalPlayer } from "../src/game/state.js";
import * as engine from "../src/game/engine.js";
import { buildView } from "../src/game/view.js";
import { testUid } from "./helpers.js";

const deps = { rng: () => 0, now: () => 1000 };

test("survived challenge result does not reveal impostor identity or correctness metadata", () => {
  const room = createRoomState("ABCDE", testUid(99), 1);
  for (let index = 1; index <= 4; index += 1) {
    const player: InternalPlayer = {
      uid: testUid(index), name: `لاعب${index}`, normalizedName: `لاعب${index}`,
      score: 0, connected: true, joinedAt: 1, lastSeen: 1,
      disconnectGeneration: 0, isHost: false,
    };
    room.players.set(player.uid, player);
  }
  room.totalRounds = 3;
  engine.startGame(room, room.hostUid, deps);
  const round = room.round!;
  for (const uid of round.participantUids) engine.markReady(room, uid, deps);
  engine.startCountdown(room, 5000, deps);
  engine.toDiscussion(room, deps);
  engine.startVoting(room, room.hostUid, deps);
  const [a, b, c, d] = round.participantUids;
  engine.submitVote(room, a, b, deps);
  engine.submitVote(room, b, a, deps);
  engine.submitVote(room, c, d, deps);
  engine.submitVote(room, d, c, deps);
  engine.computeResult(room, deps);
  assert.equal(room.round!.roundComplete, false);

  const view = buildView(room, room.hostUid, "https://good.example/join/ABCDE");
  const json = JSON.stringify(view.result);
  assert.equal(view.result?.impostorUid, undefined);
  assert.equal(view.result?.impostorName, undefined);
  assert.deepEqual(view.result?.voteBreakdown, []);
  assert.deepEqual(view.result?.roundScores, []);
  assert.ok(!json.includes("\"impostorUid\""));
  assert.ok(!json.includes("\"impostorName\""));
  assert.ok(!json.includes("voterWasImpostor"));
  assert.ok(!json.includes("\"correct\""));
});
