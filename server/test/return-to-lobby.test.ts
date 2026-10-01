import { test } from "node:test";
import assert from "node:assert/strict";
import { RoomManager } from "../src/game/roomManager.js";
import { validateClientMessage } from "../src/security/messages.js";
import { authenticatedConnection, joinPlayer, lastMessage, testUid, wait } from "./helpers.js";

const FAST = {
  countdownMs: 15,
  actionMs: 15,
  holdMs: 15,
  promptRevealMs: 15,
  discussionMs: 15,
  votingMs: 15,
  survivedTransitionMs: 15,
  fullResultMs: 15,
};

function ownerRoom(timing: Partial<typeof FAST> = {}) {
  const events: Array<{ event: string; props: Record<string, unknown> }> = [];
  const manager = new RoomManager({ rng: () => 0, ...timing, analytics: (event, props) => { events.push({ event, props: props ?? {} }); } });
  const owner = authenticatedConnection(manager, testUid(1));
  manager.handle(owner.conn, { t: "CREATE_ROOM", name: "المالك" });
  const code = lastMessage(owner.socket, "STATE")!.view.room.code;
  const players = [2, 3, 4].map((index) => joinPlayer(manager, code, index));
  const room = () => manager.roomForTests(code)!;
  return { manager, owner, players, code, room, events };
}

function readyAll(manager: RoomManager, clients: Array<{ conn: Parameters<RoomManager["handle"]>[0] }>) {
  for (const client of clients) manager.handle(client.conn, { t: "MARK_READY" });
}

test("RETURN_TO_LOBBY must carry the match identity and nothing else", () => {
  assert.ok(validateClientMessage({ t: "RETURN_TO_LOBBY", matchGeneration: 1 }));
  assert.ok(validateClientMessage({ t: "RETURN_TO_LOBBY", matchGeneration: 0, rid: "end-1" }));
  assert.equal(validateClientMessage({ t: "RETURN_TO_LOBBY" }), null, "the match identity is required");
  assert.equal(validateClientMessage({ t: "RETURN_TO_LOBBY", rid: "end-1" }), null);
  assert.equal(validateClientMessage({ t: "RETURN_TO_LOBBY", matchGeneration: "1" }), null);
  assert.equal(validateClientMessage({ t: "RETURN_TO_LOBBY", matchGeneration: -1 }), null);
  assert.equal(validateClientMessage({ t: "RETURN_TO_LOBBY", matchGeneration: 1.5 }), null);
  assert.equal(validateClientMessage({ t: "RETURN_TO_LOBBY", matchGeneration: 1e9 }), null);
  assert.equal(validateClientMessage({ t: "RETURN_TO_LOBBY", matchGeneration: 1, code: "ABCDE" }), null);
});

test("every client view carries the server-issued match number", () => {
  const { manager, owner, players, room } = ownerRoom();
  try {
    for (const client of [owner, ...players]) assert.equal(lastMessage(client.socket, "STATE")!.view.room.matchGeneration, 0);
    manager.handle(owner.conn, { t: "START_GAME" });
    assert.equal(room().matchGeneration, 1);
    for (const client of [owner, ...players]) assert.equal(lastMessage(client.socket, "STATE")!.view.room.matchGeneration, 1);
  } finally { manager.dispose(); }
});

test("two owner tabs: a delayed end command from the old match cannot end the new match", () => {
  const { manager, owner, room, events } = ownerRoom();
  try {
    const tabB = authenticatedConnection(manager, testUid(1));
    manager.handle(owner.conn, { t: "START_GAME" });
    const tabAMatch = lastMessage(owner.socket, "STATE")!.view.room.matchGeneration;

    // Tab B ends that match and starts another while tab A's command is delayed.
    assert.equal(manager.handle(tabB.conn, { t: "RETURN_TO_LOBBY", matchGeneration: tabAMatch, rid: "b-end" }), true);
    assert.equal(manager.handle(tabB.conn, { t: "START_GAME" }), true);
    assert.equal(room().phase, "QUESTION");
    const newMatchGeneration = room().matchGeneration;
    assert.equal(newMatchGeneration, tabAMatch + 1);
    const abandonedBefore = events.filter((entry) => entry.event === "game_abandoned").length;
    const voteContext = room().round!.voteContext;

    // Tab A's first delivery finally arrives with a never-seen rid.
    owner.socket.messages.length = 0;
    assert.equal(manager.handle(owner.conn, { t: "RETURN_TO_LOBBY", matchGeneration: tabAMatch, rid: "a-late" }), true);
    assert.equal(lastMessage(owner.socket, "ACK")?.rid, "a-late", "answered like an ignored stale ballot, not an error");
    assert.equal(owner.socket.messages.some((message) => message.t === "ERROR"), false);
    assert.equal(lastMessage(owner.socket, "STATE")?.view.room.matchGeneration, newMatchGeneration, "the stale tab is refreshed");
    assert.equal(room().phase, "QUESTION", "the new match keeps running");
    assert.equal(room().round!.voteContext, voteContext);
    assert.equal(room().matchGeneration, newMatchGeneration);
    assert.equal(events.filter((entry) => entry.event === "game_abandoned").length, abandonedBefore);

    // The same tab with the current match identity still works.
    assert.equal(manager.handle(owner.conn, { t: "RETURN_TO_LOBBY", matchGeneration: newMatchGeneration, rid: "a-now" }), true);
    assert.equal(room().phase, "LOBBY");
  } finally { manager.dispose(); }
});

test("a stale match identity is ignored in every phase of the new match, never a phase restriction", () => {
  const { manager, owner, room } = ownerRoom();
  try {
    manager.handle(owner.conn, { t: "START_GAME" });
    manager.handle(owner.conn, { t: "RETURN_TO_LOBBY", matchGeneration: 1 });
    manager.handle(owner.conn, { t: "START_GAME" });
    for (const phase of ["QUESTION", "VOTING", "RESULT", "GAME_OVER"] as const) {
      room().phase = phase;
      assert.equal(manager.handle(owner.conn, { t: "RETURN_TO_LOBBY", matchGeneration: 1 }), true);
      assert.equal(room().phase, phase, `${phase} untouched by the old match's command`);
    }
    room().phase = "VOTING";
    assert.equal(manager.handle(owner.conn, { t: "RETURN_TO_LOBBY", matchGeneration: 2 }), true);
    assert.equal(room().phase, "LOBBY", "ordinary phase changes inside the same match stay allowed");
  } finally { manager.dispose(); }
});

test("owner ends a match mid-game: same room, same seats, fresh lobby, one abandonment event", () => {
  const { manager, owner, players, code, room, events } = ownerRoom();
  try {
    manager.handle(owner.conn, { t: "SET_SETTINGS", totalRounds: 6 });
    assert.equal(manager.handle(owner.conn, { t: "START_GAME" }), true);
    assert.equal(room().phase, "QUESTION");
    const seatsBefore = [...room().players.keys()].sort();
    room().players.get(testUid(2))!.score = 3;

    assert.equal(manager.handle(owner.conn, { t: "RETURN_TO_LOBBY", matchGeneration: room().matchGeneration, rid: "end-1" }), true);
    assert.equal(lastMessage(owner.socket, "ACK")?.rid, "end-1");

    const after = room();
    assert.equal(after.code, code);
    assert.equal(after.phase, "LOBBY");
    assert.equal(after.round, null);
    assert.equal(after.currentRound, 0);
    assert.equal(after.targetChallenges, 6, "configured settings survive");
    assert.deepEqual([...after.players.keys()].sort(), seatsBefore, "every seat is kept");
    assert.ok([...after.players.values()].every((player) => player.score === 0), "ended-match points are discarded");
    for (const client of [owner, ...players]) {
      assert.equal(client.conn.roomCode, code);
      assert.equal(lastMessage(client.socket, "STATE")?.view.room.phase, "LOBBY");
      assert.equal(client.socket.messages.some((message) => message.t === "ROOM_CLOSED" || message.t === "KICKED"), false);
    }

    const abandoned = events.filter((entry) => entry.event === "game_abandoned");
    assert.equal(abandoned.length, 1);
    assert.equal(abandoned[0]!.props.reason, "ended_to_lobby");
    assert.equal(abandoned[0]!.props.phase, "QUESTION");
    assert.equal(events.some((entry) => entry.event === "room_closed"), false);
  } finally { manager.dispose(); }
});

test("only the owner can end a match, and not from the lobby", () => {
  const { manager, owner, players, room } = ownerRoom();
  try {
    assert.equal(manager.handle(owner.conn, { t: "RETURN_TO_LOBBY", matchGeneration: room().matchGeneration }), false);
    assert.equal(lastMessage(owner.socket, "ERROR")?.code, "INVALID_PHASE");

    manager.handle(owner.conn, { t: "START_GAME" });
    assert.equal(manager.handle(players[0]!.conn, { t: "RETURN_TO_LOBBY", matchGeneration: room().matchGeneration }), false);
    assert.equal(lastMessage(players[0]!.socket, "ERROR")?.code, "NOT_HOST");
    assert.equal(room().phase, "QUESTION");
  } finally { manager.dispose(); }
});

test("settings can change and a new match starts after returning to the lobby", () => {
  const { manager, owner, room, events } = ownerRoom();
  try {
    manager.handle(owner.conn, { t: "START_GAME" });
    manager.handle(owner.conn, { t: "RETURN_TO_LOBBY", matchGeneration: room().matchGeneration });
    assert.equal(manager.handle(owner.conn, { t: "SET_SETTINGS", totalRounds: 3, selectedModes: ["HANDS"] }), true);
    assert.equal(manager.handle(owner.conn, { t: "START_GAME" }), true);
    assert.equal(room().phase, "QUESTION");
    assert.equal(room().round?.mode, "HANDS");
    const starts = events.filter((entry) => entry.event === "game_started");
    assert.equal(starts.length, 2);
    assert.notEqual(starts[0]!.props.matchId, starts[1]!.props.matchId);
  } finally { manager.dispose(); }
});

test("a ballot from the ended match is ignored in the lobby and in the next match", () => {
  const { manager, owner, players, room, events } = ownerRoom();
  try {
    manager.handle(owner.conn, { t: "START_GAME" });
    room().phase = "VOTING";
    room().phaseEndsAt = Date.now() + 60_000;
    const staleContext = room().round!.voteContext!;
    const voter = players[0]!;
    const target = players[1]!.uid;

    manager.handle(owner.conn, { t: "RETURN_TO_LOBBY", matchGeneration: room().matchGeneration });
    assert.equal(manager.handle(voter.conn, { t: "SUBMIT_VOTE", targetUid: target, voteContext: staleContext, rid: "late-1" }), true);
    assert.equal(lastMessage(voter.socket, "VOTE_IGNORED")?.reason, "STALE_CHALLENGE");

    manager.handle(owner.conn, { t: "START_GAME" });
    room().phase = "VOTING";
    room().phaseEndsAt = Date.now() + 60_000;
    assert.notEqual(room().round!.voteContext, staleContext);
    assert.equal(manager.handle(voter.conn, { t: "SUBMIT_VOTE", targetUid: target, voteContext: staleContext, rid: "late-2" }), true);
    assert.equal(room().round!.votes.size, 0, "an old ballot never counts in the new match");
    assert.equal(events.filter((entry) => entry.event === "game_error").length, 0);
  } finally { manager.dispose(); }
});

test("stage timers of the ended match cannot advance the lobby", async () => {
  const { manager, owner, players, room } = ownerRoom(FAST);
  try {
    manager.handle(owner.conn, { t: "START_GAME" });
    readyAll(manager, [owner, ...players]);
    assert.notEqual(room().phase, "QUESTION", "the physical sequence started");
    manager.handle(owner.conn, { t: "RETURN_TO_LOBBY", matchGeneration: room().matchGeneration });
    await wait(200);
    assert.equal(room().phase, "LOBBY");
    assert.equal(room().phaseEndsAt, undefined);
  } finally { manager.dispose(); }
});

test("GAME_OVER return to lobby behaves like a rematch without an abandonment event", () => {
  const { manager, owner, room, events } = ownerRoom();
  try {
    manager.handle(owner.conn, { t: "START_GAME" });
    room().phase = "GAME_OVER";
    assert.equal(manager.handle(owner.conn, { t: "RETURN_TO_LOBBY", matchGeneration: room().matchGeneration }), true);
    assert.equal(room().phase, "LOBBY");
    assert.equal(events.filter((entry) => entry.event === "game_abandoned").length, 0);
  } finally { manager.dispose(); }
});
