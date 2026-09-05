import { test } from "node:test";
import assert from "node:assert/strict";
import { ServerClock } from "../../client/src/net/clock.js";
import { visibleCountdownSecond } from "../../client/src/audio/hostAudioEvents.js";
import { RoomManager } from "../src/game/roomManager.js";
import { ConnectionCapacity } from "../src/net/capacity.js";
import { AbuseGuard } from "../src/security/rateLimit.js";
import { validateClientMessage } from "../src/security/messages.js";
import {
  authenticatedConnection,
  createRoom,
  joinPlayer,
  lastMessage,
  testUid,
} from "./helpers.js";

test("protocol accepts bounded request/clock metadata and rejects malformed variants", () => {
  assert.deepEqual(validateClientMessage({ t: "CREATE_ROOM", rid: "req_1-abc" }), {
    t: "CREATE_ROOM",
    rid: "req_1-abc",
  });
  assert.equal(validateClientMessage({ t: "CREATE_ROOM", rid: "has space" }), null);
  assert.equal(validateClientMessage({ t: "CREATE_ROOM", rid: "x".repeat(33) }), null);
  assert.deepEqual(validateClientMessage({ t: "PING", sampleId: "s-1", clientMonoMs: 12.5 }), {
    t: "PING",
    sampleId: "s-1",
    clientMonoMs: 12.5,
  });
  assert.equal(validateClientMessage({ t: "PING", sampleId: "s-1", clientMonoMs: -1 }), null);
  assert.deepEqual(validateClientMessage({ t: "SET_ADMISSION", locked: true, rid: "lock1" }), {
    t: "SET_ADMISSION",
    locked: true,
    rid: "lock1",
  });
  assert.deepEqual(validateClientMessage({ t: "UNBLOCK_PLAYER", uid: testUid(2), rid: "allow1" }), {
    t: "UNBLOCK_PLAYER",
    uid: testUid(2),
    rid: "allow1",
  });
});

test("filtered monotonic server clock ignores wall-clock skew and favors low-RTT samples", () => {
  let mono = 1_000;
  const clock = new ServerClock(() => mono);
  const serverAtMono = (value: number) => 1_000_000 + value;

  clock.beginSample("s-1");
  mono = 1_020;
  assert.equal(clock.acceptSample("s-1", serverAtMono(1_010), mono), true);
  assert.equal(clock.now(1_030), serverAtMono(1_030));

  mono = 2_000;
  clock.beginSample("s-2");
  mono = 2_010;
  clock.beginSample("s-3");
  mono = 2_030;
  assert.equal(clock.acceptSample("s-3", serverAtMono(2_020), mono), true);

  // An older response arrives much later. It remains a sample but its very
  // high RTT cannot displace the better samples from the filtered anchor.
  mono = 2_400;
  assert.equal(clock.acceptSample("s-2", serverAtMono(2_010), mono), true);
  assert.ok(Math.abs(clock.now(2_400) - serverAtMono(2_400)) < 120);

  mono = 3_000;
  clock.beginSample("s-4");
  mono = 3_020;
  clock.acceptSample("s-4", serverAtMono(3_010), mono);
  assert.ok(Math.abs(clock.now(3_050) - serverAtMono(3_050)) < 30);

  // A ±60s-skewed Date.now() is irrelevant once the monotonic anchor exists.
  const beforeSuspend = clock.now(4_000);
  const afterSuspend = clock.now(124_000);
  assert.equal(afterSuspend - beforeSuspend, 120_000);

  const deadline = clock.now(5_000) + 5_000;
  assert.equal(visibleCountdownSecond(deadline, clock.now(5_000)), 5);
  assert.equal(visibleCountdownSecond(deadline, clock.now(6_100)), 4);
});

test("connection capacity supports a shared-NAT party and releases each lease exactly once", () => {
  const capacity = new ConnectionCapacity(20, 12);
  const leases = Array.from({ length: 12 }, () => capacity.acquire("203.0.113.7"));
  assert.ok(leases.every(Boolean));
  assert.equal(capacity.active, 12);
  assert.equal(capacity.activeForIp("203.0.113.7"), 12);
  assert.equal(capacity.acquire("203.0.113.7"), null);

  const first = leases[0]!;
  first!.release();
  first!.release();
  assert.equal(capacity.active, 11);
  assert.equal(capacity.activeForIp("203.0.113.7"), 11);
  assert.ok(capacity.acquire("203.0.113.7"));
});

test("room-creation controls are identity-aware without breaking many identities on one NAT", () => {
  const guard = new AbuseGuard(() => 100);
  try {
    for (let index = 0; index < 12; index += 1) {
      assert.equal(guard.allowRoomCreation("203.0.113.9", testUid(index + 1)), true);
    }
    assert.equal(guard.allowRoomCreation("198.51.100.2", testUid(99)), true);
    assert.equal(guard.allowRoomCreation("198.51.100.2", testUid(99)), true);
    assert.equal(guard.allowRoomCreation("198.51.100.2", testUid(99)), true);
    assert.equal(guard.allowRoomCreation("198.51.100.2", testUid(99)), false);
  } finally {
    guard.dispose();
  }
});

test("expired empty Lobby is reclaimed synchronously before room-capacity rejection", () => {
  let now = 0;
  const manager = new RoomManager({ now: () => now, maxRooms: 1, emptyLobbyExpiryMs: 100 });
  const first = createRoom(manager, testUid(1));
  assert.equal(manager.roomCount, 1);

  now = 101;
  const secondHost = authenticatedConnection(manager, testUid(2));
  assert.equal(manager.handle(secondHost.conn, { t: "CREATE_ROOM" }), true);
  assert.equal(manager.roomCount, 1);
  assert.equal(manager.roomForTests(first.code), undefined);
  assert.equal(lastMessage(first.socket, "ROOM_CLOSED")?.reason, "empty_lobby_expired");
  manager.dispose();
});

test("heartbeats reconnects and settings spam do not extend meaningful-use timestamp", () => {
  let now = 10;
  const manager = new RoomManager({ now: () => now });
  const host = createRoom(manager);
  const room = manager.roomForTests(host.code)!;
  const meaningful = room.meaningfulAt;

  now = 20;
  manager.handle(host.conn, { t: "PING", sampleId: "s-1", clientMonoMs: 5 });
  manager.handle(host.conn, { t: "SET_SETTINGS", totalRounds: 3 });
  assert.equal(room.meaningfulAt, meaningful);

  now = 30;
  const duplicateHostTab = authenticatedConnection(manager, host.uid);
  assert.equal(room.meaningfulAt, meaningful);
  manager.disconnect(duplicateHostTab.conn);
  assert.equal(room.meaningfulAt, meaningful);
  manager.dispose();
});

test("request IDs dedupe only within authenticated action and match context", () => {
  let now = 1;
  const manager = new RoomManager({ now: () => now, rng: () => 0 });
  const host = createRoom(manager);
  const room = manager.roomForTests(host.code)!;

  now = 10;
  assert.equal(manager.handle(host.conn, { t: "SET_SETTINGS", totalRounds: 3, rid: "settings1" }), true);
  assert.equal(lastMessage(host.socket, "ACK")?.rid, "settings1");
  const updatedAfterFirst = room.updatedAt;

  now = 20;
  assert.equal(manager.handle(host.conn, { t: "SET_SETTINGS", totalRounds: 3, rid: "settings1" }), true);
  assert.equal(room.updatedAt, updatedAfterFirst, "exact retry is acknowledged without re-running mutation");

  assert.equal(manager.handle(host.conn, { t: "SET_SETTINGS", totalRounds: 5, rid: "settings1" }), false);
  assert.equal(lastMessage(host.socket, "ERROR")?.code, "BAD_REQUEST");

  joinPlayer(manager, host.code, 2);
  joinPlayer(manager, host.code, 3);
  joinPlayer(manager, host.code, 4);
  now = 30;
  manager.handle(host.conn, { t: "START_GAME" });
  assert.equal(room.matchGeneration, 1);
  assert.equal(room.phase, "QUESTION");

  // Same fingerprint/rid from the old Lobby must not receive a stale ACK in a
  // new match context.
  assert.equal(manager.handle(host.conn, { t: "SET_SETTINGS", totalRounds: 3, rid: "settings1" }), false);
  assert.equal(lastMessage(host.socket, "ERROR")?.code, "BAD_REQUEST");
  manager.dispose();
});

test("kicked identity, Lobby lock, reserved reconnect, and Host unblock have distinct semantics", () => {
  const manager = new RoomManager({ rng: () => 0 });
  const host = createRoom(manager);
  const kicked = joinPlayer(manager, host.code, 2, "سالم");
  const reserved = joinPlayer(manager, host.code, 3, "ناصر");
  const room = manager.roomForTests(host.code)!;

  manager.handle(host.conn, { t: "KICK_PLAYER", uid: kicked.uid });
  assert.equal(room.kickedIdentities.has(kicked.uid), true);
  assert.equal(manager.handle(kicked.conn, { t: "JOIN_ROOM", code: host.code, name: "سالم" }), false);
  assert.equal(lastMessage(kicked.socket, "ERROR")?.code, "KICKED");
  assert.equal(lastMessage(host.socket, "STATE")?.view.blockedPlayers?.[0]?.uid, kicked.uid);
  assert.equal(lastMessage(reserved.socket, "STATE")?.view.blockedPlayers, undefined);

  manager.handle(host.conn, { t: "SET_ADMISSION", locked: true });
  assert.equal(room.admissionLocked, true);

  manager.disconnect(reserved.conn);
  const reconnect = authenticatedConnection(manager, reserved.uid);
  assert.equal(room.players.get(reserved.uid)?.connected, true, "existing reserved seat reconnects through lock");
  assert.equal(reconnect.conn.roomCode, host.code);

  const fresh = authenticatedConnection(manager, testUid(4));
  assert.equal(manager.handle(fresh.conn, { t: "JOIN_ROOM", code: host.code, name: "فيصل" }), false);
  assert.equal(lastMessage(fresh.socket, "ERROR")?.code, "ROOM_LOCKED");

  assert.equal(manager.handle(reconnect.conn, { t: "UNBLOCK_PLAYER", uid: kicked.uid }), false);
  assert.equal(lastMessage(reconnect.socket, "ERROR")?.code, "NOT_HOST");
  assert.equal(room.kickedIdentities.has(kicked.uid), true);

  assert.equal(manager.handle(host.conn, { t: "UNBLOCK_PLAYER", uid: kicked.uid }), true);
  assert.equal(room.kickedIdentities.has(kicked.uid), false);
  manager.handle(host.conn, { t: "SET_ADMISSION", locked: false });
  assert.equal(manager.handle(kicked.conn, { t: "JOIN_ROOM", code: host.code, name: "سالم" }), true);
  assert.equal(room.players.has(kicked.uid), true);
  manager.dispose();
});
