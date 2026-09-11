import test from "node:test";
import assert from "node:assert/strict";
import { RoomManager } from "../src/game/roomManager.js";
import {
  authenticatedConnection,
  joinPlayer,
  lastMessage,
  testUid,
  wait,
} from "./helpers.js";

function createNamedRoom(manager: RoomManager, name = "المالك") {
  const uid = testUid(1);
  const owner = authenticatedConnection(manager, uid);
  assert.equal(manager.handle(owner.conn, { t: "CREATE_ROOM", name }), true);
  const state = lastMessage(owner.socket, "STATE");
  if (!state) throw new Error("owner room state missing");
  return { ...owner, uid, code: state.view.room.code };
}

async function waitForPhase(manager: RoomManager, code: string, phase: string, timeoutMs = 1_000) {
  const room = manager.roomForTests(code)!;
  const deadline = Date.now() + timeoutMs;
  while (room.phase !== phase) {
    if (Date.now() >= deadline) throw new Error(`timed out waiting for ${phase}; current=${room.phase}`);
    await wait(5);
  }
  return room;
}

async function openVote() {
  const manager = new RoomManager({
    rng: () => 0.31,
    countdownMs: 2,
    actionMs: 2,
    holdMs: 2,
    promptRevealMs: 2,
    discussionMs: 5_000,
    votingMs: 5_000,
    survivedTransitionMs: 5_000,
    fullResultMs: 5_000,
  });
  const owner = createNamedRoom(manager);
  const players = [2, 3, 4].map((index) => joinPlayer(manager, owner.code, index));
  const actors = [owner, ...players];
  const room = manager.roomForTests(owner.code)!;
  assert.equal(manager.handle(owner.conn, { t: "START_GAME" }), true);
  for (const actor of actors) assert.equal(manager.handle(actor.conn, { t: "MARK_READY" }), true);
  await waitForPhase(manager, owner.code, "DISCUSSION");
  assert.equal(manager.handle(owner.conn, { t: "START_VOTING" }), true);
  assert.equal(room.phase, "VOTING");
  return { manager, owner, players, actors, room };
}

test("good cop: cooperative players can all vote and settle immediately without leaking target totals live", async () => {
  const { manager, owner, actors, room } = await openVote();
  try {
    const impostorUid = room.round!.impostorUid;
    const normalUid = room.round!.participantUids.find((uid) => uid !== impostorUid)!;
    for (const actor of actors) {
      const targetUid = actor.uid === impostorUid ? normalUid : impostorUid;
      assert.equal(manager.handle(actor.conn, { t: "SUBMIT_VOTE", targetUid }), true);
    }
    assert.equal(room.phase, "RESULT", "all submitted ballots should settle immediately");
    assert.equal(room.round!.groupFound, true);
    assert.equal(room.round!.sealedVotes?.size, actors.length);
    const ownerView = lastMessage(owner.socket, "STATE")!.view;
    assert.equal(ownerView.liveVoteTally, undefined);
  } finally {
    manager.dispose();
  }
});

test("bad cop: non-owner admin actions, self-vote, duplicate vote and disconnected voting are rejected without corrupting state", async () => {
  const { manager, owner, players, room } = await openVote();
  try {
    const attacker = players[0]!;
    const victim = players[1]!;

    assert.equal(manager.handle(attacker.conn, { t: "SET_ADMISSION", locked: true }), false);
    assert.equal(lastMessage(attacker.socket, "ERROR")?.code, "NOT_HOST");
    assert.equal(room.admissionLocked, false);

    assert.equal(manager.handle(attacker.conn, { t: "KICK_PLAYER", uid: victim.uid }), false);
    assert.equal(lastMessage(attacker.socket, "ERROR")?.code, "NOT_HOST");
    assert.equal(room.players.has(victim.uid), true);

    assert.equal(manager.handle(attacker.conn, { t: "SUBMIT_VOTE", targetUid: attacker.uid }), false);
    assert.equal(lastMessage(attacker.socket, "ERROR")?.code, "INVALID_VOTE");
    assert.equal(room.round!.votes.has(attacker.uid), false, "self-vote rejection must leave the ballot unused");

    const validTarget = room.round!.participantUids.find((uid) => uid !== attacker.uid)!;
    assert.equal(manager.handle(attacker.conn, { t: "SUBMIT_VOTE", targetUid: validTarget }), true);
    assert.equal(manager.handle(attacker.conn, { t: "SUBMIT_VOTE", targetUid: validTarget }), false);
    assert.equal(lastMessage(attacker.socket, "ERROR")?.code, "VOTE_ALREADY_SUBMITTED");
    assert.equal(room.round!.votes.get(attacker.uid), validTarget, "duplicate attempt must not replace the committed ballot");

    manager.disconnect(victim.conn);
    const targetForDisconnected = room.round!.participantUids.find((uid) => uid !== victim.uid)!;
    assert.equal(manager.handle(victim.conn, { t: "SUBMIT_VOTE", targetUid: targetForDisconnected }), false);
    assert.equal(lastMessage(victim.socket, "ERROR")?.code, "NOT_PLAYER");
    assert.equal(room.players.has(victim.uid), true, "transport loss still keeps the bad-cop seat in the room");

    assert.equal(manager.handle(owner.conn, { t: "KICK_PLAYER", uid: owner.uid }), false);
    assert.equal(lastMessage(owner.socket, "ERROR")?.code, "BAD_REQUEST");
    assert.equal(room.hostUid, owner.uid);
  } finally {
    manager.dispose();
  }
});

test("bad cop cannot vote before voting opens or replay an old request id for a different action", async () => {
  const manager = new RoomManager({ rng: () => 0.41 });
  const owner = createNamedRoom(manager);
  const players = [2, 3].map((index) => joinPlayer(manager, owner.code, index));
  const room = manager.roomForTests(owner.code)!;
  try {
    assert.equal(manager.handle(owner.conn, { t: "START_GAME" }), true);
    const attacker = players[0]!;
    const targetUid = players[1]!.uid;
    assert.equal(manager.handle(attacker.conn, { t: "SUBMIT_VOTE", targetUid }), false);
    assert.equal(lastMessage(attacker.socket, "ERROR")?.code, "INVALID_PHASE");
    assert.equal(room.round!.votes.size, 0);

    assert.equal(manager.handle(attacker.conn, { t: "MARK_READY", rid: "same-rid" }), true);
    assert.equal(manager.handle(attacker.conn, { t: "PING", sampleId: "same-rid" }), true, "PING is intentionally outside action dedupe");
    assert.equal(
      manager.handle(attacker.conn, { t: "LEAVE_ROOM", rid: "same-rid" }),
      false,
      "request id cannot be reused for a different mutation",
    );
    assert.equal(lastMessage(attacker.socket, "ERROR")?.code, "BAD_REQUEST");
    assert.equal(room.players.has(attacker.uid), true);
  } finally {
    manager.dispose();
  }
});
