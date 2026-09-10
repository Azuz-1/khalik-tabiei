import test from "node:test";
import assert from "node:assert/strict";
import * as engine from "../src/game/engine.js";
import { RoomManager } from "../src/game/roomManager.js";
import {
  authenticatedConnection,
  joinPlayer,
  lastMessage,
  testUid,
  wait,
} from "./helpers.js";

function createPlayerOwner(manager: RoomManager, name = "المالك") {
  const uid = testUid(1);
  const owner = authenticatedConnection(manager, uid);
  assert.equal(manager.handle(owner.conn, { t: "CREATE_ROOM", name }), true);
  const state = lastMessage(owner.socket, "STATE");
  assert.ok(state, "owner must receive room state");
  return { ...owner, uid, code: state.view.room.code, name };
}

async function waitForPhase(room: { phase: string }, phase: string, timeoutMs = 600): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (room.phase !== phase && Date.now() < deadline) await wait(2);
  assert.equal(room.phase, phase);
}

const directDeps = { rng: () => 0, now: () => 1_000 };

test("named room owner is projected as a real player with separate management capability", () => {
  const manager = new RoomManager({ rng: () => 0 });
  const owner = createPlayerOwner(manager, "سلمان");
  const room = manager.roomForTests(owner.code)!;
  const view = lastMessage(owner.socket, "STATE")!.view;

  assert.equal(room.players.size, 1);
  assert.equal(room.players.get(owner.uid)?.isHost, true);
  assert.equal(view.self.role, "player");
  assert.equal(view.self.isOwner, true);
  assert.equal(view.self.name, "سلمان");
  assert.equal(view.players.length, 1);
  assert.equal(view.players[0]?.uid, owner.uid);
  assert.equal(view.players[0]?.isHost, true);
  assert.equal(view.settingsEditable, true);
  assert.deepEqual(view.blockedPlayers, []);

  // Owner identity is present once in the authoritative broadcast fan-out.
  assert.equal(owner.socket.messages.filter((message) => message.t === "STATE").length, 1);
  manager.dispose();
});

test("three physical people can start because owner counts as one of the three players", () => {
  const manager = new RoomManager({ rng: () => 0 });
  const owner = createPlayerOwner(manager);
  const p2 = joinPlayer(manager, owner.code, 2);
  const p3 = joinPlayer(manager, owner.code, 3);

  assert.equal(manager.roomForTests(owner.code)?.players.size, 3);
  assert.equal(manager.handle(owner.conn, { t: "START_GAME" }), true);

  const room = manager.roomForTests(owner.code)!;
  assert.equal(room.round?.participantUids.length, 3);
  assert.ok(room.round?.participantUids.includes(owner.uid));
  assert.ok(room.round?.participantUids.includes(p2.uid));
  assert.ok(room.round?.participantUids.includes(p3.uid));

  // rng=0 selects the first active player, proving the owner can be impostor.
  assert.equal(room.round?.impostorUid, owner.uid);
  const ownerView = lastMessage(owner.socket, "STATE")!.view;
  assert.equal(ownerView.self.role, "player");
  assert.equal(ownerView.self.isOwner, true);
  assert.equal(ownerView.isImpostor, true);
  assert.equal(ownerView.myPrompt, undefined);

  const normalView = lastMessage(p2.socket, "STATE")!.view;
  assert.equal(normalView.isImpostor, false);
  assert.equal(typeof normalView.myPrompt?.text, "string");
  manager.dispose();
});

test("owner receives private ready/vote state and can vote like every other participant", () => {
  const manager = new RoomManager({ rng: () => 0 });
  const owner = createPlayerOwner(manager);
  const p2 = joinPlayer(manager, owner.code, 2);
  const p3 = joinPlayer(manager, owner.code, 3);
  assert.equal(manager.handle(owner.conn, { t: "START_GAME" }), true);

  const room = manager.roomForTests(owner.code)!;
  assert.equal(manager.handle(owner.conn, { t: "MARK_READY" }), true);
  assert.equal(room.round?.readyUids.has(owner.uid), true);

  // Advance deterministically without waiting for production physical timers.
  engine.startCountdown(room, 2_000, directDeps);
  engine.toAction(room, 2_000, directDeps);
  engine.toHold(room, 2_000, directDeps);
  engine.revealPrompt(room, 2_000, directDeps);
  engine.toDiscussion(room, directDeps);
  assert.equal(manager.handle(owner.conn, { t: "START_VOTING" }), true);

  let ownerView = lastMessage(owner.socket, "STATE")!.view;
  assert.equal(ownerView.self.role, "player");
  assert.equal(ownerView.myVoteSubmitted, false);
  assert.deepEqual(
    new Set(ownerView.voteTargets?.map((target) => target.uid)),
    new Set([p2.uid, p3.uid]),
  );

  assert.equal(manager.handle(owner.conn, { t: "SUBMIT_VOTE", targetUid: p2.uid }), true);
  ownerView = lastMessage(owner.socket, "STATE")!.view;
  assert.equal(ownerView.myVoteSubmitted, true);
  assert.equal(ownerView.votesProgress?.submitted, 1);
  assert.equal(ownerView.votesProgress?.total, 3);

  // Both normals catch the owner-impostor; owner ballot participates normally.
  assert.equal(manager.handle(p2.conn, { t: "SUBMIT_VOTE", targetUid: owner.uid }), true);
  assert.equal(manager.handle(p3.conn, { t: "SUBMIT_VOTE", targetUid: owner.uid }), true);
  assert.equal(room.phase, "RESULT");
  assert.equal(room.round?.groupFound, true);
  assert.equal(room.round?.sealedVotes?.size, 3);
  assert.equal(lastMessage(owner.socket, "STATE")!.view.result?.impostorName, owner.name);
  manager.dispose();
});

test("owner remains authorized for room controls while player role cannot kick the owner", () => {
  const manager = new RoomManager({ rng: () => 0 });
  const owner = createPlayerOwner(manager);
  const p2 = joinPlayer(manager, owner.code, 2);

  assert.equal(lastMessage(owner.socket, "STATE")!.view.self.role, "player");
  assert.equal(manager.handle(owner.conn, { t: "SET_SETTINGS", totalRounds: 6 }), true);
  assert.equal(manager.roomForTests(owner.code)?.targetChallenges, 6);

  assert.equal(manager.handle(p2.conn, { t: "SET_SETTINGS", totalRounds: 9 }), false);
  assert.equal(lastMessage(p2.socket, "ERROR")?.code, "NOT_HOST");

  assert.equal(manager.handle(owner.conn, { t: "KICK_PLAYER", uid: owner.uid }), false);
  assert.equal(lastMessage(owner.socket, "ERROR")?.code, "BAD_REQUEST");
  assert.equal(manager.roomForTests(owner.code)?.players.has(owner.uid), true);

  assert.equal(manager.handle(owner.conn, { t: "KICK_PLAYER", uid: p2.uid }), true);
  assert.equal(manager.roomForTests(owner.code)?.players.has(p2.uid), false);
  manager.dispose();
});

test("player-owner disconnect never pauses or closes the authoritative game clock", async () => {
  const manager = new RoomManager({
    rng: () => 0,
    countdownMs: 2,
    actionMs: 2,
    holdMs: 2,
    promptRevealMs: 2,
    discussionMs: 25,
    votingMs: 25,
    survivedTransitionMs: 200,
    hostDisconnectGraceMs: 5,
  });
  const owner = createPlayerOwner(manager);
  const p2 = joinPlayer(manager, owner.code, 2);
  const p3 = joinPlayer(manager, owner.code, 3);

  assert.equal(manager.handle(owner.conn, { t: "START_GAME" }), true);
  for (const participant of [owner, p2, p3]) {
    assert.equal(manager.handle(participant.conn, { t: "MARK_READY" }), true);
  }

  const room = manager.roomForTests(owner.code)!;
  await waitForPhase(room, "DISCUSSION");
  const discussionDeadline = room.phaseEndsAt;
  assert.ok(discussionDeadline && discussionDeadline > Date.now());

  manager.disconnect(owner.conn);
  assert.equal(room.players.get(owner.uid)?.connected, false);
  assert.equal(room.hostConnected, true, "legacy Host liveness must not follow the player-owner socket");
  assert.equal(room.hostCloseDeadline, undefined);
  assert.equal(room.pause, undefined);
  assert.equal(room.phaseEndsAt, discussionDeadline, "disconnect must not rewrite the authoritative deadline");

  await waitForPhase(room, "VOTING");
  assert.equal(manager.roomForTests(owner.code), room, "room survives beyond the old Host disconnect grace");
  await waitForPhase(room, "RESULT");
  assert.equal(room.round?.resultComputed, true);
  assert.equal(room.round?.abstainedUids?.size, 3, "missing owner ballot is handled by the global voting deadline");
  assert.equal(room.pause, undefined);

  const reconnected = authenticatedConnection(manager, owner.uid);
  assert.equal(room.players.get(owner.uid)?.connected, true);
  assert.equal(room.hostCloseDeadline, undefined);
  assert.equal(room.pause, undefined);
  const view = lastMessage(reconnected.socket, "STATE")!.view;
  assert.equal(view.self.role, "player");
  assert.equal(view.self.isOwner, true);
  assert.equal(view.self.connected, true);
  manager.dispose();
});

test("owner occupies one of the ten player slots and duplicate owner name is protected", () => {
  const manager = new RoomManager({ rng: () => 0 });
  const owner = createPlayerOwner(manager, "سالم");

  const duplicate = authenticatedConnection(manager, testUid(20));
  assert.equal(manager.handle(duplicate.conn, { t: "JOIN_ROOM", code: owner.code, name: "سالم\u200b" }), false);
  assert.equal(lastMessage(duplicate.socket, "ERROR")?.code, "DUPLICATE_NAME");

  for (let index = 2; index <= 10; index += 1) joinPlayer(manager, owner.code, index);
  assert.equal(manager.roomForTests(owner.code)?.players.size, 10);

  const extra = authenticatedConnection(manager, testUid(11));
  assert.equal(manager.handle(extra.conn, { t: "JOIN_ROOM", code: owner.code, name: "زيادة" }), false);
  assert.equal(lastMessage(extra.socket, "ERROR")?.code, "ROOM_FULL");
  manager.dispose();
});

test("invalid owner name fails before allocating a room", () => {
  const manager = new RoomManager();
  const owner = authenticatedConnection(manager, testUid(1));
  assert.equal(manager.handle(owner.conn, { t: "CREATE_ROOM", name: "\u200b\u2060" }), false);
  assert.equal(lastMessage(owner.socket, "ERROR")?.code, "INVALID_NAME");
  assert.equal(manager.roomCount, 0);
  manager.dispose();
});
