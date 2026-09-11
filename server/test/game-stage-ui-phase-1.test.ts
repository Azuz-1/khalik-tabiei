import test from "node:test";
import assert from "node:assert/strict";
import { TIMERS } from "../../shared/constants.js";
import * as engine from "../src/game/engine.js";
import { RoomManager } from "../src/game/roomManager.js";
import { createRoomState, type InternalPlayer } from "../src/game/state.js";
import { createRoom, joinPlayer, lastMessage, wait } from "./helpers.js";

test("physical sequence keeps five seconds for both countdown and look-around beat", () => {
  assert.equal(TIMERS.COUNTDOWN, 5_000);
  assert.equal(TIMERS.HOLD, 5_000);
});

test("prompt reveal remains after the look-around hold state", () => {
  const room = createRoomState("STG01", "host", 1_000);
  for (let index = 1; index <= 3; index += 1) {
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

  const deps = { now: () => 1_000, rng: () => 0 };
  engine.startGame(room, "host", deps);
  for (const uid of room.round!.participantUids) engine.markReady(room, uid, deps);

  engine.startCountdown(room, 6_000, deps);
  assert.equal(room.phase, "COUNTDOWN");
  engine.toAction(room, 7_000, deps);
  assert.equal(room.phase, "ACTION");
  engine.toHold(room, 12_000, deps);
  assert.equal(room.phase, "HOLD");
  assert.equal(room.phaseEndsAt, 12_000);
  engine.revealPrompt(room, 14_500, deps);
  assert.equal(room.phase, "PROMPT_REVEAL");
});

test("only the host can advance RESULT and a repeated Next cannot skip a Challenge", async () => {
  const manager = new RoomManager({
    rng: () => 0,
    countdownMs: 2,
    actionMs: 2,
    holdMs: 2,
    promptRevealMs: 2,
  });

  try {
    const host = createRoom(manager);
    const players = Array.from({ length: 3 }, (_, index) => joinPlayer(manager, host.code, index + 2));
    const room = manager.roomForTests(host.code)!;

    manager.handle(host.conn, { t: "SET_SETTINGS", selectedModes: ["HANDS", "POINT", "NUMBER"] });
    manager.handle(host.conn, { t: "START_GAME" });
    for (const player of players) manager.handle(player.conn, { t: "MARK_READY" });

    const deadline = Date.now() + 500;
    while (room.phase !== "DISCUSSION" && Date.now() < deadline) await wait(2);
    assert.equal(room.phase, "DISCUSSION");

    manager.handle(host.conn, { t: "START_VOTING" });
    const impostor = players.find((player) => player.uid === room.round!.impostorUid)!;
    const normals = players.filter((player) => player.uid !== impostor.uid);
    for (const normal of normals) manager.handle(normal.conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
    manager.handle(impostor.conn, { t: "SUBMIT_VOTE", targetUid: normals[0]!.uid });

    assert.equal(room.phase, "RESULT");
    assert.equal(room.phaseEndsAt, undefined);

    manager.handle(normals[0]!.conn, { t: "NEXT_ROUND" });
    assert.equal(lastMessage(normals[0]!.socket, "ERROR")?.code, "NOT_HOST");
    assert.equal(room.phase, "RESULT", "a non-host cannot advance the shared result");

    manager.handle(host.conn, { t: "NEXT_ROUND" });
    assert.equal(room.phase, "QUESTION");
    const challengeIndex = room.round!.challengeIndex;

    manager.handle(host.conn, { t: "NEXT_ROUND" });
    assert.equal(lastMessage(host.socket, "ERROR")?.code, "INVALID_PHASE");
    assert.equal(room.phase, "QUESTION");
    assert.equal(room.round!.challengeIndex, challengeIndex, "a duplicate Next cannot skip the newly started Challenge");
  } finally {
    manager.dispose();
  }
});
