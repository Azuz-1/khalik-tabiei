import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomManager } from "../src/game/roomManager.js";
import { createRoom, joinPlayer, lastMessage, wait } from "./helpers.js";

async function waitForPhase(room: { phase: string }, phase: string): Promise<void> {
  const deadline = Date.now() + 500;
  while (room.phase !== phase && Date.now() < deadline) await wait(2);
  assert.equal(room.phase, phase);
}

async function completedIndividualResult() {
  const manager = new RoomManager({
    rng: () => 0,
    countdownMs: 2,
    actionMs: 2,
    holdMs: 2,
    promptRevealMs: 2,
  });
  const host = createRoom(manager);
  const players = Array.from({ length: 4 }, (_, index) =>
    joinPlayer(manager, host.code, index + 2),
  );
  const room = manager.roomForTests(host.code)!;

  manager.handle(host.conn, {
    t: "SET_SETTINGS",
    totalRounds: 3,
    selectedModes: ["HANDS", "POINT", "NUMBER"],
    playStyle: "INDIVIDUAL",
  });
  manager.handle(host.conn, { t: "START_GAME" });
  for (const player of players) manager.handle(player.conn, { t: "MARK_READY" });
  await waitForPhase(room, "DISCUSSION");
  manager.handle(host.conn, { t: "START_VOTING" });

  const impostor = players.find((player) => player.uid === room.round!.impostorUid)!;
  const normals = players.filter((player) => player.uid !== impostor.uid);
  for (const normal of normals) {
    manager.handle(normal.conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
  }
  manager.handle(impostor.conn, { t: "SUBMIT_VOTE", targetUid: normals[0].uid });

  assert.equal(room.phase, "RESULT");
  assert.equal(room.round!.roundComplete, true);
  const before = lastMessage(host.socket, "STATE")!.view;
  assert.ok(before.result);
  assert.ok(before.scoreboard);
  assert.equal(before.result.requiredVotes, 3);
  assert.equal(before.result.voteTally.length, 4);
  assert.equal(room.round!.resultRequiredVotes, 3);
  assert.equal(room.round!.resultImpostorName, before.result.impostorName);
  assert.deepEqual(room.round!.resultVoteTally, before.result.voteTally);

  return { manager, host, players, room, impostor, normals, before };
}

test("completed RESULT stays historically frozen when a normal is kicked afterward", async () => {
  const { manager, host, room, normals, before } = await completedIndividualResult();
  const removed = normals.at(-1)!;
  const beforeResult = JSON.stringify(before.result);
  const remainingScores = new Map(
    normals
      .filter((normal) => normal.uid !== removed.uid)
      .map((normal) => [normal.uid, room.players.get(normal.uid)!.score]),
  );

  manager.handle(host.conn, { t: "KICK_PLAYER", uid: removed.uid });
  assert.equal(room.phase, "RESULT", "three participants remain, so the completed result stays visible");

  const after = lastMessage(host.socket, "STATE")!.view;
  assert.equal(JSON.stringify(after.result), beforeResult, "historical result must not be recomputed");
  assert.equal(after.result?.requiredVotes, 3, "original four-player majority remains frozen");
  assert.equal(after.result?.voteTally.length, 4, "historical tally keeps the removed participant row");
  assert.equal(after.players.some((player) => player.uid === removed.uid), false);
  assert.equal(after.scoreboard?.some((row) => row.uid === removed.uid), false);
  for (const [uid, score] of remainingScores) {
    assert.equal(room.players.get(uid)?.score, score, "removing someone else never erases earned score");
  }

  manager.dispose();
});

test("revealed impostor name and final tally survive the impostor being kicked after RESULT", async () => {
  const { manager, host, room, impostor, before } = await completedIndividualResult();
  const beforeName = before.result!.impostorName;
  const beforeTally = JSON.stringify(before.result!.voteTally);

  manager.handle(host.conn, { t: "KICK_PLAYER", uid: impostor.uid });
  assert.equal(room.phase, "RESULT", "completed history remains viewable with three players left");

  const after = lastMessage(host.socket, "STATE")!.view;
  assert.equal(after.result?.impostorUid, impostor.uid);
  assert.equal(after.result?.impostorName, beforeName);
  assert.notEqual(after.result?.impostorName, "—");
  assert.equal(JSON.stringify(after.result?.voteTally), beforeTally);
  assert.equal(after.result?.requiredVotes, 3);
  assert.equal(after.players.some((player) => player.uid === impostor.uid), false);
  assert.equal(after.scoreboard?.some((row) => row.uid === impostor.uid), false);

  manager.dispose();
});
