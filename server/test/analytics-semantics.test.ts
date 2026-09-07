import test from "node:test";
import assert from "node:assert/strict";
import type { AnalyticsEvent } from "../../shared/types.js";
import { sanitizeAnalyticsProps, type AnalyticsProps } from "../src/analytics.js";
import * as engine from "../src/game/engine.js";
import { RoomManager } from "../src/game/roomManager.js";
import { authenticatedConnection, createRoom, joinPlayer, testUid } from "./helpers.js";

interface RecordedEvent {
  event: AnalyticsEvent;
  props: AnalyticsProps;
}

function recorder() {
  const events: RecordedEvent[] = [];
  return {
    events,
    track: (event: AnalyticsEvent, props: AnalyticsProps = {}) => { events.push({ event, props }); },
  };
}

function startThreePlayerMatch(manager: RoomManager) {
  const host = createRoom(manager);
  const players = [2, 3, 4].map((index) => joinPlayer(manager, host.code, index));
  assert.equal(manager.handle(host.conn, { t: "START_GAME" }), true);
  const room = manager.roomForTests(host.code)!;
  return { host, players, room };
}

function resolveCurrentChallenge(
  manager: RoomManager,
  host: ReturnType<typeof createRoom>,
  players: ReturnType<typeof joinPlayer>[],
  catchImpostor = true,
): void {
  const room = manager.roomForTests(host.code)!;
  const deps = { now: () => Date.now(), rng: () => 0 };
  engine.startCountdown(room, Date.now() + 1, deps);
  engine.toAction(room, Date.now() + 1, deps);
  engine.toHold(room, Date.now() + 1, deps);
  engine.revealPrompt(room, Date.now() + 1, deps);
  engine.toDiscussion(room, deps);
  assert.equal(manager.handle(host.conn, { t: "START_VOTING" }), true);

  const impostor = players.find((player) => player.uid === room.round!.impostorUid)!;
  const normals = players.filter((player) => player.uid !== impostor.uid);
  for (const normal of normals) {
    const target = catchImpostor ? impostor.uid : normals.find((candidate) => candidate.uid !== normal.uid)?.uid ?? impostor.uid;
    assert.equal(manager.handle(normal.conn, { t: "SUBMIT_VOTE", targetUid: target }), true);
  }
  assert.equal(manager.handle(impostor.conn, { t: "SUBMIT_VOTE", targetUid: normals[0]!.uid }), true);
  assert.equal(room.phase, "RESULT");
}

test("analytics properties are event-specific allowlists, not key-name blacklists", () => {
  const safe = sanitizeAnalyticsProps("game_started", {
    matchOrdinal: 1,
    isFirstMatch: true,
    targetChallenges: 9,
    startingPlayerCount: 6,
    modeCount: 3,
    rulesVersion: "competitive-v1",
    contentVersion: "imitation-bank-v1",
    roomCode: "ABCDE",
    harmlessLookingSecret: "must-not-pass",
    player: "سلمان",
  });
  assert.deepEqual(safe, {
    matchOrdinal: 1,
    isFirstMatch: true,
    targetChallenges: 9,
    startingPlayerCount: 6,
    modeCount: 3,
    rulesVersion: "competitive-v1",
    contentVersion: "imitation-bank-v1",
  });

  const challenge = sanitizeAnalyticsProps("challenge_completed", {
    promptId: "H017",
    promptText: "نص سري لا يجب أن يمر",
    challengeOrdinal: 2,
    mode: "HANDS",
  });
  assert.equal(challenge.promptId, "H017");
  assert.equal(challenge.challengeOrdinal, 2);
  assert.equal(challenge.mode, "HANDS");
  assert.equal("promptText" in challenge, false);
});

test("game completion is recorded at the final resolved RESULT, before Host advances", () => {
  const recorded = recorder();
  const manager = new RoomManager({ analytics: recorded.track, rng: () => 0 });
  const { host, players, room } = startThreePlayerMatch(manager);

  const starts = recorded.events.filter((entry) => entry.event === "game_started");
  assert.equal(starts.length, 1);
  assert.equal(starts[0]!.props.isFirstMatch, true);
  assert.equal(starts[0]!.props.startingPlayerCount, 3);

  // Reach the product's final base Challenge without needing to run the earlier eight here.
  room.completedChallenges = room.targetChallenges - 1;
  resolveCurrentChallenge(manager, host, players, true);

  assert.equal(room.phase, "RESULT");
  assert.equal(room.round?.roundComplete, true);
  assert.equal(room.completedChallenges, room.targetChallenges);
  assert.equal(recorded.events.filter((entry) => entry.event === "challenge_completed").length, 1);
  const completed = recorded.events.filter((entry) => entry.event === "game_completed");
  assert.equal(completed.length, 1, "completion is emitted at final RESULT without NEXT_ROUND");
  assert.equal(completed[0]!.props.completedChallenges, room.targetChallenges);

  // Projection/repeated actions must not produce a second logical completion.
  manager.handle(host.conn, { t: "NEXT_ROUND" });
  assert.equal(room.phase, "GAME_OVER");
  assert.equal(recorded.events.filter((entry) => entry.event === "game_completed").length, 1);
  manager.dispose();
});

test("rematch request and actual second-match start are separate events", () => {
  const recorded = recorder();
  const manager = new RoomManager({ analytics: recorded.track, rng: () => 0 });
  const { host, players, room } = startThreePlayerMatch(manager);
  room.completedChallenges = room.targetChallenges - 1;
  resolveCurrentChallenge(manager, host, players, true);
  manager.handle(host.conn, { t: "NEXT_ROUND" });
  assert.equal(room.phase, "GAME_OVER");

  assert.equal(manager.handle(host.conn, { t: "REMATCH", rid: "again1" }), true);
  assert.equal(room.phase, "LOBBY");
  assert.equal(recorded.events.filter((entry) => entry.event === "rematch_requested").length, 1);
  assert.equal(recorded.events.filter((entry) => entry.event === "rematch_started").length, 0);

  // A retried request id is acknowledged from the request cache and cannot double-count intent.
  assert.equal(manager.handle(host.conn, { t: "REMATCH", rid: "again1" }), true);
  assert.equal(recorded.events.filter((entry) => entry.event === "rematch_requested").length, 1);

  assert.equal(manager.handle(host.conn, { t: "START_GAME" }), true);
  const secondStart = recorded.events.filter((entry) => entry.event === "rematch_started");
  assert.equal(secondStart.length, 1);
  assert.equal(secondStart[0]!.props.previousMatchOrdinal, 1);
  assert.equal(secondStart[0]!.props.matchOrdinal, 2);
  manager.dispose();
});

test("explicit leave is distinct from disconnect and reconnect", () => {
  const recorded = recorder();
  const manager = new RoomManager({ analytics: recorded.track });
  const host = createRoom(manager);
  const leaving = joinPlayer(manager, host.code, 2);
  const flaky = joinPlayer(manager, host.code, 3);

  manager.disconnect(flaky.conn);
  assert.equal(recorded.events.filter((entry) => entry.event === "player_disconnected").length, 1);
  assert.equal(recorded.events.filter((entry) => entry.event === "player_left").length, 0);

  authenticatedConnection(manager, flaky.uid);
  assert.equal(recorded.events.filter((entry) => entry.event === "player_reconnected").length, 1);
  assert.equal(recorded.events.filter((entry) => entry.event === "player_left").length, 0);

  assert.equal(manager.handle(leaving.conn, { t: "LEAVE_ROOM" }), true);
  assert.equal(recorded.events.filter((entry) => entry.event === "player_left").length, 1);
  manager.dispose();
});

test("analytics sink failures never block room creation or game start", () => {
  const manager = new RoomManager({
    analytics: () => { throw new Error("analytics unavailable"); },
    rng: () => 0,
  });
  const host = createRoom(manager, testUid(20));
  joinPlayer(manager, host.code, 21);
  joinPlayer(manager, host.code, 22);
  joinPlayer(manager, host.code, 23);
  assert.equal(manager.handle(host.conn, { t: "START_GAME" }), true);
  assert.equal(manager.roomForTests(host.code)?.phase, "QUESTION");
  manager.dispose();
});
