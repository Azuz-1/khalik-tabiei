import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomManager } from "../src/game/roomManager.js";
import {
  authenticatedConnection,
  createRoom,
  joinPlayer,
  wait,
} from "./helpers.js";

async function openFourPlayerVote(votingDisconnectGraceMs: number) {
  const manager = new RoomManager({
    rng: () => 0,
    countdownMs: 2,
    actionMs: 2,
    holdMs: 2,
    promptRevealMs: 2,
    votingDisconnectGraceMs,
  });
  const host = createRoom(manager);
  const players = [2, 3, 4, 5].map((index) => joinPlayer(manager, host.code, index));
  const room = manager.roomForTests(host.code)!;

  manager.handle(host.conn, { t: "START_GAME" });
  for (const player of players) manager.handle(player.conn, { t: "MARK_READY" });

  const deadline = Date.now() + 500;
  while (room.phase !== "DISCUSSION" && Date.now() < deadline) await wait(2);
  assert.equal(room.phase, "DISCUSSION");
  manager.handle(host.conn, { t: "START_VOTING" });
  assert.equal(room.phase, "VOTING");

  const impostor = players.find((player) => player.uid === room.round!.impostorUid)!;
  const normals = players.filter((player) => player.uid !== impostor.uid);
  return { manager, host, players, room, impostor, normals };
}

test("a disconnected non-voter becomes an abstention after grace without lowering the majority", async () => {
  const { manager, room, impostor, normals } = await openFourPlayerVote(15);
  try {
    const disconnected = normals[0]!;
    manager.disconnect(disconnected.conn);

    for (const normal of normals.slice(1)) {
      manager.handle(normal.conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
    }
    manager.handle(impostor.conn, { t: "SUBMIT_VOTE", targetUid: normals[1]!.uid });

    assert.equal(room.phase, "VOTING", "ballot must remain open during reconnect grace");
    await wait(40);

    assert.equal(room.phase, "RESULT");
    assert.equal(room.round!.resolutionSealed, true);
    assert.equal(room.round!.sealedParticipants?.length, 4, "original participant set must stay sealed");
    assert.equal(room.round!.sealedVotes?.size, 3, "the disconnected missing ballot must stay an abstention");
    assert.equal(room.round!.abstainedUids?.has(disconnected.uid), true);
    assert.equal(room.round!.resultRequiredVotes, 3, "four original participants still require three votes");
    assert.equal(room.round!.groupFound, false, "two votes must not catch the impostor after a disconnect");
    assert.equal(room.completedChallenges, 1);
  } finally {
    manager.dispose();
  }
});

test("reconnecting during voting grace restores the player's ballot", async () => {
  const { manager, room, impostor, normals } = await openFourPlayerVote(60);
  try {
    const disconnected = normals[0]!;
    manager.disconnect(disconnected.conn);

    for (const normal of normals.slice(1)) {
      manager.handle(normal.conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
    }
    manager.handle(impostor.conn, { t: "SUBMIT_VOTE", targetUid: normals[1]!.uid });

    await wait(10);
    const reconnected = authenticatedConnection(manager, disconnected.uid);
    await wait(70);

    assert.equal(room.phase, "VOTING", "reconnect must cancel the pending abstention");
    assert.equal(room.round!.abstainedUids?.has(disconnected.uid), false);
    assert.equal(room.round!.resolutionSealed, undefined);

    manager.handle(reconnected.conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
    assert.equal(room.phase, "RESULT");
    assert.equal(room.round!.sealedVotes?.size, 4);
    assert.equal(room.round!.resultRequiredVotes, 3);
    assert.equal(room.round!.groupFound, true);
  } finally {
    manager.dispose();
  }
});
