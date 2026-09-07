import test from "node:test";
import assert from "node:assert/strict";
import type { AnalyticsEvent } from "../../shared/types.js";
import { sanitizeAnalyticsProps, type AnalyticsProps } from "../src/analytics.js";
import * as engine from "../src/game/engine.js";
import { RoomManager } from "../src/game/roomManager.js";
import { buildView } from "../src/game/view.js";
import { validateClientMessage } from "../src/security/messages.js";
import { createRoom, joinPlayer, lastMessage } from "./helpers.js";

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

function resolveCaughtChallenge(
  manager: RoomManager,
  host: ReturnType<typeof createRoom>,
  players: ReturnType<typeof joinPlayer>[],
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
    assert.equal(manager.handle(normal.conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid }), true);
  }
  assert.equal(manager.handle(impostor.conn, { t: "SUBMIT_VOTE", targetUid: normals[0]!.uid }), true);
  assert.equal(room.phase, "RESULT");
}

function finishMatch(manager: RoomManager) {
  const started = startThreePlayerMatch(manager);
  started.room.completedChallenges = started.room.targetChallenges - 1;
  resolveCaughtChallenge(manager, started.host, started.players);
  assert.equal(started.room.completedChallenges, started.room.targetChallenges);
  assert.equal(manager.handle(started.host.conn, { t: "NEXT_ROUND" }), true);
  assert.equal(started.room.phase, "GAME_OVER");
  return started;
}

test("feedback protocol is enum-only and rejects free text or incomplete challenge reports", () => {
  assert.ok(validateClientMessage({ t: "SUBMIT_FEEDBACK", rating: "EXCELLENT" }));
  assert.ok(validateClientMessage({
    t: "SUBMIT_FEEDBACK",
    rating: "NEEDS_WORK",
    challengeOrdinal: 2,
    issueReason: "UNCLEAR",
  }));

  for (const invalid of [
    { t: "SUBMIT_FEEDBACK", rating: "BAD" },
    { t: "SUBMIT_FEEDBACK", rating: "GOOD", comment: "نص حر" },
    { t: "SUBMIT_FEEDBACK", rating: "GOOD", challengeOrdinal: 1 },
    { t: "SUBMIT_FEEDBACK", rating: "GOOD", issueReason: "UNCLEAR" },
    { t: "SUBMIT_FEEDBACK", rating: "GOOD", challengeOrdinal: 0, issueReason: "UNCLEAR" },
    { t: "SUBMIT_FEEDBACK", rating: "GOOD", challengeOrdinal: 21, issueReason: "UNCLEAR" },
    { t: "SUBMIT_FEEDBACK", rating: "GOOD", challengeOrdinal: 1, issueReason: "OTHER" },
  ]) assert.equal(validateClientMessage(invalid), null, JSON.stringify(invalid));
});

test("GAME_OVER feedback is player-only, eligibility-gated, and never exposes promptId", () => {
  const manager = new RoomManager({ rng: () => 0 });
  const { host, players, room } = finishMatch(manager);

  const hostView = buildView(room, host.uid, `http://localhost/join/${room.code}`);
  assert.equal(hostView.feedback, undefined);

  const eligible = players[0]!;
  const playerView = buildView(room, eligible.uid, `http://localhost/join/${room.code}`);
  assert.equal(playerView.feedback?.submitted, false);
  assert.equal(playerView.feedback?.challenges.length, 1);
  assert.equal(playerView.feedback?.challenges[0]?.ordinal, room.targetChallenges);
  assert.equal("promptId" in (playerView.feedback?.challenges[0] ?? {}), false);
  assert.doesNotMatch(JSON.stringify(playerView.feedback), /promptId/);

  room.feedbackEligibleUids.delete(players[1]!.uid);
  const ineligibleView = buildView(room, players[1]!.uid, `http://localhost/join/${room.code}`);
  assert.equal(ineligibleView.feedback, undefined);
  manager.dispose();
});

test("eligible player can submit feedback once and analytics carries no identity or prompt text", () => {
  const recorded = recorder();
  const manager = new RoomManager({ analytics: recorded.track, rng: () => 0 });
  const { host, players, room } = finishMatch(manager);
  const player = players[0]!;
  const challenge = room.completedChallengeSummaries[0]!;

  assert.equal(manager.handle(player.conn, {
    t: "SUBMIT_FEEDBACK",
    rating: "NEEDS_WORK",
    challengeOrdinal: challenge.ordinal,
    issueReason: "TOO_REVEALING",
    rid: "feedback1",
  }), true);

  const ratingEvents = recorded.events.filter((entry) => entry.event === "feedback_rating");
  const issueEvents = recorded.events.filter((entry) => entry.event === "feedback_challenge_issue");
  assert.equal(ratingEvents.length, 1);
  assert.equal(issueEvents.length, 1);
  assert.equal(issueEvents[0]!.props.promptId, challenge.promptId);
  assert.equal(issueEvents[0]!.props.challengeOrdinal, challenge.ordinal);
  assert.equal(issueEvents[0]!.props.reason, "TOO_REVEALING");

  for (const entry of [...ratingEvents, ...issueEvents]) {
    const keys = Object.keys(entry.props);
    assert.equal(keys.some((key) => /uid|name|roomCode|promptText|vote/i.test(key)), false, JSON.stringify(entry));
    assert.equal(Object.values(entry.props).includes(challenge.prompt), false, JSON.stringify(entry));
  }

  const state = lastMessage(player.socket, "STATE");
  assert.equal(state?.view.feedback?.submitted, true);
  assert.deepEqual(state?.view.feedback?.challenges, []);

  assert.equal(manager.handle(player.conn, {
    t: "SUBMIT_FEEDBACK",
    rating: "GOOD",
    rid: "feedback2",
  }), false);
  assert.equal(recorded.events.filter((entry) => entry.event === "feedback_rating").length, 1);
  assert.equal(recorded.events.filter((entry) => entry.event === "feedback_challenge_issue").length, 1);

  assert.equal(manager.handle(host.conn, { t: "SUBMIT_FEEDBACK", rating: "GOOD" }), false);
  assert.equal(recorded.events.filter((entry) => entry.event === "feedback_rating").length, 1);
  manager.dispose();
});

test("ineligible player and unknown challenge cannot influence feedback analytics", () => {
  const recorded = recorder();
  const manager = new RoomManager({ analytics: recorded.track, rng: () => 0 });
  const { players, room } = finishMatch(manager);

  room.feedbackEligibleUids.delete(players[0]!.uid);
  assert.equal(manager.handle(players[0]!.conn, { t: "SUBMIT_FEEDBACK", rating: "GOOD" }), false);
  assert.equal(recorded.events.filter((entry) => entry.event === "feedback_rating").length, 0);

  const eligible = players[1]!;
  assert.equal(manager.handle(eligible.conn, {
    t: "SUBMIT_FEEDBACK",
    rating: "OK",
    challengeOrdinal: 1,
    issueReason: "UNCLEAR",
  }), false);
  assert.equal(recorded.events.filter((entry) => entry.event === "feedback_rating").length, 0);
  assert.equal(recorded.events.filter((entry) => entry.event === "feedback_challenge_issue").length, 0);
  manager.dispose();
});

test("feedback state resets across rematch and analytics sink failure never blocks acknowledgement", () => {
  const manager = new RoomManager({
    analytics: () => { throw new Error("analytics unavailable"); },
    rng: () => 0,
  });
  const { host, players, room } = finishMatch(manager);
  const player = players[0]!;

  assert.equal(manager.handle(player.conn, { t: "SUBMIT_FEEDBACK", rating: "EXCELLENT", rid: "feedback3" }), true);
  assert.equal(room.feedbackSubmittedUids.has(player.uid), true);
  assert.equal(lastMessage(player.socket, "ACK")?.rid, "feedback3");

  assert.equal(manager.handle(host.conn, { t: "REMATCH" }), true);
  assert.equal(room.phase, "LOBBY");
  assert.equal(room.completedChallengeSummaries.length, 0);
  assert.equal(room.feedbackEligibleUids.size, 0);
  assert.equal(room.feedbackSubmittedUids.size, 0);

  assert.equal(manager.handle(host.conn, { t: "START_GAME" }), true);
  assert.equal(room.feedbackEligibleUids.size, 0);
  assert.equal(room.feedbackSubmittedUids.size, 0);
  manager.dispose();
});

test("feedback analytics sanitizer drops injected identity and free text fields", () => {
  const rating = sanitizeAnalyticsProps("feedback_rating", {
    matchOrdinal: 1,
    rating: "GOOD",
    targetChallenges: 9,
    completedChallenges: 9,
    startingPlayerCount: 4,
    uid: "u_secret",
    name: "سلمان",
    roomCode: "ABCDE",
    comment: "free text",
  });
  assert.deepEqual(rating, {
    matchOrdinal: 1,
    rating: "GOOD",
    targetChallenges: 9,
    completedChallenges: 9,
    startingPlayerCount: 4,
  });

  const issue = sanitizeAnalyticsProps("feedback_challenge_issue", {
    matchOrdinal: 1,
    challengeOrdinal: 3,
    promptId: "H017",
    mode: "HANDS",
    reason: "UNCLEAR",
    prompt: "لا يمر",
    voterUid: "u_secret",
  });
  assert.equal(issue.promptId, "H017");
  assert.equal("prompt" in issue, false);
  assert.equal("voterUid" in issue, false);
});