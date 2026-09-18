import test from "node:test";
import assert from "node:assert/strict";
import { TIMERS } from "../../shared/constants.js";
import { RoomManager } from "../src/game/roomManager.js";
import {
  authenticatedConnection,
  joinPlayer,
  lastMessage,
  testUid,
  wait,
} from "./helpers.js";

const SCALE_MS_PER_SECOND = 20;
const scaled = (seconds: number) => seconds * SCALE_MS_PER_SECOND;

function createNamedRoom(manager: RoomManager, name = "المالك") {
  const uid = testUid(1);
  const owner = authenticatedConnection(manager, uid);
  assert.equal(manager.handle(owner.conn, { t: "CREATE_ROOM", name }), true);
  const state = lastMessage(owner.socket, "STATE");
  if (!state) throw new Error("owner room state missing");
  return { ...owner, uid, code: state.view.room.code, name };
}

async function waitForCondition(predicate: () => boolean, timeoutMs = 4_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error("condition was not reached before timeout");
    await wait(10);
  }
}

async function openDiscussion(playerCount = 4) {
  const manager = new RoomManager({
    rng: () => 0.27,
    countdownMs: 5,
    actionMs: 5,
    holdMs: 5,
    promptRevealMs: 5,
    discussionMs: scaled(45),
    votingMs: scaled(15),
    ownerTransferGraceMs: scaled(60),
    survivedTransitionMs: 5_000,
    fullResultMs: 5_000,
  });
  const owner = createNamedRoom(manager);
  const joined = [];
  for (let index = 2; index <= playerCount; index += 1) {
    joined.push({ ...joinPlayer(manager, owner.code, index), name: `لاعب${index}` });
  }
  const room = manager.roomForTests(owner.code)!;
  assert.equal(manager.handle(owner.conn, { t: "START_GAME" }), true);
  for (const actor of [owner, ...joined]) {
    assert.equal(manager.handle(actor.conn, { t: "MARK_READY" }), true);
  }
  await waitForCondition(() => room.phase === "DISCUSSION");
  return { manager, owner, joined, room };
}

function validTarget(room: ReturnType<RoomManager["roomForTests"]>, voterUid: string): string {
  assert.ok(room?.round);
  const impostorUid = room.round.impostorUid;
  if (voterUid !== impostorUid) return impostorUid;
  const fallback = room.round.participantUids.find((uid) => uid !== voterUid);
  assert.ok(fallback);
  return fallback;
}

test("production liveness windows are exactly 45s discussion, 15s voting, 60s owner-transfer, 30s ready recovery", () => {
  assert.equal(TIMERS.DISCUSSION, 45_000);
  assert.equal(TIMERS.VOTING, 15_000);
  assert.equal(TIMERS.OWNER_TRANSFER_GRACE, 60_000);
  assert.equal(TIMERS.READY_DISCONNECT_GRACE, 30_000);
});

test("a non-owner phone can be offline for the equivalent of 30 seconds of discussion and rejoin the same seat", async () => {
  const { manager, joined, room } = await openDiscussion(4);
  try {
    const sleeper = joined[0]!;
    const seatBefore = room.players.get(sleeper.uid)?.seatNumber;
    manager.disconnect(sleeper.conn);
    assert.equal(room.players.has(sleeper.uid), true, "disconnect must not remove the player seat");
    assert.equal(room.players.get(sleeper.uid)?.connected, false);

    await wait(scaled(30));
    assert.equal(room.phase, "DISCUSSION", "30 seconds into a 45 second discussion must still be discussion");
    assert.equal(room.players.has(sleeper.uid), true);

    const reconnected = authenticatedConnection(manager, sleeper.uid);
    assert.equal(room.players.get(sleeper.uid)?.connected, true);
    assert.equal(room.players.get(sleeper.uid)?.seatNumber, seatBefore, "reconnect must preserve the occupied seat");

    await waitForCondition(() => room.phase === "VOTING");
    assert.equal(
      manager.handle(reconnected.conn, { t: "SUBMIT_VOTE", targetUid: validTarget(room, sleeper.uid) }),
      true,
      "reconnected player can vote in the same global ballot window",
    );
    assert.equal(room.players.has(sleeper.uid), true);
  } finally {
    manager.dispose();
  }
});

test("a non-owner phone offline for a full minute is not kicked; missing the vote becomes only an abstention", async () => {
  const { manager, owner, joined, room } = await openDiscussion(4);
  try {
    const sleeper = joined[0]!;
    manager.disconnect(sleeper.conn);
    assert.equal(room.players.has(sleeper.uid), true);
    assert.equal(room.players.get(sleeper.uid)?.connected, false);

    await waitForCondition(() => room.phase === "VOTING");
    for (const actor of [owner, ...joined.slice(1)]) {
      assert.equal(
        manager.handle(actor.conn, { t: "SUBMIT_VOTE", targetUid: validTarget(room, actor.uid) }),
        true,
      );
    }

    await waitForCondition(() => room.phase === "RESULT");
    assert.equal(room.players.has(sleeper.uid), true, "voting timeout must not eject an offline participant");
    assert.equal(room.round?.sealedParticipants?.some((participant) => participant.uid === sleeper.uid), true);
    assert.equal(room.round?.abstainedUids?.has(sleeper.uid), true, "missing ballot is recorded as abstention only");
    assert.equal(room.round?.sealedVotes?.has(sleeper.uid), false);

    const reconnected = authenticatedConnection(manager, sleeper.uid);
    assert.equal(room.players.get(sleeper.uid)?.connected, true, "same signed identity reconnects to its existing player");
    assert.equal(reconnected.conn.roomCode, room.code);
  } finally {
    manager.dispose();
  }
});

test("named owner offline through discussion+voting does not pause the game; after 60s authority transfers but the owner seat remains", async () => {
  const { manager, owner, joined, room } = await openDiscussion(4);
  try {
    const originalOwnerUid = owner.uid;
    manager.disconnect(owner.conn);
    assert.equal(room.players.has(originalOwnerUid), true);
    assert.equal(room.players.get(originalOwnerUid)?.connected, false);
    assert.equal(room.hostConnected, true, "named-owner disconnect must never enter legacy host-pause semantics");

    await waitForCondition(() => room.phase === "VOTING");
    for (const actor of joined) {
      assert.equal(
        manager.handle(actor.conn, { t: "SUBMIT_VOTE", targetUid: validTarget(room, actor.uid) }),
        true,
      );
    }

    await waitForCondition(() => room.phase === "RESULT");
    await waitForCondition(() => room.hostUid !== originalOwnerUid);
    const successorUid = room.hostUid;
    assert.equal(successorUid, joined[0]!.uid, "oldest connected eligible player receives management authority");
    assert.equal(room.players.has(originalOwnerUid), true, "authority transfer must not remove the former owner from gameplay");
    assert.equal(room.players.get(originalOwnerUid)?.connected, false);

    const reconnectedOwner = authenticatedConnection(manager, originalOwnerUid);
    assert.equal(room.players.get(originalOwnerUid)?.connected, true);
    assert.equal(room.hostUid, successorUid, "former owner reconnect must not steal authority back");
    assert.equal(room.players.get(originalOwnerUid)?.isHost, false);
    assert.equal(room.players.get(successorUid)?.isHost, true);
    assert.equal(lastMessage(reconnectedOwner.socket, "STATE")?.view.self.isOwner, false);
    assert.equal(lastMessage(reconnectedOwner.socket, "STATE")?.view.self.role, "player");
  } finally {
    manager.dispose();
  }
});

test("disconnect is not leave: explicit LEAVE removes a seat while transport loss alone does not", async () => {
  const { manager, joined, room } = await openDiscussion(4);
  try {
    const disconnected = joined[0]!;
    const leaving = joined[1]!;
    manager.disconnect(disconnected.conn);
    assert.equal(room.players.has(disconnected.uid), true);

    assert.equal(manager.handle(leaving.conn, { t: "LEAVE_ROOM" }), true);
    assert.equal(room.players.has(leaving.uid), false, "voluntary leave removes the seat");
    assert.equal(room.players.has(disconnected.uid), true, "transport disconnect keeps the seat");
  } finally {
    manager.dispose();
  }
});
