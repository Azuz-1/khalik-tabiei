import test from "node:test";
import assert from "node:assert/strict";
import * as engine from "../src/game/engine.js";
import { RoomManager } from "../src/game/roomManager.js";
import { authenticatedConnection, createRoom, joinPlayer, wait } from "./helpers.js";

function advanceToVoting(manager: RoomManager, host: ReturnType<typeof createRoom>, room: NonNullable<ReturnType<RoomManager["roomForTests"]>>): void {
  const deps = { now: Date.now, rng: () => 0.5 };
  engine.startCountdown(room, Date.now() + 1, deps);
  engine.toAction(room, Date.now() + 1, deps);
  engine.toHold(room, Date.now() + 1, deps);
  engine.revealPrompt(room, Date.now() + 1, deps);
  engine.toDiscussion(room, deps);
  assert.equal(manager.handle(host.conn, { t: "START_VOTING" }), true);
  assert.equal(room.phase, "VOTING");
}

for (const playerCount of [3, 10] as const) {
  test(`${playerCount}-player voting keeps original majority after one disconnected abstention`, async () => {
    const manager = new RoomManager({ rng: () => 0.2, votingDisconnectGraceMs: 15 });
    const host = createRoom(manager);
    const players = Array.from({ length: playerCount }, (_, index) => joinPlayer(manager, host.code, index + 2));
    assert.equal(manager.handle(host.conn, { t: "START_GAME" }), true);
    const room = manager.roomForTests(host.code)!;
    advanceToVoting(manager, host, room);

    const impostorUid = room.round!.impostorUid;
    const normals = players.filter((player) => player.uid !== impostorUid);
    const disconnected = normals[0]!;
    manager.disconnect(disconnected.conn);
    assert.equal(room.players.get(disconnected.uid)?.connected, false);

    const required = Math.floor(playerCount / 2) + 1;
    const connectedNormals = normals.slice(1);
    const correctVoters = new Set(connectedNormals.slice(0, required - 1).map((player) => player.uid));

    for (const player of players) {
      if (player.uid === disconnected.uid) continue;
      let targetUid: string;
      if (correctVoters.has(player.uid)) {
        targetUid = impostorUid;
      } else {
        targetUid = players.find((candidate) => candidate.uid !== player.uid && candidate.uid !== impostorUid)?.uid
          ?? players.find((candidate) => candidate.uid !== player.uid)!.uid;
      }
      assert.equal(manager.handle(player.conn, { t: "SUBMIT_VOTE", targetUid }), true);
    }

    assert.equal(room.phase, "VOTING", "server must wait for reconnect grace before abstaining the missing voter");
    assert.equal(room.round?.votes.size, playerCount - 1);
    await wait(40);

    assert.equal(room.phase, "RESULT");
    assert.equal(room.round?.abstainedUids?.has(disconnected.uid), true);
    assert.equal(room.round?.resultRequiredVotes, required);
    assert.equal(room.round?.groupFound, false, `${required - 1} impostor votes must not become a catch after disconnect`);

    const restored = authenticatedConnection(manager, disconnected.uid);
    assert.equal(room.players.get(disconnected.uid)?.connected, true);
    assert.equal(room.phase, "RESULT", "late reconnect must not reopen sealed voting");
    assert.equal(restored.conn.uid, disconnected.uid);
    manager.dispose();
  });
}
