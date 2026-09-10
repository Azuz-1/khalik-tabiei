import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomManager } from "../src/game/roomManager.js";
import {
  authenticatedConnection,
  createRoom,
  joinPlayer,
  wait,
} from "./helpers.js";

async function openFourPlayerVote(votingMs: number) {
  const manager = new RoomManager({
    rng: () => 0,
    countdownMs: 2,
    actionMs: 2,
    holdMs: 2,
    promptRevealMs: 2,
    votingMs,
  });
  const host = createRoom(manager);
  const players = [2, 3, 4, 5].map((index) => joinPlayer(manager, host.code, index));
  const room = manager.roomForTests(host.code)!;

  manager.handle(host.conn, { t: "START_GAME" });
  for (const player of players) manager.handle(player.conn, { t: "MARK_READY" });

  const deadline = Date.now() + 500;
  while (room.phase !== "DISCUSSION" && Date.now() < deadline) await wait(2);
  assert.equal(room.phase, "DISCUSSION");
  // Non-production compatibility hook: production transitions automatically.
  manager.handle(host.conn, { t: "START_VOTING" });
  assert.equal(room.phase, "VOTING");
  assert.ok(room.phaseEndsAt);

  const impostor = players.find((player) => player.uid === room.round!.impostorUid)!;
  const normals = players.filter((player) => player.uid !== impostor.uid);
  return { manager, host, players, room, impostor, normals };
}

test("a disconnected non-voter becomes an abstention only at the global voting deadline", async () => {
  const { manager, room, impostor, normals } = await openFourPlayerVote(30);
  try {
    const disconnected = normals[0]!;
    manager.disconnect(disconnected.conn);

    for (const normal of normals.slice(1)) {
      manager.handle(normal.conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
    }
    manager.handle(impostor.conn, { t: "SUBMIT_VOTE", targetUid: normals[1]!.uid });

    assert.equal(room.phase, "VOTING", "a missing ballot keeps voting open until the one global deadline");
    assert.equal(room.round!.abstainedUids?.has(disconnected.uid), false, "abstention is not declared early");
    await wait(60);

    assert.equal(room.phase, "RESULT");
    assert.equal(room.round!.resolutionSealed, true);
    assert.equal(room.round!.sealedParticipants?.length, 4, "original participant set must stay sealed");
    assert.equal(room.round!.sealedVotes?.size, 3, "the disconnected missing ballot stays an abstention");
    assert.equal(room.round!.abstainedUids?.has(disconnected.uid), true);
    assert.equal(room.round!.resultRequiredVotes, 2, "three ballots cast require a strict majority of two");
    assert.equal(room.round!.groupFound, true, "two impostor votes out of three submitted ballots catch the impostor");
    assert.equal(room.completedChallenges, 1);
  } finally {
    manager.dispose();
  }
});

test("reconnecting during voting restores the ballot without extending the global deadline", async () => {
  const { manager, room, impostor, normals } = await openFourPlayerVote(100);
  try {
    const disconnected = normals[0]!;
    const originalDeadline = room.phaseEndsAt;
    manager.disconnect(disconnected.conn);

    for (const normal of normals.slice(1)) {
      manager.handle(normal.conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
    }
    manager.handle(impostor.conn, { t: "SUBMIT_VOTE", targetUid: normals[1]!.uid });

    await wait(10);
    const reconnected = authenticatedConnection(manager, disconnected.uid);
    assert.equal(room.phase, "VOTING");
    assert.equal(room.phaseEndsAt, originalDeadline, "reconnect must not reset or extend the voting clock");
    assert.equal(room.round!.abstainedUids?.has(disconnected.uid), false);
    assert.equal(room.round!.resolutionSealed, undefined);

    manager.handle(reconnected.conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
    assert.equal(room.phase, "RESULT", "all four ballots resolve immediately before the deadline");
    assert.equal(room.round!.sealedVotes?.size, 4);
    assert.equal(room.round!.resultRequiredVotes, 3);
    assert.equal(room.round!.groupFound, true);
  } finally {
    manager.dispose();
  }
});
