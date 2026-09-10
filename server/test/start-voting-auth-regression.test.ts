import test from "node:test";
import assert from "node:assert/strict";
import { RoomManager } from "../src/game/roomManager.js";
import { createRoom, joinPlayer, lastMessage, wait } from "./helpers.js";

async function waitForPhase(room: { phase: string }, phase: string, timeoutMs = 300): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (room.phase !== phase && Date.now() < deadline) await wait(2);
  assert.equal(room.phase, phase);
}

test("rejected legacy START_VOTING cannot cancel the authoritative discussion deadline", async () => {
  const manager = new RoomManager({
    rng: () => 0,
    countdownMs: 2,
    actionMs: 2,
    holdMs: 2,
    promptRevealMs: 2,
    discussionMs: 40,
    votingMs: 100,
  });
  const host = createRoom(manager);
  const players = Array.from({ length: 3 }, (_, index) => joinPlayer(manager, host.code, index + 2));
  const room = manager.roomForTests(host.code)!;

  try {
    manager.handle(host.conn, { t: "START_GAME" });
    for (const player of players) manager.handle(player.conn, { t: "MARK_READY" });
    await waitForPhase(room, "DISCUSSION");

    const discussionDeadline = room.phaseEndsAt;
    assert.ok(discussionDeadline);

    const accepted = manager.handle(players[0]!.conn, { t: "START_VOTING" });
    assert.equal(accepted, false);
    assert.equal(room.phase, "DISCUSSION");
    assert.equal(room.phaseEndsAt, discussionDeadline);
    assert.equal(lastMessage(players[0]!.socket, "ERROR")?.code, "NOT_HOST");

    await waitForPhase(room, "VOTING");
    assert.ok(room.phaseEndsAt && room.phaseEndsAt > discussionDeadline!);
  } finally {
    manager.dispose();
  }
});
