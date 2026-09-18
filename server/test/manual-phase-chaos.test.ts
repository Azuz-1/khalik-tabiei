import test from "node:test";
import assert from "node:assert/strict";
import type { GamePhase } from "../../shared/types.js";
import * as engine from "../src/game/engine.js";
import { RoomManager } from "../src/game/roomManager.js";
import { authenticatedConnection, createRoom, joinPlayer } from "./helpers.js";

const PHASES: readonly GamePhase[] = [
  "QUESTION",
  "COUNTDOWN",
  "ACTION",
  "HOLD",
  "PROMPT_REVEAL",
  "DISCUSSION",
  "VOTING",
  "RESULT",
];

function setup() {
  let clock = 1_000_000;
  const now = () => ++clock;
  const manager = new RoomManager({
    rng: () => 0.25,
    now,
    hostDisconnectGraceMs: 60_000,
    votingDisconnectGraceMs: 60_000,
    countdownMs: 60_000,
    actionMs: 60_000,
    holdMs: 60_000,
    promptRevealMs: 60_000,
  });
  const host = createRoom(manager);
  const players = [2, 3, 4, 5].map((index) => joinPlayer(manager, host.code, index));
  assert.equal(manager.handle(host.conn, { t: "SET_SETTINGS", totalRounds: 3, selectedModes: ["HANDS", "POINT", "NUMBER"] }), true);
  assert.equal(manager.handle(host.conn, { t: "START_GAME" }), true);
  const room = manager.roomForTests(host.code)!;
  return { manager, host, players, room, now };
}

function toPhase(ctx: ReturnType<typeof setup>, phase: GamePhase): void {
  const { manager, host, players, room, now } = ctx;
  const deps = { rng: () => 0.5, now };
  if (phase === "QUESTION") return;
  engine.startCountdown(room, now() + 60_000, deps);
  if (phase === "COUNTDOWN") return;
  engine.toAction(room, now() + 60_000, deps);
  if (phase === "ACTION") return;
  engine.toHold(room, now() + 60_000, deps);
  if (phase === "HOLD") return;
  engine.revealPrompt(room, now() + 60_000, deps);
  if (phase === "PROMPT_REVEAL") return;
  engine.toDiscussion(room, deps);
  if (phase === "DISCUSSION") return;
  assert.equal(manager.handle(host.conn, { t: "START_VOTING" }), true);
  if (phase === "VOTING") return;

  const impostorUid = room.round!.impostorUid;
  for (const player of players) {
    const targetUid = player.uid === impostorUid
      ? players.find((candidate) => candidate.uid !== player.uid)!.uid
      : impostorUid;
    assert.equal(manager.handle(player.conn, { t: "SUBMIT_VOTE", targetUid }), true);
  }
  assert.equal(room.phase, "RESULT");
}

for (const phase of PHASES) {
  test(`Host disconnect/reconnect is safe during ${phase}`, () => {
    const ctx = setup();
    toPhase(ctx, phase);
    const beforeRound = ctx.room.round;
    const beforePromptId = beforeRound?.promptId;
    const beforeImpostor = beforeRound?.impostorUid;

    ctx.manager.disconnect(ctx.host.conn);
    assert.equal(ctx.room.hostConnected, false);
    assert.equal(ctx.room.pause?.reason, "HOST_DISCONNECTED");
    assert.equal(ctx.room.pause?.originalPhase, phase);

    authenticatedConnection(ctx.manager, ctx.host.uid);
    assert.equal(ctx.room.hostConnected, true);
    assert.equal(ctx.room.pause, undefined);
    assert.equal(ctx.room.round?.promptId, beforePromptId);
    assert.equal(ctx.room.round?.impostorUid, beforeImpostor);

    const expectedPhase = phase === "ACTION" || phase === "HOLD" || phase === "COUNTDOWN"
      ? "COUNTDOWN"
      : phase;
    assert.equal(ctx.room.phase, expectedPhase);
    ctx.manager.dispose();
  });
}

for (const phase of PHASES) {
  test(`player disconnect/reconnect preserves seat and Challenge during ${phase}`, () => {
    const ctx = setup();
    toPhase(ctx, phase);
    const player = ctx.players[1]!;
    const seat = ctx.room.players.get(player.uid)?.seatNumber;
    const promptId = ctx.room.round?.promptId;
    const impostorUid = ctx.room.round?.impostorUid;
    const challengeIndex = ctx.room.round?.challengeIndex;

    ctx.manager.disconnect(player.conn);
    assert.equal(ctx.room.players.get(player.uid)?.connected, false);
    assert.equal(ctx.room.phase, phase);

    const restored = authenticatedConnection(ctx.manager, player.uid);
    assert.equal(ctx.room.players.get(player.uid)?.connected, true);
    assert.equal(ctx.room.players.get(player.uid)?.seatNumber, seat);
    assert.equal(ctx.room.round?.promptId, promptId);
    assert.equal(ctx.room.round?.impostorUid, impostorUid);
    assert.equal(ctx.room.round?.challengeIndex, challengeIndex);
    assert.equal(ctx.room.phase, phase);
    assert.equal(restored.conn.uid, player.uid);
    ctx.manager.dispose();
  });
}

test("player reconnect inside VOTING grace can still cast the missing ballot", () => {
  const ctx = setup();
  toPhase(ctx, "VOTING");
  const player = ctx.players[0]!;
  const target = ctx.players.find((candidate) => candidate.uid !== player.uid)!.uid;

  ctx.manager.disconnect(player.conn);
  assert.equal(ctx.room.players.get(player.uid)?.connected, false);
  const restored = authenticatedConnection(ctx.manager, player.uid);
  assert.equal(ctx.room.players.get(player.uid)?.connected, true);
  assert.equal(ctx.manager.handle(restored.conn, { t: "SUBMIT_VOTE", targetUid: target }), true);
  assert.equal(ctx.room.round?.votes.get(player.uid), target);
  assert.equal(ctx.room.round?.abstainedUids?.has(player.uid), false);
  ctx.manager.dispose();
});
