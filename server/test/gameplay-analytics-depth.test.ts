import test from "node:test";
import assert from "node:assert/strict";
import type { AnalyticsEvent } from "../../shared/types.js";
import type { AnalyticsProps } from "../src/analytics.js";
import { RoomManager } from "../src/game/roomManager.js";
import { createRoom, joinPlayer } from "./helpers.js";

interface RecordedEvent { event: AnalyticsEvent; props: AnalyticsProps }

function recorder() {
  const events: RecordedEvent[] = [];
  return {
    events,
    track: (event: AnalyticsEvent, props: AnalyticsProps = {}) => { events.push({ event, props }); },
  };
}

async function waitForPhase(manager: RoomManager, code: string, phase: string): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (Date.now() < deadline) {
    if (manager.roomForTests(code)?.phase === phase) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(`timed out waiting for ${phase}`);
}

test("deep gameplay analytics correlates anonymous room/match lifecycle and vote aggregates", async () => {
  const recorded = recorder();
  const manager = new RoomManager({
    analytics: recorded.track,
    rng: () => 0,
    countdownMs: 1,
    actionMs: 1,
    holdMs: 1,
    promptRevealMs: 1,
  });
  const host = createRoom(manager);
  const players = [2, 3, 4].map((index) => joinPlayer(manager, host.code, index));

  assert.equal(manager.handle(host.conn, { t: "SET_SETTINGS", totalRounds: 3, selectedModes: ["HANDS", "POINT"] }), true);
  assert.equal(manager.handle(host.conn, { t: "START_GAME" }), true);
  const room = manager.roomForTests(host.code)!;
  room.completedChallenges = room.targetChallenges - 1;

  for (const player of players) assert.equal(manager.handle(player.conn, { t: "MARK_READY" }), true);
  await waitForPhase(manager, host.code, "DISCUSSION");
  assert.equal(manager.handle(host.conn, { t: "START_VOTING" }), true);

  const impostor = players.find((player) => player.uid === room.round!.impostorUid)!;
  const normals = players.filter((player) => player.uid !== impostor.uid);
  for (const normal of normals) assert.equal(manager.handle(normal.conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid }), true);
  assert.equal(manager.handle(impostor.conn, { t: "SUBMIT_VOTE", targetUid: normals[0]!.uid }), true);
  assert.equal(room.phase, "RESULT");

  const created = recorded.events.find((entry) => entry.event === "room_created")!;
  const started = recorded.events.find((entry) => entry.event === "game_started")!;
  const challenge = recorded.events.find((entry) => entry.event === "challenge_completed")!;
  const completed = recorded.events.find((entry) => entry.event === "game_completed")!;
  const settings = recorded.events.find((entry) => entry.event === "settings_changed")!;

  assert.equal(typeof created.props.roomSessionId, "string");
  assert.equal(started.props.roomSessionId, created.props.roomSessionId);
  assert.equal(challenge.props.roomSessionId, created.props.roomSessionId);
  assert.equal(completed.props.roomSessionId, created.props.roomSessionId);
  assert.equal(typeof started.props.matchId, "string");
  assert.equal(challenge.props.matchId, started.props.matchId);
  assert.equal(completed.props.matchId, started.props.matchId);
  assert.equal(settings.props.modeSet, "HANDS+POINT");
  assert.equal(settings.props.targetChallenges, 3);

  assert.equal(challenge.props.impostorVotes, 2);
  assert.equal(challenge.props.requiredVotes, 2);
  assert.equal(challenge.props.topNormalVotes, 1);
  assert.equal(challenge.props.distinctTargets, 2);
  assert.equal(challenge.props.voteMargin, 0);
  assert.equal(challenge.props.caught, true);
  assert.equal(challenge.props.stintOrdinal, 1);
  assert.equal(typeof challenge.props.readySeconds, "number");
  assert.equal(typeof challenge.props.discussionSeconds, "number");
  assert.equal(typeof challenge.props.votingSeconds, "number");
  assert.equal(typeof challenge.props.challengeSeconds, "number");

  assert.equal(completed.props.endingPlayerCount, 3);
  assert.equal(typeof completed.props.topScore, "number");
  assert.equal(typeof completed.props.averageScore, "number");
  assert.equal(typeof completed.props.scoreSpread, "number");
  assert.equal("uid" in challenge.props, false);
  assert.equal("roomCode" in challenge.props, false);
  manager.dispose();
});

test("abandoned matches are recorded once with anonymous lifecycle ids", () => {
  const recorded = recorder();
  const manager = new RoomManager({ analytics: recorded.track, rng: () => 0 });
  const host = createRoom(manager);
  [2, 3, 4].forEach((index) => joinPlayer(manager, host.code, index));
  assert.equal(manager.handle(host.conn, { t: "START_GAME" }), true);
  assert.equal(manager.handle(host.conn, { t: "CLOSE_ROOM" }), true);

  const abandoned = recorded.events.filter((entry) => entry.event === "game_abandoned");
  assert.equal(abandoned.length, 1);
  assert.equal(abandoned[0]!.props.reason, "closed_by_host");
  assert.equal(typeof abandoned[0]!.props.roomSessionId, "string");
  assert.equal(typeof abandoned[0]!.props.matchId, "string");
  assert.equal("uid" in abandoned[0]!.props, false);
  assert.equal("roomCode" in abandoned[0]!.props, false);
  manager.dispose();
});
