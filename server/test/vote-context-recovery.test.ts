import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomManager } from "../src/game/roomManager.js";
import { validateClientMessage } from "../src/security/messages.js";
import { buildView } from "../src/game/view.js";
import * as engine from "../src/game/engine.js";
import { authenticatedConnection, createRoom, joinPlayer, lastMessage, testUid } from "./helpers.js";

function votingRoom() {
  let now = 1_000;
  const events: Array<{ event: string; props: Record<string, unknown> }> = [];
  const manager = new RoomManager({ rng: () => 0, now: () => now, analytics: (event, props) => { events.push({ event, props: props ?? {} }); } });
  const host = createRoom(manager);
  const players = [2, 3, 4].map((index) => joinPlayer(manager, host.code, index));
  manager.handle(host.conn, { t: "START_GAME" });
  const room = manager.roomForTests(host.code)!;
  room.phase = "VOTING";
  room.phaseEndsAt = 2_000;
  room.round!.voteContext = "a".repeat(32);
  const voter = players[0]!;
  const targetUid = players[1]!.uid;
  return { manager, room, voter, targetUid, events, players, setNow: (value: number) => { now = value; } };
}

test("new-request stale challenge ballots never enter the current challenge", () => {
  const { manager, room, voter, targetUid, events } = votingRoom();
  try {
    const accepted = manager.handle(voter.conn, { t: "SUBMIT_VOTE", targetUid, voteContext: "b".repeat(32), rid: "old-vote" });
    assert.equal(accepted, true, "an ignored old action is acknowledged without recording a ballot");
    assert.equal(room.round!.votes.size, 0);
    assert.equal(lastMessage(voter.socket, "VOTE_IGNORED")?.reason, "STALE_CHALLENGE");
    assert.equal(events.filter((entry) => entry.event === "game_error").length, 0);
  } finally { manager.dispose(); }
});

test("same-context duplicate is idempotent while a changed target still fails", () => {
  const { manager, room, voter, targetUid, players } = votingRoom();
  try {
    const ballot = { t: "SUBMIT_VOTE", targetUid, voteContext: "a".repeat(32) } as const;
    assert.equal(manager.handle(voter.conn, { ...ballot, rid: "first" }), true);
    assert.equal(manager.handle(voter.conn, { ...ballot, rid: "retry" }), true);
    assert.equal(room.round!.votes.size, 1);
    assert.equal(manager.handle(voter.conn, { ...ballot, targetUid: players[2]!.uid, rid: "changed" }), false);
    assert.equal(lastMessage(voter.socket, "ERROR")?.code, "VOTE_ALREADY_SUBMITTED");
  } finally { manager.dispose(); }
});

test("wall-clock deadline seals before a ballot even when the timer callback has not run", () => {
  const { manager, room, voter, targetUid, events, setNow } = votingRoom();
  try {
    setNow(2_000);
    assert.equal(manager.handle(voter.conn, { t: "SUBMIT_VOTE", targetUid, voteContext: "a".repeat(32), rid: "late" }), true);
    assert.equal(room.round!.votes.size, 0);
    assert.equal(room.phase, "RESULT");
    assert.equal(lastMessage(voter.socket, "VOTE_IGNORED")?.reason, "CLOSED");
    assert.equal(events.filter((entry) => entry.event === "game_error").length, 0);
  } finally { manager.dispose(); }
});

test("named owners can idempotently rejoin their room without a second seat", () => {
  const manager = new RoomManager();
  const owner = authenticatedConnection(manager, testUid(1));
  try {
    manager.handle(owner.conn, { t: "CREATE_ROOM", name: "مالك" });
    const code = lastMessage(owner.socket, "STATE")!.view.room.code;
    assert.equal(manager.handle(owner.conn, { t: "JOIN_ROOM", code, name: "مالك", rid: "join-again" }), true);
    assert.equal(manager.roomForTests(code)!.players.size, 1);
  } finally { manager.dispose(); }
});

test("vote wire context has an exact bounded shape", () => {
  const message = { t: "SUBMIT_VOTE", targetUid: testUid(2), voteContext: "a".repeat(32), rid: "valid" };
  assert.deepEqual(validateClientMessage(message, true), message);
  for (const voteContext of ["", "a".repeat(65), "has spaces", 1, null]) {
    assert.equal(validateClientMessage({ ...message, voteContext }, true), null);
  }
});

test("serialized ballot context exists only for a connected voting participant", () => {
  const { manager, room, voter } = votingRoom();
  try {
    const view = buildView(room, voter.uid, "https://example.test/join");
    assert.equal(JSON.parse(JSON.stringify(view)).voteContext, room.round!.voteContext);
    assert.equal(buildView(room, room.hostUid, "").voteContext, undefined, "external display host is ineligible");
    assert.equal(buildView(room, testUid(99), "").voteContext, undefined, "spectators have no submission context");
    room.players.get(voter.uid)!.connected = false;
    assert.equal(buildView(room, voter.uid, "").voteContext, undefined);
    room.players.get(voter.uid)!.connected = true;
    for (const phase of ["QUESTION", "COUNTDOWN", "ACTION", "HOLD", "PROMPT_REVEAL", "DISCUSSION", "RESULT"] as const) {
      room.phase = phase;
      assert.equal(buildView(room, voter.uid, "").voteContext, undefined, phase);
    }
  } finally { manager.dispose(); }
});

test("old clients receive an actionable update error and invalid identities remain failures", () => {
  const { manager, room, voter, targetUid } = votingRoom();
  try {
    assert.equal(manager.handle(voter.conn, { t: "SUBMIT_VOTE", targetUid, rid: "legacy" }), false);
    assert.equal(lastMessage(voter.socket, "ERROR")?.code, "CLIENT_UPDATE_REQUIRED");
    const outsider = authenticatedConnection(manager, testUid(99));
    assert.equal(manager.handle(outsider.conn, { t: "SUBMIT_VOTE", targetUid, voteContext: room.round!.voteContext }), false);
    assert.equal(lastMessage(outsider.socket, "ERROR")?.code, "NOT_IN_ROOM");
    room.players.get(voter.uid)!.connected = false;
    assert.equal(manager.handle(voter.conn, { t: "SUBMIT_VOTE", targetUid, voteContext: "old" }), false);
    assert.equal(lastMessage(voter.socket, "ERROR")?.code, "NOT_PLAYER");
  } finally { manager.dispose(); }
});

test("challenge context survives reconnect and rotates for the next challenge", () => {
  const { manager, room, voter } = votingRoom();
  try {
    const original = room.round!.voteContext;
    manager.disconnect(voter.conn);
    const returned = authenticatedConnection(manager, voter.uid);
    assert.equal(lastMessage(returned.socket, "STATE")!.view.voteContext, original);
    room.phase = "RESULT";
    room.round!.resultComputed = true;
    room.round!.roundComplete = false;
    engine.nextRound(room, room.hostUid, { now: () => 1_000, rng: () => 0 });
    assert.notEqual(room.round!.voteContext, original);
    assert.equal(room.phase, "QUESTION");
  } finally { manager.dispose(); }
});

test("settled exact ballot retries retain their ACK without changing result or points", () => {
  const { manager, room, voter, targetUid, players } = votingRoom();
  try {
    const ballot = { t: "SUBMIT_VOTE", targetUid, voteContext: room.round!.voteContext, rid: "first-vote" } as const;
    assert.equal(manager.handle(voter.conn, ballot), true);
    for (const player of players.slice(1)) {
      assert.equal(manager.handle(player.conn, { t: "SUBMIT_VOTE", targetUid: voter.uid, voteContext: room.round!.voteContext }), true);
    }
    assert.equal(room.phase, "RESULT");
    const before = JSON.stringify([...room.players.values()].map((player) => player.score));
    assert.equal(manager.handle(voter.conn, ballot), true, "cached original vote ACK survives phase transition");
    assert.equal(manager.handle(voter.conn, { ...ballot, rid: "second-request" }), true, "new request exact ballot retry is idempotent too");
    assert.equal(JSON.stringify([...room.players.values()].map((player) => player.score)), before);
    assert.equal(room.completedChallenges, 1);
  } finally { manager.dispose(); }
});

test("redeal rotates context even when displayed round and challenge indices repeat", () => {
  const { manager, room, voter, targetUid } = votingRoom();
  try {
    const original = room.round!.voteContext;
    const indices = [room.round!.index, room.round!.challengeIndex];
    room.phase = "QUESTION";
    engine.redealCurrentRound(room, { now: () => 1_000, rng: () => 0 });
    assert.deepEqual([room.round!.index, room.round!.challengeIndex], indices);
    assert.notEqual(room.round!.voteContext, original);
    room.phase = "VOTING";
    assert.equal(manager.handle(voter.conn, { t: "SUBMIT_VOTE", targetUid, voteContext: original, rid: "before-redeal" }), true);
    assert.equal(room.round!.votes.size, 0);
    assert.equal(lastMessage(voter.socket, "VOTE_IGNORED")?.reason, "STALE_CHALLENGE");
  } finally { manager.dispose(); }
});
