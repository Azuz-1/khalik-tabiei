import test from "node:test";
import assert from "node:assert/strict";
import { RoomManager } from "../src/game/roomManager.js";
import { validateClientMessage } from "../src/security/messages.js";
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

test("named owner disconnect transfers authority after grace without closing the room or reclaiming it on reconnect", async () => {
  const manager = new RoomManager({ ownerTransferGraceMs: 20 });
  const owner = createNamedRoom(manager);
  const second = joinPlayer(manager, owner.code, 2);
  const third = joinPlayer(manager, owner.code, 3);
  const room = manager.roomForTests(owner.code)!;

  try {
    assert.equal(room.hostUid, owner.uid);
    manager.disconnect(owner.conn);
    assert.equal(room.hostUid, owner.uid, "ownership stays put during the grace window");
    assert.equal(room.hostConnected, true, "named owner disconnect never enters legacy host pause semantics");
    assert.ok(room.ownerTransferDeadline);

    await wait(45);
    assert.equal(room.hostUid, second.uid, "oldest connected eligible player receives authority");
    assert.equal(room.players.get(second.uid)?.isHost, true);
    assert.equal(room.players.get(owner.uid)?.isHost, false);
    assert.equal(room.closed, false);

    const secondView = lastMessage(second.socket, "STATE")!.view;
    assert.equal(secondView.self.isOwner, true);
    assert.equal(secondView.players.find((player) => player.uid === second.uid)?.isHost, true);

    const reconnected = authenticatedConnection(manager, owner.uid);
    const oldOwnerView = lastMessage(reconnected.socket, "STATE")!.view;
    assert.equal(room.hostUid, second.uid, "former owner reconnect must not reclaim management");
    assert.equal(oldOwnerView.self.role, "player");
    assert.equal(oldOwnerView.self.isOwner, false);

    assert.equal(manager.handle(reconnected.conn, { t: "SET_ADMISSION", locked: true }), false);
    assert.equal(lastMessage(reconnected.socket, "ERROR")?.code, "NOT_HOST");
    assert.equal(manager.handle(second.conn, { t: "SET_ADMISSION", locked: true }), true);
    assert.equal(room.admissionLocked, true);
    assert.equal(room.players.has(third.uid), true);
  } finally {
    manager.dispose();
  }
});

test("explicit named-owner leave transfers authority immediately and keeps the room alive", () => {
  const manager = new RoomManager();
  const owner = createNamedRoom(manager);
  const second = joinPlayer(manager, owner.code, 2);
  const third = joinPlayer(manager, owner.code, 3);
  const room = manager.roomForTests(owner.code)!;

  try {
    assert.equal(manager.handle(owner.conn, { t: "LEAVE_ROOM" }), true);
    assert.equal(room.closed, false);
    assert.equal(room.hostUid, second.uid);
    assert.equal(room.players.has(owner.uid), false);
    assert.equal(room.players.get(second.uid)?.isHost, true);
    assert.equal(room.players.get(third.uid)?.isHost, false);
    assert.equal(lastMessage(second.socket, "STATE")?.view.self.isOwner, true);
    assert.equal(manager.roomCodeForUidForTests(owner.uid), undefined);
  } finally {
    manager.dispose();
  }
});

interface RecoverySnapshot {
  recoveryJson: string;
  errorBeforeGrace: string | undefined;
  phaseBeforeRecovery: string;
  readySubmitted: number | undefined;
}

function roleBlindRecoveryScenario(blockerRole: "impostor" | "normal"): RecoverySnapshot {
  let now = 1_000;
  const manager = new RoomManager({
    now: () => now,
    rng: () => 0.3,
    readyDisconnectGraceMs: 30,
    ownerTransferGraceMs: 1_000,
  });
  const owner = createNamedRoom(manager);
  const second = joinPlayer(manager, owner.code, 2);
  const third = joinPlayer(manager, owner.code, 3);
  const fourth = joinPlayer(manager, owner.code, 4);
  const room = manager.roomForTests(owner.code)!;

  try {
    manager.handle(owner.conn, { t: "START_GAME" });
    assert.equal(room.phase, "QUESTION");
    assert.equal(room.round?.impostorUid, second.uid, "fixed rng should make player 2 the impostor in this fixture");

    const blocker = blockerRole === "impostor" ? second : third;
    for (const participant of [owner, second, third, fourth]) {
      if (participant.uid !== blocker.uid) manager.handle(participant.conn, { t: "MARK_READY" });
    }
    manager.disconnect(blocker.conn);

    assert.equal(room.phase, "QUESTION");
    const ownerView = lastMessage(owner.socket, "STATE")!.view;
    assert.deepEqual(ownerView.readyRecovery, { availableAt: 1_030 });
    assert.equal(ownerView.readyProgress?.submitted, 3);
    assert.equal(lastMessage(fourth.socket, "STATE")!.view.readyRecovery, undefined, "recovery capability is owner-only");

    assert.equal(manager.handle(owner.conn, { t: "KICK_PLAYER", uid: blocker.uid }), false);
    assert.equal(lastMessage(owner.socket, "ERROR")?.code, "INVALID_PHASE", "kick cannot be used as a role oracle for an unready disconnect");

    now = 1_029;
    assert.equal(manager.handle(owner.conn, { t: "REDEAL_CHALLENGE" }), false);
    const errorBeforeGrace = lastMessage(owner.socket, "ERROR")?.code;
    assert.equal(errorBeforeGrace, "INVALID_PHASE");
    assert.equal(room.phase, "QUESTION");

    room.pendingRoundScores.set(owner.uid, 2);
    room.correctVoteStreakStart.set(owner.uid, 1);
    now = 1_030;
    assert.equal(manager.handle(owner.conn, { t: "REDEAL_CHALLENGE" }), true);
    assert.equal(room.phase, "QUESTION");
    assert.equal(room.round?.challengeIndex, 1);
    assert.equal(room.round?.participantUids.includes(blocker.uid), false, "redeal uses connected players only");
    assert.equal(room.round?.participantUids.length, 3);
    assert.equal(room.pendingRoundScores.size, 0);
    assert.equal(room.correctVoteStreakStart.size, 0);
    assert.equal(room.readyRecoveryDeadline, undefined);

    return {
      recoveryJson: JSON.stringify(ownerView.readyRecovery),
      errorBeforeGrace,
      phaseBeforeRecovery: "QUESTION",
      readySubmitted: ownerView.readyProgress?.submitted,
    };
  } finally {
    manager.dispose();
  }
}

test("pre-ready disconnect recovery is externally identical for a normal and the impostor", () => {
  const impostor = roleBlindRecoveryScenario("impostor");
  const normal = roleBlindRecoveryScenario("normal");
  assert.deepEqual(normal, impostor);
});

test("role-blind recovery returns to lobby when fewer than three players are connected", () => {
  let now = 5_000;
  const manager = new RoomManager({
    now: () => now,
    rng: () => 0.4,
    readyDisconnectGraceMs: 25,
  });
  const owner = createNamedRoom(manager);
  const second = joinPlayer(manager, owner.code, 2);
  const third = joinPlayer(manager, owner.code, 3);
  const room = manager.roomForTests(owner.code)!;

  try {
    manager.handle(owner.conn, { t: "START_GAME" });
    manager.handle(owner.conn, { t: "MARK_READY" });
    manager.handle(second.conn, { t: "MARK_READY" });
    manager.disconnect(third.conn);
    assert.deepEqual(lastMessage(owner.socket, "STATE")?.view.readyRecovery, { availableAt: 5_025 });

    now = 5_025;
    assert.equal(manager.handle(owner.conn, { t: "REDEAL_CHALLENGE" }), true);
    assert.equal(room.phase, "LOBBY");
    assert.equal(room.round, null);
    assert.equal(room.readyRecoveryDeadline, undefined);
  } finally {
    manager.dispose();
  }
});

test("REDEAL_CHALLENGE protocol accepts no extra fields", () => {
  assert.deepEqual(validateClientMessage({ t: "REDEAL_CHALLENGE" }, true), { t: "REDEAL_CHALLENGE" });
  assert.equal(validateClientMessage({ t: "REDEAL_CHALLENGE", uid: testUid(2) }, true), null);
});
