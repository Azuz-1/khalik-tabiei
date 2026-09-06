import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomManager } from "../src/game/roomManager.js";
import { createRoom, joinPlayer, lastMessage, wait } from "./helpers.js";

async function waitForPhase(room: { phase: string }, phase: string): Promise<void> {
  const deadline = Date.now() + 250;
  while (room.phase !== phase && Date.now() < deadline) await wait(2);
  assert.equal(room.phase, phase);
}

test("removed player with an earlier pending point never becomes a ghost scoreboard entry", async () => {
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
  const departing = normals[2];

  // Two correct guesses are below the 4-player majority of three. One belongs
  // to the player who will leave before this Round completes.
  manager.handle(normals[0].conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
  manager.handle(departing.conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
  manager.handle(normals[1].conn, { t: "SUBMIT_VOTE", targetUid: normals[0].uid });
  manager.handle(impostor.conn, { t: "SUBMIT_VOTE", targetUid: normals[1].uid });

  assert.equal(room.phase, "RESULT");
  assert.equal(room.round!.roundComplete, false);
  assert.equal(room.pendingRoundScores.get(normals[0].uid), 1);
  assert.equal(room.pendingRoundScores.get(departing.uid), 1);
  assert.ok([...room.players.values()].every((player) => player.score === 0));

  manager.handle(host.conn, { t: "NEXT_ROUND" });
  assert.equal(room.phase, "QUESTION");
  assert.equal(room.round!.challengeIndex, 2);
  assert.equal(room.round!.impostorUid, impostor.uid);

  manager.handle(host.conn, { t: "KICK_PLAYER", uid: departing.uid });
  assert.equal(room.players.has(departing.uid), false);
  assert.equal(room.round!.participantUids.includes(departing.uid), false);

  const remaining = players.filter((player) => room.players.has(player.uid));
  for (const player of remaining) manager.handle(player.conn, { t: "MARK_READY" });
  await waitForPhase(room, "DISCUSSION");
  manager.handle(host.conn, { t: "START_VOTING" });

  const remainingNormals = remaining.filter((player) => player.uid !== impostor.uid);
  manager.handle(remainingNormals[0].conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
  manager.handle(remainingNormals[1].conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
  manager.handle(impostor.conn, { t: "SUBMIT_VOTE", targetUid: remainingNormals[0].uid });

  assert.equal(room.phase, "RESULT");
  assert.equal(room.round!.roundComplete, true);
  assert.equal(room.pendingRoundScores.size, 0, "completed Round clears every pending entry");
  assert.equal(room.players.get(normals[0].uid)?.score, 2, "remaining earlier +1 is preserved");
  assert.equal(room.players.get(normals[1].uid)?.score, 1, "remaining current correct vote scores");
  assert.equal(room.players.get(impostor.uid)?.score, 0);

  const view = lastMessage(host.socket, "STATE")!.view;
  assert.ok(view.scoreboard);
  assert.equal(view.scoreboard.some((row) => row.uid === departing.uid), false);
  assert.equal(JSON.stringify(view).includes(departing.uid), false, "removed uid is absent from final view");

  manager.dispose();
});
