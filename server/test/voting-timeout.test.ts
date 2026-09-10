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
  manager.handle(host.conn, { t: "START_VOTING" });
  assert.equal(room.phase, "VOTING");

  const impostor = players.find((player) => player.uid === room.round!.impostorUid)!;
  const normals = players.filter((player) => player.uid !== impostor.uid);
  return { manager, host, players, room, impostor, normals };
}

test("a disconnected non-voter becomes an abstention only at the one global voting deadline", async () => {
  const { manager, room, impostor, normals } = await openFourPlayerVote(20);
  try {
    const disconnected = normals[0]!;
    manager.disconnect(disconnected.conn);

    for (const normal of normals.slice(1)) {
      manager.handle(normal.conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
    }
    manager.handle(impostor.conn, { t: "SUBMIT_VOTE", targetUid: normals[1]!.uid });

    assert.equal(room.phase, "VOTING", "disconnect must not create a private grace timer or resolve early");
    await wait(50);

    assert.equal(room.phase, "RESULT");
    assert.equal(room.round!.resolutionSealed, true);
    assert.equal(room.round!.sealedParticipants?.length, 4, "the original participant set stays sealed");
    assert.equal(room.round!.sealedVotes?.size, 3, "the missing ballot stays an abstention");
    assert.equal(room.round!.abstainedUids?.has(disconnected.uid), true);
    assert.equal(room.round!.resultRequiredVotes, 2, "three ballots cast require a strict majority of two");
    assert.equal(room.round!.groupFound, true, "two of three cast ballots catch the impostor");
    assert.equal(room.completedChallenges, 1);
  } finally {
    manager.dispose();
  }
});

test("a disconnected player may reconnect and cast before the same global deadline", async () => {
  const { manager, room, impostor, normals } = await openFourPlayerVote(150);
  try {
    const disconnected = normals[0]!;
    manager.disconnect(disconnected.conn);

    for (const normal of normals.slice(1)) {
      manager.handle(normal.conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
    }
    manager.handle(impostor.conn, { t: "SUBMIT_VOTE", targetUid: normals[1]!.uid });

    await wait(15);
    const reconnected = authenticatedConnection(manager, disconnected.uid);
    assert.equal(room.phase, "VOTING");
    assert.equal(room.round!.abstainedUids?.has(disconnected.uid), false);
    assert.equal(room.round!.resolutionSealed, undefined);

    manager.handle(reconnected.conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
    assert.equal(room.phase, "RESULT", "all four submitted ballots resolve immediately without waiting for timeout");
    assert.equal(room.round!.sealedVotes?.size, 4);
    assert.equal(room.round!.resultRequiredVotes, 3);
    assert.equal(room.round!.groupFound, true);
  } finally {
    manager.dispose();
  }
});
