import { test } from "node:test";
import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import { RoomManager } from "../src/game/roomManager.js";
import { Connection } from "../src/net/connection.js";
import {
  authenticatedConnection,
  createRoom,
  FakeSocket,
  joinPlayer,
  lastMessage,
  testUid,
  wait,
} from "./helpers.js";

function setupPlayers(manager: RoomManager, count: number) {
  const host = createRoom(manager);
  const players = Array.from({ length: count }, (_, offset) =>
    joinPlayer(manager, host.code, offset + 2),
  );
  return { host, players, room: manager.roomForTests(host.code)! };
}

async function startAnswering(manager: RoomManager, count = 3) {
  const setup = setupPlayers(manager, count);
  manager.handle(setup.host.conn, { t: "SET_SETTINGS", totalRounds: 3, categories: ["food"] });
  manager.handle(setup.host.conn, { t: "START_GAME" });
  await wait(8);
  assert.equal(setup.room.phase, "ANSWERING");
  return setup;
}

function errorCode(socket: FakeSocket): string | undefined {
  return lastMessage(socket, "ERROR")?.code;
}

test("one uid belongs to one room and room creation is globally capped", () => {
  const manager = new RoomManager({ maxRooms: 2 });
  const first = createRoom(manager, testUid(1));
  manager.handle(first.conn, { t: "CREATE_ROOM" });
  assert.equal(errorCode(first.socket), "ALREADY_IN_ROOM");
  assert.equal(manager.roomCount, 1);

  const second = createRoom(manager, testUid(50));
  const player = joinPlayer(manager, first.code, 2);
  manager.handle(player.conn, { t: "JOIN_ROOM", code: second.code, name: "لاعب٢" });
  assert.equal(errorCode(player.socket), "ALREADY_IN_ROOM");
  assert.equal(manager.roomCodeForUidForTests(player.uid), first.code);
  assert.equal(manager.roomForTests(first.code)?.players.has(player.uid), true);
  assert.equal(manager.roomForTests(second.code)?.players.has(player.uid), false);

  const thirdHost = authenticatedConnection(manager, testUid(60));
  manager.handle(thirdHost.conn, { t: "CREATE_ROOM" });
  assert.equal(errorCode(thirdHost.socket), "RATE_LIMITED");
  assert.equal(manager.roomCount, 2);
  manager.dispose();
});

test("room capacity and normalized duplicate names are enforced", () => {
  const manager = new RoomManager();
  const host = createRoom(manager);
  joinPlayer(manager, host.code, 2, "أحمد");
  const duplicate = authenticatedConnection(manager, testUid(20));
  manager.handle(duplicate.conn, { t: "JOIN_ROOM", code: host.code, name: "احمد" });
  assert.equal(errorCode(duplicate.socket), "DUPLICATE_NAME");

  for (let index = 3; index <= 11; index += 1) joinPlayer(manager, host.code, index);
  assert.equal(manager.roomForTests(host.code)?.players.size, 10);
  const extra = authenticatedConnection(manager, testUid(30));
  manager.handle(extra.conn, { t: "JOIN_ROOM", code: host.code, name: "زيادة" });
  assert.equal(errorCode(extra.socket), "ROOM_FULL");
  manager.dispose();
});

test("host authorization is enforced for every privileged action", () => {
  const manager = new RoomManager();
  const { host, players, room } = setupPlayers(manager, 3);
  const player = players[0];

  manager.handle(player.conn, { t: "SET_SETTINGS", totalRounds: 3 });
  assert.equal(errorCode(player.socket), "NOT_HOST");
  manager.handle(player.conn, { t: "START_GAME" });
  assert.equal(errorCode(player.socket), "NOT_HOST");
  room.phase = "DISCUSSION";
  manager.handle(player.conn, { t: "START_VOTING" });
  assert.equal(errorCode(player.socket), "NOT_HOST");
  room.phase = "RESULT";
  manager.handle(player.conn, { t: "NEXT_ROUND" });
  assert.equal(errorCode(player.socket), "NOT_HOST");
  room.phase = "LOBBY";
  manager.handle(player.conn, { t: "KICK_PLAYER", uid: players[1].uid });
  assert.equal(errorCode(player.socket), "NOT_HOST");
  manager.handle(player.conn, { t: "CLOSE_ROOM" });
  assert.equal(errorCode(player.socket), "NOT_HOST");
  room.phase = "GAME_OVER";
  manager.handle(player.conn, { t: "REMATCH" });
  assert.equal(errorCode(player.socket), "NOT_HOST");
  assert.equal(manager.roomCodeForUidForTests(host.uid), host.code);
  manager.dispose();
});

test("disconnect in QUESTION does not transition and reconnect restores exact round", async () => {
  const manager = new RoomManager({
    rng: () => 0,
    disconnectGraceMs: 30,
    questionToAnsweringMs: 1_000,
  });
  const { host, players, room } = setupPlayers(manager, 3);
  manager.handle(host.conn, { t: "SET_SETTINGS", totalRounds: 3, categories: ["food"] });
  manager.handle(host.conn, { t: "START_GAME" });
  const player = players[0];
  const round = room.round;
  const question = round?.normalQuestion;
  const impostor = round?.impostorUid;
  manager.disconnect(player.conn);
  assert.equal(room.phase, "QUESTION");
  assert.equal(room.round?.participantUids.length, 3);
  assert.equal(room.players.get(player.uid)?.connected, false);

  const reconnect = authenticatedConnection(manager, player.uid);
  assert.equal(room.players.get(player.uid)?.connected, true);
  assert.equal(room.round, round);
  assert.equal(room.round?.normalQuestion, question);
  assert.equal(room.round?.impostorUid, impostor);
  await wait(45);
  assert.equal(room.round, round, "stale grace timer must not fire after reconnect");

  manager.disconnect(reconnect.conn);
  const reconnectAgain = authenticatedConnection(manager, player.uid);
  manager.disconnect(reconnectAgain.conn);
  authenticatedConnection(manager, player.uid);
  await wait(45);
  assert.equal(room.round, round, "repeated reconnects must cancel every stale timer");
  manager.dispose();
});

test("disconnect before/after answering preserves eligibility and submitted answer", async () => {
  const manager = new RoomManager({ rng: () => 0, disconnectGraceMs: 60, questionToAnsweringMs: 1 });
  const { players, room } = await startAnswering(manager);
  const [first, second, third] = players;
  manager.handle(first.conn, { t: "SUBMIT_ANSWER", answer: "جواب محفوظ" });
  manager.disconnect(first.conn);
  manager.disconnect(second.conn);
  manager.handle(third.conn, { t: "SUBMIT_ANSWER", answer: "جواب ثالث" });
  assert.equal(room.phase, "ANSWERING");
  assert.equal(room.round?.answers.get(first.uid), "جواب محفوظ");
  assert.equal(room.round?.answers.size, 2);

  const firstReconnect = authenticatedConnection(manager, first.uid);
  assert.equal(lastMessage(firstReconnect.socket, "STATE")?.view.myAnswerSubmitted, true);
  const secondReconnect = authenticatedConnection(manager, second.uid);
  manager.handle(secondReconnect.conn, { t: "SUBMIT_ANSWER", answer: "جواب ثاني" });
  assert.equal(room.phase, "REVEAL");
  manager.dispose();
});

test("disconnect in DISCUSSION and VOTING never completes the phase by socket count", async () => {
  const manager = new RoomManager({
    rng: () => 0,
    disconnectGraceMs: 80,
    questionToAnsweringMs: 1,
    revealToDiscussionMs: 1,
  });
  const { host, players, room } = await startAnswering(manager);
  for (const player of players) manager.handle(player.conn, { t: "SUBMIT_ANSWER", answer: `ج${player.uid.slice(-1)}` });
  await wait(8);
  assert.equal(room.phase, "DISCUSSION");
  manager.disconnect(players[0].conn);
  assert.equal(room.phase, "DISCUSSION");
  const firstReconnect = authenticatedConnection(manager, players[0].uid);

  manager.handle(host.conn, { t: "START_VOTING" });
  manager.disconnect(players[2].conn);
  manager.handle(firstReconnect.conn, { t: "SUBMIT_VOTE", targetUid: players[1].uid });
  manager.handle(players[1].conn, { t: "SUBMIT_VOTE", targetUid: players[0].uid });
  assert.equal(room.phase, "VOTING", "missing disconnected vote must still be required");
  const thirdReconnect = authenticatedConnection(manager, players[2].uid);
  manager.handle(thirdReconnect.conn, { t: "SUBMIT_VOTE", targetUid: players[0].uid });
  assert.equal(room.phase, "RESULT");
  manager.dispose();
});

test("a vote survives disconnect and can complete while that voter is offline", async () => {
  const manager = new RoomManager({
    rng: () => 0,
    disconnectGraceMs: 80,
    questionToAnsweringMs: 1,
    revealToDiscussionMs: 1,
  });
  const { host, players, room } = await startAnswering(manager);
  for (const player of players) manager.handle(player.conn, { t: "SUBMIT_ANSWER", answer: "جواب" });
  await wait(8);
  manager.handle(host.conn, { t: "START_VOTING" });
  manager.handle(players[0].conn, { t: "SUBMIT_VOTE", targetUid: players[1].uid });
  manager.disconnect(players[0].conn);
  assert.equal(room.round?.votes.get(players[0].uid), players[1].uid);
  manager.handle(players[1].conn, { t: "SUBMIT_VOTE", targetUid: players[0].uid });
  manager.handle(players[2].conn, { t: "SUBMIT_VOTE", targetUid: players[0].uid });
  assert.equal(room.phase, "RESULT");
  assert.equal(room.round?.votes.get(players[0].uid), players[1].uid);
  manager.dispose();
});

test("grace expiry cancels and redeals for disconnected impostor or normal player", async () => {
  for (const disconnectIndex of [0, 1]) {
    const manager = new RoomManager({
      rng: () => 0,
      disconnectGraceMs: 12,
      questionToAnsweringMs: 1,
    });
    const { players, room } = await startAnswering(manager, 4);
    const oldRound = room.round!;
    const target = disconnectIndex === 0
      ? players.find((player) => player.uid === oldRound.impostorUid)!
      : players.find((player) => player.uid !== oldRound.impostorUid)!;
    manager.disconnect(target.conn);
    await wait(25);
    assert.equal(room.currentRound, 1);
    assert.ok(room.phase === "QUESTION" || room.phase === "ANSWERING");
    assert.notEqual(room.round, oldRound);
    assert.equal(room.players.has(target.uid), false);
    assert.equal(manager.roomCodeForUidForTests(target.uid), undefined);
    assert.ok(!room.round!.participantUids.includes(target.uid));
    assert.ok([...room.players.values()].every((player) => player.score === 0));
    if (target.uid === oldRound.impostorUid) {
      assert.notEqual(room.round!.impostorUid, target.uid);
    }
    manager.dispose();
  }
});

test("fewer than three eligible players after grace aborts safely to lobby", async () => {
  const manager = new RoomManager({ rng: () => 0, disconnectGraceMs: 10, questionToAnsweringMs: 1 });
  const { players, room } = await startAnswering(manager, 3);
  manager.disconnect(players[0].conn);
  await wait(25);
  assert.equal(room.phase, "LOBBY");
  assert.equal(room.currentRound, 0);
  assert.equal(room.round, null);
  assert.equal(room.players.size, 2);
  assert.ok([...room.players.values()].every((player) => player.score === 0));
  manager.dispose();
});

test("leave and kick are non-destructive during every active round phase", () => {
  const manager = new RoomManager({ rng: () => 0, questionToAnsweringMs: 10_000 });
  const { host, players, room } = setupPlayers(manager, 3);
  manager.handle(host.conn, { t: "SET_SETTINGS", totalRounds: 3, categories: ["food"] });
  manager.handle(host.conn, { t: "START_GAME" });
  const target = players[0];
  const impostorUid = room.round!.impostorUid;
  for (const phase of ["QUESTION", "ANSWERING", "REVEAL", "DISCUSSION", "VOTING", "RESULT"] as const) {
    room.phase = phase;
    manager.handle(target.conn, { t: "LEAVE_ROOM" });
    assert.equal(errorCode(target.socket), "INVALID_PHASE", `leave ${phase}`);
    assert.equal(room.players.has(target.uid), true);
    manager.handle(host.conn, { t: "KICK_PLAYER", uid: target.uid });
    assert.equal(errorCode(host.socket), "INVALID_PHASE", `kick ${phase}`);
    assert.equal(room.players.has(target.uid), true);
    manager.handle(host.conn, { t: "KICK_PLAYER", uid: impostorUid });
    assert.equal(errorCode(host.socket), "INVALID_PHASE", `kick impostor ${phase}`);
    assert.equal(room.players.has(impostorUid), true);
  }
  manager.dispose();
});

test("leave before/after an answer or vote cannot corrupt participant state", async () => {
  const manager = new RoomManager({
    rng: () => 0,
    questionToAnsweringMs: 1,
    revealToDiscussionMs: 1,
  });
  const { host, players, room } = await startAnswering(manager);
  manager.handle(players[0].conn, { t: "LEAVE_ROOM" });
  assert.equal(errorCode(players[0].socket), "INVALID_PHASE");
  manager.handle(players[0].conn, { t: "SUBMIT_ANSWER", answer: "محفوظ" });
  manager.handle(players[0].conn, { t: "LEAVE_ROOM" });
  assert.equal(room.round?.answers.get(players[0].uid), "محفوظ");
  for (const player of players.slice(1)) manager.handle(player.conn, { t: "SUBMIT_ANSWER", answer: "جواب" });
  await wait(8);
  manager.handle(host.conn, { t: "START_VOTING" });
  manager.handle(players[0].conn, { t: "LEAVE_ROOM" });
  assert.equal(errorCode(players[0].socket), "INVALID_PHASE");
  manager.handle(players[0].conn, { t: "SUBMIT_VOTE", targetUid: players[1].uid });
  manager.handle(players[0].conn, { t: "LEAVE_ROOM" });
  assert.equal(room.round?.votes.get(players[0].uid), players[1].uid);
  assert.equal(room.players.has(players[0].uid), true);
  manager.dispose();
});

test("safe lobby kick, room close, and GC clean every index and timer", () => {
  let now = 0;
  const manager = new RoomManager({ now: () => now, disconnectGraceMs: 10_000_000 });
  const { host, players, room } = setupPlayers(manager, 3);
  manager.handle(host.conn, { t: "KICK_PLAYER", uid: players[0].uid });
  assert.equal(room.players.has(players[0].uid), false);
  assert.equal(manager.roomCodeForUidForTests(players[0].uid), undefined);
  assert.ok(lastMessage(players[0].socket, "KICKED"));

  manager.handle(host.conn, { t: "CLOSE_ROOM" });
  assert.equal(manager.roomCount, 0);
  for (const uid of [host.uid, players[1].uid, players[2].uid]) {
    assert.equal(manager.roomCodeForUidForTests(uid), undefined);
  }

  const gcHost = createRoom(manager, testUid(100));
  const gcPlayers = [
    joinPlayer(manager, gcHost.code, 101),
    joinPlayer(manager, gcHost.code, 102),
  ];
  const gcRoom = { host: gcHost, players: gcPlayers };
  manager.disconnect(gcRoom.host.conn);
  for (const player of gcRoom.players) manager.disconnect(player.conn);
  now = 31 * 60 * 1000;
  manager.runGcForTests();
  assert.equal(manager.roomCount, 0);
  assert.equal(manager.roomCodeForUidForTests(gcRoom.host.uid), undefined);
  for (const player of gcRoom.players) {
    assert.equal(manager.roomCodeForUidForTests(player.uid), undefined);
  }
  manager.dispose();
});

test("multiple tabs keep presence, duplicate cleanup is safe, and cap is enforced", () => {
  const manager = new RoomManager({ maxConnectionsPerUid: 2 });
  const { players, room } = setupPlayers(manager, 3);
  const player = players[0];
  const secondTab = authenticatedConnection(manager, player.uid);
  assert.equal(manager.connectionCountForUidForTests(player.uid), 2);
  manager.disconnect(player.conn);
  manager.disconnect(player.conn);
  assert.equal(room.players.get(player.uid)?.connected, true);
  assert.equal(manager.connectionCountForUidForTests(player.uid), 1);

  const thirdSocket = new FakeSocket();
  const thirdConn = new Connection(thirdSocket as unknown as WebSocket, "http://localhost:8080", "127.0.0.1");
  thirdConn.authenticate(player.uid);
  manager.register(thirdConn);
  const fourthSocket = new FakeSocket();
  const fourthConn = new Connection(fourthSocket as unknown as WebSocket, "http://localhost:8080", "127.0.0.1");
  fourthConn.authenticate(player.uid);
  assert.throws(
    () => manager.register(fourthConn),
    (error: unknown) => typeof error === "object" && error !== null && "code" in error && error.code === "RATE_LIMITED",
  );
  manager.disconnect(secondTab.conn);
  assert.equal(room.players.get(player.uid)?.connected, true, "third tab remains live");
  manager.dispose();
});
