import test from "node:test";
import assert from "node:assert/strict";
import * as engine from "../src/game/engine.js";
import { RoomManager } from "../src/game/roomManager.js";
import { createRoom, joinPlayer } from "./helpers.js";

function advance(room: NonNullable<ReturnType<RoomManager["roomForTests"]>>): void {
  const deps = { now: Date.now, rng: () => 0.5 };
  engine.startCountdown(room, Date.now() + 1, deps);
  engine.toAction(room, Date.now() + 1, deps);
  engine.toHold(room, Date.now() + 1, deps);
  engine.revealPrompt(room, Date.now() + 1, deps);
  engine.toDiscussion(room, deps);
}

function setup() {
  const manager = new RoomManager({ rng: () => 0 });
  const host = createRoom(manager);
  const players = [2, 3, 4].map((index) => joinPlayer(manager, host.code, index));
  assert.equal(manager.handle(host.conn, { t: "SET_SETTINGS", totalRounds: 3, selectedModes: ["HANDS"] }), true);
  assert.equal(manager.handle(host.conn, { t: "START_GAME" }), true);
  const room = manager.roomForTests(host.code)!;
  const impostor = players.find((player) => player.uid === room.round!.impostorUid)!;
  const normals = players.filter((player) => player.uid !== impostor.uid);
  assert.equal(normals.length, 2);
  return { manager, host, players, room, impostor, normals };
}

function playVote(
  ctx: ReturnType<typeof setup>,
  trackedCorrect: boolean,
  otherCorrect: boolean,
): void {
  const { manager, host, room, impostor, normals } = ctx;
  const tracked = normals[0]!;
  const other = normals[1]!;
  advance(room);
  assert.equal(manager.handle(host.conn, { t: "START_VOTING" }), true);

  assert.equal(manager.handle(tracked.conn, {
    t: "SUBMIT_VOTE",
    targetUid: trackedCorrect ? impostor.uid : other.uid,
  }), true);
  assert.equal(manager.handle(other.conn, {
    t: "SUBMIT_VOTE",
    targetUid: otherCorrect ? impostor.uid : tracked.uid,
  }), true);
  assert.equal(manager.handle(impostor.conn, { t: "SUBMIT_VOTE", targetUid: tracked.uid }), true);
  assert.equal(room.phase, "RESULT");
}

for (const scenario of [
  { name: "three final consecutive correct votes award +3", votes: [true, true, true], expected: 3 },
  { name: "wrong middle vote breaks the streak so final correct vote awards +1", votes: [true, false, true], expected: 1 },
  { name: "wrong final vote awards 0 even after two correct votes", votes: [true, true, false], expected: 0 },
] as const) {
  test(`manual scoring: ${scenario.name}`, () => {
    const ctx = setup();
    for (let index = 0; index < scenario.votes.length; index += 1) {
      playVote(ctx, scenario.votes[index]!, false);
      if (index < scenario.votes.length - 1) {
        assert.equal(ctx.room.round?.roundComplete, false);
        assert.equal(ctx.manager.handle(ctx.host.conn, { t: "NEXT_ROUND" }), true);
        assert.equal(ctx.room.round?.impostorUid, ctx.impostor.uid, "same impostor remains during active stint");
      }
    }

    assert.equal(ctx.room.round?.roundComplete, true);
    assert.equal(ctx.room.players.get(ctx.normals[0]!.uid)?.score, scenario.expected);
    assert.equal(ctx.room.players.get(ctx.impostor.uid)?.score, 3, "impostor receives +1 for each survived Challenge");
    ctx.manager.dispose();
  });
}

test("manual scoring: catching on Challenge 1 awards correct normals +1 and impostor 0", () => {
  const ctx = setup();
  playVote(ctx, true, true);
  assert.equal(ctx.room.round?.groupFound, true);
  assert.equal(ctx.room.round?.roundComplete, true);
  assert.equal(ctx.room.players.get(ctx.normals[0]!.uid)?.score, 1);
  assert.equal(ctx.room.players.get(ctx.normals[1]!.uid)?.score, 1);
  assert.equal(ctx.room.players.get(ctx.impostor.uid)?.score, 0);
  ctx.manager.dispose();
});
