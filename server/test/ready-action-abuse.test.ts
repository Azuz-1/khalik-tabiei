import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomManager } from "../src/game/roomManager.js";
import { AbuseGuard } from "../src/security/rateLimit.js";
import { createRoom, joinPlayer, testUid } from "./helpers.js";

test("MARK_READY has a dedicated human-safe per-action rate limit", () => {
  const abuse = new AbuseGuard({ now: () => 0 });
  const uid = testUid(7);

  for (let attempt = 1; attempt <= 12; attempt += 1) {
    assert.equal(abuse.allowMessage(uid, "MARK_READY"), true, `ready ${attempt}`);
  }
  assert.equal(abuse.allowMessage(uid, "MARK_READY"), false);
  abuse.dispose();
});

test("repeated Ready is an idempotent no-op without room rebroadcast or activity refresh", () => {
  let now = 100;
  const manager = new RoomManager({ now: () => now, rng: () => 0, countdownMs: 10_000 });
  try {
    const host = createRoom(manager);
    const players = [2, 3, 4].map((index) => joinPlayer(manager, host.code, index));
    const room = manager.roomForTests(host.code)!;

    manager.handle(host.conn, { t: "START_GAME" });
    now = 200;
    assert.equal(manager.handle(players[0]!.conn, { t: "MARK_READY" }), true);
    assert.equal(room.meaningfulAt, 200);

    const messageCounts = [host.socket, ...players.map((player) => player.socket)].map(
      (socket) => socket.messages.length,
    );

    now = 300;
    assert.equal(manager.handle(players[0]!.conn, { t: "MARK_READY" }), true);
    assert.equal(room.phase, "QUESTION");
    assert.equal(room.meaningfulAt, 200, "duplicate Ready must not extend product activity");
    assert.deepEqual(
      [host.socket, ...players.map((player) => player.socket)].map((socket) => socket.messages.length),
      messageCounts,
      "duplicate Ready must not trigger a room-wide STATE broadcast",
    );
  } finally {
    manager.dispose();
  }
});
