import test from "node:test";
import assert from "node:assert/strict";
import { TIMERS } from "../../shared/constants.js";
import * as engine from "../src/game/engine.js";
import { createRoomState, type InternalPlayer } from "../src/game/state.js";

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
