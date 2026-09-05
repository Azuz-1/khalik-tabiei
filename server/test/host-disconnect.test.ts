import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomManager } from "../src/game/roomManager.js";
import {
  authenticatedConnection,
  createRoom,
  joinPlayer,
  lastMessage,
  wait,
} from "./helpers.js";

function setupActive(manager: RoomManager, count = 3) {
  const host = createRoom(manager);
  const players = Array.from({ length: count }, (_, index) =>
    joinPlayer(manager, host.code, index + 2),
  );
  const room = manager.roomForTests(host.code)!;
  manager.handle(host.conn, {
    t: "SET_SETTINGS",
    totalRounds: 3,
    selectedModes: ["HANDS", "POINT", "NUMBER"],
  });
  manager.handle(host.conn, { t: "START_GAME" });
  assert.equal(room.phase, "QUESTION");
  return { host, players, room };
}

test("last Host disconnect marks hostConnected false without changing running game state", () => {
  const manager = new RoomManager({ rng: () => 0, hostDisconnectGraceMs: 80 });
  const { host, players, room } = setupActive(manager, 3);
  const round = room.round;
  const phase = room.phase;
  const promptId = room.round!.promptId;
  const impostorUid = room.round!.impostorUid;

  assert.equal(room.hostConnected, true);
  manager.disconnect(host.conn);

  assert.equal(room.hostConnected, false);
  assert.equal(manager.roomForTests(host.code), room);
  assert.equal(room.phase, phase);
  assert.equal(room.round, round);
  assert.equal(room.round!.promptId, promptId);
  assert.equal(room.round!.impostorUid, impostorUid);
  assert.equal(lastMessage(players[0].socket, "STATE")!.view.room.hostConnected, false);
  manager.dispose();
});

test("Host reconnect within grace cancels close and restores hostConnected true", async () => {
  const manager = new RoomManager({ rng: () => 0, hostDisconnectGraceMs: 35 });
  const { host, players, room } = setupActive(manager, 3);
  const round = room.round;
  const phase = room.phase;
  const promptId = room.round!.promptId;
  const impostorUid = room.round!.impostorUid;

  manager.disconnect(host.conn);
  assert.equal(room.hostConnected, false);
  await wait(8);

  const reconnect = authenticatedConnection(manager, host.uid);
  assert.equal(room.hostConnected, true);
  assert.equal(lastMessage(reconnect.socket, "STATE")!.view.room.hostConnected, true);
  assert.equal(lastMessage(players[0].socket, "STATE")!.view.room.hostConnected, true);
  assert.equal(room.phase, phase);
  assert.equal(room.round, round);
  assert.equal(room.round!.promptId, promptId);
  assert.equal(room.round!.impostorUid, impostorUid);

  // Wait beyond the original grace to prove the stale timer was cancelled.
  await wait(45);
  assert.equal(manager.roomForTests(host.code), room);
  assert.equal(room.hostConnected, true);
  manager.dispose();
});

test("Host remaining disconnected beyond grace closes the room", async () => {
  const manager = new RoomManager({ rng: () => 0, hostDisconnectGraceMs: 12 });
  const { host, players, room } = setupActive(manager, 3);

  manager.disconnect(host.conn);
  assert.equal(room.hostConnected, false);
  await wait(30);

  assert.equal(manager.roomForTests(host.code), undefined);
  const closed = lastMessage(players[0].socket, "ROOM_CLOSED");
  assert.equal(closed?.reason, "host_disconnect_timeout");
  manager.dispose();
});

test("one of two authenticated Host connections disconnecting does not start effective close", async () => {
  const manager = new RoomManager({ hostDisconnectGraceMs: 12 });
  const host = createRoom(manager);
  const player = joinPlayer(manager, host.code, 2);
  const room = manager.roomForTests(host.code)!;
  const secondHost = authenticatedConnection(manager, host.uid);

  assert.equal(manager.connectionCountForUidForTests(host.uid), 2);
  assert.equal(room.hostConnected, true);

  manager.disconnect(host.conn);
  assert.equal(manager.connectionCountForUidForTests(host.uid), 1);
  assert.equal(room.hostConnected, true);
  assert.equal(lastMessage(player.socket, "STATE")!.view.room.hostConnected, true);

  await wait(30);
  assert.equal(manager.roomForTests(host.code), room);
  assert.equal(room.hostConnected, true);
  assert.equal(lastMessage(player.socket, "ROOM_CLOSED"), undefined);

  manager.disconnect(secondHost.conn);
  manager.dispose();
});

test("player disconnect never uses Host grace and preserves seat/role/challenge", async () => {
  const manager = new RoomManager({ rng: () => 0, hostDisconnectGraceMs: 8 });
  const { host, players, room } = setupActive(manager, 4);
  const round = room.round;
  const promptId = room.round!.promptId;
  const impostorUid = room.round!.impostorUid;
  const player = players.find((candidate) => candidate.uid !== impostorUid)!;

  manager.disconnect(player.conn);
  await wait(24);

  assert.equal(manager.roomForTests(host.code), room);
  assert.equal(room.hostConnected, true);
  assert.equal(room.players.has(player.uid), true);
  assert.equal(room.players.get(player.uid)?.connected, false);
  assert.equal(room.round, round);
  assert.equal(room.round!.promptId, promptId);
  assert.equal(room.round!.impostorUid, impostorUid);
  assert.equal(room.round!.participantUids.includes(player.uid), true);
  manager.dispose();
});

test("player UI surfaces Host disconnect without replacing the current screen", async () => {
  const app = await readFile(new URL("../../client/src/App.tsx", import.meta.url), "utf8");
  assert.ok(app.includes("view.room.hostConnected === false"));
  assert.ok(app.includes("المضيف انقطع… ننتظره يرجع"));
  assert.ok(app.includes("<Player view={view} />"));
});
