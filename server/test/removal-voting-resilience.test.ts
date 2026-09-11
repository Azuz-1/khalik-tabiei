import { test } from "node:test";
import assert from "node:assert/strict";
import * as engine from "../src/game/engine.js";
import { RoomManager } from "../src/game/roomManager.js";
import type { RoomState } from "../src/game/state.js";
import {
  createRoom,
  joinPlayer,
  lastMessage,
  wait,
} from "./helpers.js";

async function setupVoting(votingMs = 15_000) {
  const manager = new RoomManager({
    rng: () => 0,
    countdownMs: 2,
    actionMs: 2,
    holdMs: 2,
    promptRevealMs: 2,
    votingMs,
    survivedTransitionMs: 500,
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
  });
  manager.handle(host.conn, { t: "START_GAME" });
  for (const player of players) manager.handle(player.conn, { t: "MARK_READY" });

  const deadline = Date.now() + 200;
  while (room.phase !== "DISCUSSION" && Date.now() < deadline) await wait(2);
  assert.equal(room.phase, "DISCUSSION");
  manager.handle(host.conn, { t: "START_VOTING" });
  assert.equal(room.phase, "VOTING");

  return { manager, host, players, room };
}

function castThreeVotesWithMissingNormal(
  manager: RoomManager,
  room: RoomState,
  players: Awaited<ReturnType<typeof setupVoting>>["players"],
) {
  const impostor = players.find((player) => player.uid === room.round!.impostorUid)!;
  const normals = players.filter((player) => player.uid !== impostor.uid);
  const missing = normals.at(-1)!;
  const voters = players.filter((player) => player.uid !== missing.uid);
  const remainingNormals = voters.filter((player) => player.uid !== impostor.uid);

  // The impostor's already-cast ballot targets D. After D leaves, this ballot
  // is intentionally wasted but remains committed. The two remaining normals
  // vote for the impostor so the recalculated cast-vote majority is exercised.
  manager.handle(impostor.conn, {
    t: "SUBMIT_VOTE",
    targetUid: missing.uid,
  });
  manager.handle(remainingNormals[0].conn, {
    t: "SUBMIT_VOTE",
    targetUid: impostor.uid,
  });
  manager.handle(remainingNormals[1].conn, {
    t: "SUBMIT_VOTE",
    targetUid: impostor.uid,
  });

  assert.equal(room.phase, "VOTING");
  assert.equal(room.round!.votes.size, 3);
  assert.equal(room.round!.votes.get(impostor.uid), missing.uid);
  assert.equal(room.round!.votes.has(missing.uid), false);

  return { impostor, missing, voters };
}

function assertCommittedRemovalResult(
  host: Awaited<ReturnType<typeof setupVoting>>["host"],
  room: RoomState,
  impostorUid: string,
  missingUid: string,
  voterUids: string[],
): void {
  assert.equal(room.players.has(missingUid), false);
  assert.equal(room.round!.participantUids.includes(missingUid), false);
  assert.equal(room.round!.votes.get(impostorUid), missingUid, "targeted ballot stays committed");
  for (const uid of voterUids) assert.equal(room.round!.votes.has(uid), true, `${uid} stays submitted`);
  assert.equal(room.round!.votes.size, 3);
  assert.equal(engine.allVoted(room), true);
  assert.equal(room.phase, "RESULT");

  const view = lastMessage(host.socket, "STATE")!.view;
  assert.equal(view.result?.requiredVotes, 2, "majority uses all three committed ballots");
  assert.equal(view.result?.votesCast, 3, "ballot aimed at the removed target remains in the denominator");
  assert.equal(view.result?.groupFound, true);
  assert.equal(view.result?.roundComplete, true);
  assert.equal(view.result?.voteTally?.length, 3);
  assert.equal(view.result?.voteTally?.some((row) => row.uid === missingUid), false);
  assert.equal(view.result?.voteTally?.reduce((sum, row) => sum + row.votes, 0), 2);
  assert.equal(view.players.some((player) => player.uid === missingUid), false);

  const json = JSON.stringify(view);
  assert.equal(json.includes("voterUid"), false);
  assert.equal(json.includes("voterName"), false);
  assert.equal(json.includes("targetUid"), false);
  assert.equal(json.includes("voteBreakdown"), false);
}

test("KICK_PLAYER keeps votes targeting removed normal committed and finishes voting", async () => {
  const { manager, host, players, room } = await setupVoting();
  const { impostor, missing, voters } = castThreeVotesWithMissingNormal(manager, room, players);

  manager.handle(host.conn, { t: "KICK_PLAYER", uid: missing.uid });

  assertCommittedRemovalResult(
    host,
    room,
    impostor.uid,
    missing.uid,
    voters.map((player) => player.uid),
  );
  manager.dispose();
});

test("LEAVE_ROOM keeps votes targeting leaving normal committed and finishes voting", async () => {
  const { manager, host, players, room } = await setupVoting();
  const { impostor, missing, voters } = castThreeVotesWithMissingNormal(manager, room, players);

  manager.handle(missing.conn, { t: "LEAVE_ROOM" });

  assertCommittedRemovalResult(
    host,
    room,
    impostor.uid,
    missing.uid,
    voters.map((player) => player.uid),
  );
  manager.dispose();
});

async function assertRemovedTargetBallotDoesNotStrengthenRemainingVote(
  remove: "kick" | "leave",
): Promise<void> {
  const { manager, host, players, room } = await setupVoting(35);
  try {
    const round = room.round!;
    const impostor = players.find((player) => player.uid === round.impostorUid)!;
    const normals = players.filter((player) => player.uid !== impostor.uid);
    const departingTarget = normals[2]!;
    const impostorVoter = normals[0]!;
    const wastedBallotVoter = normals[1]!;

    manager.handle(impostorVoter.conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
    manager.handle(wastedBallotVoter.conn, { t: "SUBMIT_VOTE", targetUid: departingTarget.uid });

    if (remove === "kick") manager.handle(host.conn, { t: "KICK_PLAYER", uid: departingTarget.uid });
    else manager.handle(departingTarget.conn, { t: "LEAVE_ROOM" });

    const deadline = Date.now() + 250;
    while (room.phase !== "RESULT" && Date.now() < deadline) await wait(2);
    assert.equal(room.phase, "RESULT");
    assert.equal(round.sealedVotes?.size, 2, "both ballots cast by remaining voters stay in the denominator");
    assert.equal(round.sealedVotes?.get(wastedBallotVoter.uid), departingTarget.uid, "vote on departed target remains committed");
    assert.equal(round.resultRequiredVotes, 2);
    assert.equal(round.groupFound, false, "one impostor vote out of two cast ballots is a tie, not a catch");
    assert.equal(round.roundComplete, false);
  } finally {
    manager.dispose();
  }
}

test("KICK_PLAYER cannot turn a wasted committed ballot into a one-vote catch", async () => {
  await assertRemovedTargetBallotDoesNotStrengthenRemainingVote("kick");
});

test("LEAVE_ROOM cannot turn a wasted committed ballot into a one-vote catch", async () => {
  await assertRemovedTargetBallotDoesNotStrengthenRemainingVote("leave");
});
