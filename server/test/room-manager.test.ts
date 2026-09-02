import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomManager } from "../src/game/roomManager.js";
import {
  authenticatedConnection,
  createRoom,
  FakeSocket,
  joinPlayer,
  lastMessage,
  testUid,
  wait,
} from "./helpers.js";

function errorCode(socket: FakeSocket): string | undefined {
  return lastMessage(socket, "ERROR")?.code;
}

function setupPlayers(manager: RoomManager, count = 3) {
  const host = createRoom(manager);
  const players = Array.from({ length: count }, (_, offset) =>
    joinPlayer(manager, host.code, offset + 2),
  );
  const room = manager.roomForTests(host.code)!;
  return { host, players, room };
}

function start(manager: RoomManager, count = 3) {
  const setup = setupPlayers(manager, count);
  manager.handle(setup.host.conn, {
    t: "SET_SETTINGS",
    totalRounds: 3,
    selectedModes: ["HANDS", "POINT", "NUMBER"],
  });
  manager.handle(setup.host.conn, { t: "START_GAME" });
  assert.equal(setup.room.phase, "QUESTION");
  return setup;
}

async function toDiscussion(manager: RoomManager, count = 3) {
  const setup = start(manager, count);
  for (const player of setup.players) {
    manager.handle(player.conn, { t: "MARK_READY" });
  }
  assert.equal(setup.room.phase, "COUNTDOWN");
  await wait(30);
  assert.equal(setup.room.phase, "DISCUSSION");
  return setup;
}

test("one uid belongs to one room and room creation is globally capped", () => {
  const manager = new RoomManager({ maxRooms: 2 });
  const first = createRoom(manager, testUid(1));
  manager.handle(first.conn, { t: "CREATE_ROOM" });
  assert.equal(errorCode(first.socket), "ALREADY_IN_ROOM");

  const second = createRoom(manager, testUid(50));
  const player = joinPlayer(manager, first.code, 2);
  manager.handle(player.conn, {
    t: "JOIN_ROOM",
    code: second.code,
    name: "لاعب٢",
  });
  assert.equal(errorCode(player.socket), "ALREADY_IN_ROOM");

  const third = authenticatedConnection(manager, testUid(60));
  manager.handle(third.conn, { t: "CREATE_ROOM" });
  assert.equal(errorCode(third.socket), "RATE_LIMITED");
  assert.equal(manager.roomCount, 2);
  manager.dispose();
});

test("room capacity and normalized duplicate names remain enforced", () => {
  const manager = new RoomManager();
  const host = createRoom(manager);
  joinPlayer(manager, host.code, 2, "أحمد");

  const duplicate = authenticatedConnection(manager, testUid(20));
  manager.handle(duplicate.conn, {
    t: "JOIN_ROOM",
    code: host.code,
    name: "احمد",
  });
  assert.equal(errorCode(duplicate.socket), "DUPLICATE_NAME");

  for (let index = 3; index <= 11; index += 1) {
    joinPlayer(manager, host.code, index);
  }

  const extra = authenticatedConnection(manager, testUid(30));
  manager.handle(extra.conn, {
    t: "JOIN_ROOM",
    code: host.code,
    name: "زيادة",
  });
  assert.equal(errorCode(extra.socket), "ROOM_FULL");
  manager.dispose();
});

test("host can select one/two/three modes; non-host and zero-mode changes are rejected", () => {
  const manager = new RoomManager();
  const { host, players, room } = setupPlayers(manager);

  manager.handle(host.conn, { t: "SET_SETTINGS", selectedModes: ["POINT"] });
  assert.deepEqual(room.selectedModes, ["POINT"]);

  manager.handle(host.conn, {
    t: "SET_SETTINGS",
    selectedModes: ["POINT", "HANDS"],
  });
  assert.deepEqual(room.selectedModes, ["POINT", "HANDS"]);

  manager.handle(host.conn, {
    t: "SET_SETTINGS",
    selectedModes: ["HANDS", "POINT", "NUMBER"],
  });
  assert.equal(room.selectedModes.length, 3);

  manager.handle(host.conn, { t: "SET_SETTINGS", selectedModes: [] });
  assert.equal(errorCode(host.socket), "NO_MODE_SELECTED");

  manager.handle(players[0].conn, {
    t: "SET_SETTINGS",
    selectedModes: ["POINT"],
  });
  assert.equal(errorCode(players[0].socket), "NOT_HOST");
  assert.equal(room.selectedModes.length, 3);
  manager.dispose();
});

test("legacy category selection is rejected by backend, not merely hidden in UI", () => {
  const manager = new RoomManager();
  const { host, room } = setupPlayers(manager);
  manager.handle(host.conn, { t: "SET_SETTINGS", categories: ["food"] });
  assert.equal(errorCode(host.socket), "BAD_REQUEST");
  assert.deepEqual(room.categories, []);
  manager.dispose();
});

test("selected modes lock after game starts", () => {
  const manager = new RoomManager({ rng: () => 0 });
  const { host, room } = start(manager);
  const before = [...room.selectedModes];
  manager.handle(host.conn, {
    t: "SET_SETTINGS",
    selectedModes: ["POINT"],
  });
  assert.equal(errorCode(host.socket), "INVALID_PHASE");
  assert.deepEqual(room.selectedModes, before);
  manager.dispose();
});

test("impostor receives no prompt in network state; normal receives current prompt", () => {
  const manager = new RoomManager({ rng: () => 0 });
  const { players, room } = start(manager);
  const round = room.round!;
  const impostor = players.find((player) => player.uid === round.impostorUid)!;
  const normal = players.find((player) => player.uid !== round.impostorUid)!;
  const impostorView = lastMessage(impostor.socket, "STATE")!.view;
  const normalView = lastMessage(normal.socket, "STATE")!.view;

  assert.equal(impostorView.isImpostor, true);
  assert.equal(impostorView.myPrompt, undefined);
  assert.ok(!JSON.stringify(impostorView).includes(round.prompt));
  assert.ok(!JSON.stringify(impostorView).includes(round.promptId));
  assert.equal(normalView.myPrompt?.text, round.prompt);
  manager.dispose();
});

test("reconnect during countdown restores normal prompt but never leaks it to impostor", async () => {
  const manager = new RoomManager({
    rng: () => 0,
    countdownMs: 120,
    actionMs: 5,
    holdMs: 5,
    promptRevealMs: 5,
    disconnectGraceMs: 200,
  });
  const { players, room } = start(manager);
  const round = room.round!;
  const impostor = players.find((player) => player.uid === round.impostorUid)!;
  const normal = players.find((player) => player.uid !== round.impostorUid)!;

  for (const player of players) manager.handle(player.conn, { t: "MARK_READY" });
  assert.equal(room.phase, "COUNTDOWN");

  manager.disconnect(normal.conn);
  const normalReconnect = authenticatedConnection(manager, normal.uid);
  const normalView = lastMessage(normalReconnect.socket, "STATE")!.view;
  assert.equal(normalView.room.phase, "COUNTDOWN");
  assert.equal(normalView.myPrompt?.text, round.prompt);

  manager.disconnect(impostor.conn);
  const impostorReconnect = authenticatedConnection(manager, impostor.uid);
  const impostorView = lastMessage(impostorReconnect.socket, "STATE")!.view;
  assert.equal(impostorView.room.phase, "COUNTDOWN");
  assert.equal(impostorView.isImpostor, true);
  assert.equal(impostorView.myPrompt, undefined);
  assert.ok(!JSON.stringify(impostorView).includes(round.prompt));
  assert.ok(!JSON.stringify(impostorView).includes(round.promptId));

  manager.dispose();
});

test("all ready runs COUNTDOWN -> ACTION -> HOLD -> PROMPT_REVEAL -> DISCUSSION", async () => {
  const manager = new RoomManager({
    rng: () => 0,
    countdownMs: 30,
    actionMs: 30,
    holdMs: 30,
    promptRevealMs: 30,
  });
  const { players, room } = start(manager);

  for (let index = 0; index < players.length - 1; index += 1) {
    manager.handle(players[index].conn, { t: "MARK_READY" });
  }
  assert.equal(room.phase, "QUESTION");

  manager.handle(players.at(-1)!.conn, { t: "MARK_READY" });
  assert.equal(room.phase, "COUNTDOWN");
  assert.ok(room.phaseEndsAt);

  await wait(35);
  assert.equal(room.phase, "ACTION");
  await wait(35);
  assert.equal(room.phase, "HOLD");
  await wait(35);
  assert.equal(room.phase, "PROMPT_REVEAL");
  await wait(35);
  assert.equal(room.phase, "DISCUSSION");
  assert.equal(room.phaseEndsAt, undefined);
  manager.dispose();
});

test("voting survives disconnect/reconnect and completes only after every participant votes", async () => {
  const manager = new RoomManager({
    rng: () => 0,
    countdownMs: 2,
    actionMs: 2,
    holdMs: 2,
    promptRevealMs: 2,
    disconnectGraceMs: 80,
  });
  const { host, players, room } = await toDiscussion(manager);

  manager.handle(host.conn, { t: "START_VOTING" });
  manager.handle(players[0].conn, {
    t: "SUBMIT_VOTE",
    targetUid: players[1].uid,
  });
  manager.disconnect(players[0].conn);
  manager.handle(players[1].conn, {
    t: "SUBMIT_VOTE",
    targetUid: players[0].uid,
  });
  assert.equal(room.phase, "VOTING");

  const third = players[2];
  manager.disconnect(third.conn);
  const thirdReconnect = authenticatedConnection(manager, third.uid);
  assert.equal(lastMessage(thirdReconnect.socket, "STATE")?.view.room.phase, "VOTING");
  manager.handle(thirdReconnect.conn, {
    t: "SUBMIT_VOTE",
    targetUid: players[0].uid,
  });

  assert.equal(room.phase, "RESULT");
  assert.equal(room.round?.votes.get(players[0].uid), players[1].uid);
  manager.dispose();
});

test("grace expiry during a challenge redeals safely with same round mode", async () => {
  const manager = new RoomManager({ rng: () => 0, disconnectGraceMs: 4 });
  const { players, room } = start(manager, 4);
  const oldRound = room.round!;
  const oldMode = oldRound.mode;
  const target = players.find((player) => player.uid !== oldRound.impostorUid)!;

  manager.disconnect(target.conn);
  await wait(12);

  assert.equal(room.currentRound, 1);
  assert.notEqual(room.round, oldRound);
  assert.equal(room.round?.challengeIndex, 1);
  assert.equal(room.round?.mode, oldMode);
  assert.equal(room.phase, "QUESTION");
  manager.dispose();
});

test("grace expiry after a survived challenge redeals the incomplete round safely", async () => {
  const manager = new RoomManager({
    rng: () => 0,
    countdownMs: 2,
    actionMs: 2,
    holdMs: 2,
    promptRevealMs: 2,
    disconnectGraceMs: 4,
  });
  const { host, players, room } = await toDiscussion(manager, 4);
  manager.handle(host.conn, { t: "START_VOTING" });

  // 1-1-1-1 means the impostor cannot have the required 3-vote majority.
  manager.handle(players[0].conn, {
    t: "SUBMIT_VOTE",
    targetUid: players[1].uid,
  });
  manager.handle(players[1].conn, {
    t: "SUBMIT_VOTE",
    targetUid: players[0].uid,
  });
  manager.handle(players[2].conn, {
    t: "SUBMIT_VOTE",
    targetUid: players[3].uid,
  });
  manager.handle(players[3].conn, {
    t: "SUBMIT_VOTE",
    targetUid: players[2].uid,
  });
  assert.equal(room.phase, "RESULT");
  assert.equal(room.round?.roundComplete, false);

  const oldRound = room.round!;
  const oldMode = oldRound.mode;
  const target = players.find((player) => player.uid !== oldRound.impostorUid)!;
  manager.disconnect(target.conn);
  await wait(12);

  assert.equal(room.currentRound, 1);
  assert.equal(room.phase, "QUESTION");
  assert.notEqual(room.round, oldRound);
  assert.equal(room.round?.challengeIndex, 1);
  assert.equal(room.round?.mode, oldMode);
  assert.ok(!room.players.has(target.uid));
  assert.equal(room.players.size, 3);
  assert.ok([...room.players.values()].every((player) => player.score === 0));
  manager.dispose();
});
