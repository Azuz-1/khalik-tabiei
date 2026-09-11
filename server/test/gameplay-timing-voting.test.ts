import { readFile } from "node:fs/promises";
import test from "node:test";
import assert from "node:assert/strict";
import { TIMERS } from "../../shared/constants.js";
import { HostAudioEventController, type HostAudioSnapshot } from "../../client/src/audio/hostAudioEvents.js";
import { ANALYTICS_RULES_VERSION, sanitizeAnalyticsProps, type AnalyticsProps } from "../src/analytics.js";
import * as engine from "../src/game/engine.js";
import { RoomManager } from "../src/game/roomManager.js";
import { createRoomState, type InternalPlayer, type RoomState } from "../src/game/state.js";
import * as voting from "../src/game/voting.js";
import { buildView } from "../src/game/view.js";
import { authenticatedConnection, createRoom, joinPlayer, lastMessage, wait } from "./helpers.js";

async function waitForPhase(room: { phase: string }, phase: string, timeoutMs = 600): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (room.phase !== phase && Date.now() < deadline) await wait(2);
  assert.equal(room.phase, phase);
}

function setupManager(
  count = 3,
  overrides: ConstructorParameters<typeof RoomManager>[0] = {},
) {
  const events: Array<{ event: string; props: AnalyticsProps }> = [];
  const manager = new RoomManager({
    rng: () => 0,
    countdownMs: 2,
    actionMs: 2,
    holdMs: 2,
    promptRevealMs: 2,
    discussionMs: 25,
    votingMs: 25,
    survivedTransitionMs: 25,
    fullResultMs: 120,
    analytics: (event, props = {}) => events.push({ event, props }),
    ...overrides,
  });
  const host = createRoom(manager);
  const players = Array.from({ length: count }, (_, index) =>
    joinPlayer(manager, host.code, index + 2),
  );
  const room = manager.roomForTests(host.code)!;
  manager.handle(host.conn, { t: "START_GAME" });
  return { manager, host, players, room, events };
}

async function readyToDiscussion(setup: ReturnType<typeof setupManager>): Promise<void> {
  for (const player of setup.players) setup.manager.handle(player.conn, { t: "MARK_READY" });
  await waitForPhase(setup.room, "DISCUSSION");
}

async function readyToVoting(setup: ReturnType<typeof setupManager>): Promise<void> {
  await readyToDiscussion(setup);
  await waitForPhase(setup.room, "VOTING");
}

function addDirectPlayers(room: RoomState, count: number): void {
  for (let index = 1; index <= count; index += 1) {
    const player: InternalPlayer = {
      uid: `p${index}`,
      name: `لاعب${index}`,
      normalizedName: `لاعب${index}`,
      seatNumber: index,
      score: 0,
      connected: true,
      joinedAt: index,
      lastSeen: index,
      disconnectGeneration: 0,
      isHost: false,
    };
    room.players.set(player.uid, player);
  }
}

function directVotingRoom(count: number): RoomState {
  const room = createRoomState("AUTO1", "host", 1_000);
  addDirectPlayers(room, count);
  engine.startGame(room, "host", { now: () => 1_000, rng: () => 0 });
  room.phase = "VOTING";
  room.phaseEndsAt = 2_000;
  return room;
}

function settleDirect(count: number, voteTargets: string[]): RoomState {
  const room = directVotingRoom(count);
  const round = room.round!;
  for (let index = 0; index < voteTargets.length; index += 1) {
    round.votes.set(round.participantUids[index]!, voteTargets[index]!);
  }
  for (const uid of round.participantUids.slice(voteTargets.length)) round.abstainedUids!.add(uid);
  voting.computeResult(room, { now: () => 1_001 });
  return room;
}

function advanceDirectToVoting(room: RoomState): void {
  const deps = { now: () => 2_000, rng: () => 0 };
  for (const uid of room.round!.participantUids) engine.markReady(room, uid, deps);
  engine.startCountdown(room, 2_100, deps);
  engine.toAction(room, 2_200, deps);
  engine.toHold(room, 2_300, deps);
  engine.revealPrompt(room, 2_400, deps);
  engine.toDiscussion(room, deps);
  engine.startVoting(room, "host", deps);
}

test("production cadence constants are 45s discussion, 15s voting, 4s survived, 20s full reveal", () => {
  assert.equal(TIMERS.DISCUSSION, 45_000);
  assert.equal(TIMERS.VOTING, 15_000);
  assert.equal(TIMERS.SURVIVED_TRANSITION, 4_000);
  assert.equal(TIMERS.FULL_RESULT, 20_000);
  assert.equal("VOTING_DISCONNECT_GRACE" in TIMERS, false);
});

test("discussion starts with an absolute deadline and voting begins automatically without START_VOTING", async () => {
  const setup = setupManager(3, { discussionMs: 35, votingMs: 100 });
  try {
    await readyToDiscussion(setup);
    const discussionDeadline = setup.room.phaseEndsAt;
    assert.ok(discussionDeadline);
    assert.ok(discussionDeadline! > Date.now());
    await waitForPhase(setup.room, "VOTING");
    assert.ok(setup.room.phaseEndsAt && setup.room.phaseEndsAt > Date.now());
    assert.ok(setup.room.phaseEndsAt! > discussionDeadline!);
  } finally {
    setup.manager.dispose();
  }
});

test("all participants voting resolves immediately before the global voting timeout", async () => {
  const setup = setupManager(3, { votingMs: 250, fullResultMs: 300 });
  try {
    await readyToVoting(setup);
    const votingDeadline = setup.room.phaseEndsAt!;
    const impostor = setup.players.find((player) => player.uid === setup.room.round!.impostorUid)!;
    const normals = setup.players.filter((player) => player.uid !== impostor.uid);
    setup.manager.handle(impostor.conn, { t: "SUBMIT_VOTE", targetUid: normals[0]!.uid });
    for (const normal of normals) setup.manager.handle(normal.conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
    assert.equal(setup.room.phase, "RESULT");
    assert.ok(Date.now() < votingDeadline, "early resolution should not wait for the 15-second timer");
    assert.equal(setup.room.round!.abstainedUids?.size, 0);
    assert.equal(setup.room.phaseEndsAt, undefined);
  } finally {
    setup.manager.dispose();
  }
});

test("strict majority uses only ballots cast for all locked examples", () => {
  {
    const room = directVotingRoom(3);
    const round = room.round!;
    round.votes.set(round.participantUids[0]!, round.impostorUid);
    for (const uid of round.participantUids.slice(1)) round.abstainedUids!.add(uid);
    voting.computeResult(room, { now: () => 1_001 });
    assert.equal(round.groupFound, true, "1 total vote: 1 impostor => caught");
    assert.equal(round.resultRequiredVotes, 1);
  }
  {
    const room = directVotingRoom(3);
    const round = room.round!;
    round.votes.set(round.participantUids[0]!, round.impostorUid);
    round.votes.set(round.participantUids[1]!, round.impostorUid);
    round.abstainedUids!.add(round.participantUids[2]!);
    voting.computeResult(room, { now: () => 1_001 });
    assert.equal(round.groupFound, true, "2 votes: 2 impostor => caught");
  }
  {
    const room = directVotingRoom(3);
    const round = room.round!;
    const normalTarget = round.participantUids.find((uid) => uid !== round.impostorUid)!;
    round.votes.set(round.participantUids[0]!, round.impostorUid);
    round.votes.set(round.participantUids[1]!, normalTarget);
    round.abstainedUids!.add(round.participantUids[2]!);
    voting.computeResult(room, { now: () => 1_001 });
    assert.equal(round.groupFound, false, "2 votes split 1-1 => survives");
  }
  {
    const room = directVotingRoom(3);
    const round = room.round!;
    const normalTarget = round.participantUids.find((uid) => uid !== round.impostorUid)!;
    round.votes.set(round.participantUids[0]!, round.impostorUid);
    round.votes.set(round.participantUids[1]!, round.impostorUid);
    round.votes.set(round.participantUids[2]!, normalTarget);
    voting.computeResult(room, { now: () => 1_001 });
    assert.equal(round.groupFound, true, "3 votes: 2 impostor => caught");
  }
  {
    const room = directVotingRoom(10);
    const round = room.round!;
    round.votes.set(round.participantUids[0]!, round.impostorUid);
    for (const uid of round.participantUids.slice(1)) round.abstainedUids!.add(uid);
    voting.computeResult(room, { now: () => 1_001 });
    assert.equal(round.groupFound, true, "10 participants: one cast vote on impostor => caught");
  }
  {
    const room = settleDirect(3, []);
    assert.equal(room.round!.groupFound, false, "zero votes => survives");
    assert.equal(room.round!.resultRequiredVotes, 0);
  }
});

test("voting timeout records aggregate abstentions and one cast vote can catch among ten participants", async () => {
  const setup = setupManager(10, { votingMs: 35, fullResultMs: 300 });
  try {
    await readyToVoting(setup);
    const impostor = setup.players.find((player) => player.uid === setup.room.round!.impostorUid)!;
    const voter = setup.players.find((player) => player.uid !== impostor.uid)!;
    setup.manager.handle(voter.conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
    await waitForPhase(setup.room, "RESULT");

    const round = setup.room.round!;
    assert.equal(round.groupFound, true);
    assert.equal(round.sealedVotes?.size, 1);
    assert.equal(round.abstainedUids?.size, 9);
    assert.equal(round.resultRequiredVotes, 1);

    const view = lastMessage(setup.host.socket, "STATE")!.view;
    assert.equal(view.result?.votesCast, 1);
    assert.equal(view.result?.participantCount, 10);
    assert.equal(JSON.stringify(view).includes("abstainedUids"), false);

    const completed = setup.events.find((entry) => entry.event === "challenge_completed")!;
    assert.equal(completed.props.participantCount, 10);
    assert.equal(completed.props.votesCast, 1);
    assert.equal(completed.props.abstentionCount, 9);
    assert.equal(completed.props.timedOut, true);
    assert.equal(completed.props.maxVotesOnOneTarget, 1);
    assert.equal(completed.props.impostorVotes, 1);
    assert.equal(completed.props.impostorVoted, false);
    assert.equal(completed.props.singleVoteCatch, true);
    assert.equal(completed.props.challengeIndex, 1);
    assert.equal(completed.props.caught, true);
    assert.equal(completed.props.rulesVersion, ANALYTICS_RULES_VERSION);
    for (const player of setup.players) {
      assert.equal(JSON.stringify(completed.props).includes(player.uid), false);
      assert.equal(JSON.stringify(completed.props).includes(`لاعب`), false);
    }
  } finally {
    setup.manager.dispose();
  }
});

test("survived result stays private and stable until the host advances", async () => {
  const setup = setupManager(3, { votingMs: 20, survivedTransitionMs: 25, fullResultMs: 300 });
  try {
    await readyToVoting(setup);
    const impostorUid = setup.room.round!.impostorUid;
    await waitForPhase(setup.room, "RESULT");
    const resultRound = setup.room.round!;
    assert.equal(resultRound.groupFound, false);
    assert.equal(resultRound.roundComplete, false);
    assert.equal(resultRound.abstainedUids?.size, 3);
    assert.equal(resultRound.resultRequiredVotes, 0);

    const view = lastMessage(setup.host.socket, "STATE")!.view;
    assert.equal(view.result?.roundComplete, false);
    assert.equal(view.result?.impostorUid, undefined);
    assert.equal(view.result?.impostorName, undefined);
    assert.equal(view.result?.requiredVotes, undefined);
    assert.equal(view.result?.votesCast, undefined);
    assert.equal(view.result?.participantCount, undefined);
    assert.equal(view.result?.voteTally, undefined);
    assert.equal(JSON.stringify(view.result).includes("voteTally"), false);
    assert.equal(view.scoreboard, undefined);
    assert.equal(view.room.phaseEndsAt, undefined);

    await wait(60);
    assert.equal(setup.room.phase, "RESULT");
    setup.manager.handle(setup.host.conn, { t: "NEXT_ROUND" });
    assert.equal(setup.room.phase, "QUESTION");
    assert.equal(setup.room.round!.challengeIndex, 2);
    assert.equal(setup.room.round!.impostorUid, impostorUid);
  } finally {
    setup.manager.dispose();
  }
});

test("full reveal stays stable until the host explicitly advances", async () => {
  const setup = setupManager(3, { votingMs: 100, fullResultMs: 30 });
  try {
    await readyToVoting(setup);
    const impostor = setup.players.find((player) => player.uid === setup.room.round!.impostorUid)!;
    const normals = setup.players.filter((player) => player.uid !== impostor.uid);
    for (const normal of normals) setup.manager.handle(normal.conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
    setup.manager.handle(impostor.conn, { t: "SUBMIT_VOTE", targetUid: normals[0]!.uid });
    assert.equal(setup.room.phase, "RESULT");
    assert.equal(setup.room.round!.roundComplete, true);
    assert.equal(setup.room.phaseEndsAt, undefined);
    await wait(60);
    assert.equal(setup.room.phase, "RESULT");
    setup.manager.handle(setup.host.conn, { t: "NEXT_ROUND" });
    assert.equal(setup.room.phase, "QUESTION");
    assert.equal(setup.room.currentRound, 2);
  } finally {
    setup.manager.dispose();
  }
});

test("missing vote and wrong vote both break an existing correct-vote streak", () => {
  for (const secondChallenge of ["missing", "wrong"] as const) {
    const room = directVotingRoom(4);
    const targetNormal = room.round!.participantUids.find((uid) => uid !== room.round!.impostorUid)!;
    const otherNormals = room.round!.participantUids.filter((uid) => uid !== room.round!.impostorUid && uid !== targetNormal);
    const impostor = room.round!.impostorUid;

    room.round!.votes.set(targetNormal, impostor);
    room.round!.votes.set(otherNormals[0]!, otherNormals[1]!);
    room.round!.votes.set(otherNormals[1]!, otherNormals[0]!);
    room.round!.votes.set(impostor, targetNormal);
    voting.computeResult(room, { now: () => 1_001 });
    assert.equal(room.round!.roundComplete, false);
    assert.equal(room.correctVoteStreakStart.get(targetNormal), 1);

    engine.nextRound(room, "host", { now: () => 1_002, rng: () => 0 });
    advanceDirectToVoting(room);
    const second = room.round!;
    const wrongTarget = second.participantUids.find((uid) => uid !== targetNormal && uid !== impostor)!;
    if (secondChallenge === "wrong") second.votes.set(targetNormal, wrongTarget);
    else second.abstainedUids!.add(targetNormal);
    for (const uid of second.participantUids) {
      if (uid === targetNormal) continue;
      const candidate = second.participantUids.find((target) => target !== uid && target !== impostor) ?? targetNormal;
      second.votes.set(uid, candidate);
    }
    voting.computeResult(room, { now: () => 2_001 });
    assert.equal(room.correctVoteStreakStart.has(targetNormal), false, `${secondChallenge} must break the streak`);
  }
});

test("host disconnect pauses the new timed phases instead of silently advancing before PR 2", async () => {
  const setup = setupManager(3, { discussionMs: 70, votingMs: 70, hostDisconnectGraceMs: 500 });
  try {
    await readyToDiscussion(setup);
    setup.manager.disconnect(setup.host.conn);
    assert.equal(setup.room.phase, "DISCUSSION");
    assert.equal(setup.room.phaseEndsAt, undefined);
    assert.ok(setup.room.pause?.remainingMs !== undefined);
    await wait(90);
    assert.equal(setup.room.phase, "DISCUSSION");
    authenticatedConnection(setup.manager, setup.host.uid);
    await waitForPhase(setup.room, "VOTING");
  } finally {
    setup.manager.dispose();
  }
});

test("discussion warning audio is emitted once in the last ten seconds", () => {
  const controller = new HostAudioEventController();
  const snapshot = (phase: HostAudioSnapshot["phase"], endsAt?: number, challengeIndex = 1): HostAudioSnapshot => ({
    roomCode: "ABCDE",
    phase,
    currentRound: 1,
    challengeIndex,
    phaseEndsAt: endsAt,
    playerUids: ["p1", "p2", "p3"],
  });
  controller.update(snapshot("DISCUSSION", 12_000));
  assert.deepEqual(controller.observeDiscussionWarning(12_000, 1_000), []);
  assert.deepEqual(controller.observeDiscussionWarning(12_000, 2_001), [{ type: "discussionWarning" }]);
  assert.deepEqual(controller.observeDiscussionWarning(12_000, 3_000), []);
  controller.update(snapshot("VOTING", 20_000));
  controller.update(snapshot("DISCUSSION", 40_000, 2));
  assert.deepEqual(controller.observeDiscussionWarning(40_000, 30_001), [{ type: "discussionWarning" }]);
});

test("new aggregate analytics keys are allowlisted while vote identity remains forbidden", () => {
  const safe = sanitizeAnalyticsProps("challenge_completed", {
    participantCount: 6,
    votesCast: 4,
    abstentionCount: 2,
    timedOut: true,
    maxVotesOnOneTarget: 3,
    impostorVotes: 3,
    impostorVoted: true,
    singleVoteCatch: false,
    challengeIndex: 2,
    caught: true,
    voterUid: "u_should_never_leave",
    targetUid: "u_should_never_leave_either",
  });
  assert.equal(safe.votesCast, 4);
  assert.equal(safe.abstentionCount, 2);
  assert.equal(safe.timedOut, true);
  assert.equal(safe.maxVotesOnOneTarget, 3);
  assert.equal(safe.impostorVoted, true);
  assert.equal(safe.challengeIndex, 2);
  assert.equal("voterUid" in safe, false);
  assert.equal("targetUid" in safe, false);
});

test("client source has no manual START_VOTING action and no live quorum copy", async () => {
  const [host, player, socket] = await Promise.all([
    readFile(new URL("../../client/src/screens/Host.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/screens/Player.tsx", import.meta.url), "utf8"),
    readFile(new URL("../../client/src/net/socket.ts", import.meta.url), "utf8"),
  ]);
  assert.equal(host.includes("actions.startVoting"), false);
  assert.equal(player.includes("requiredVotesText"), false);
  assert.equal(host.includes("requiredVotesText"), false);
  assert.equal(socket.includes("startVoting:"), false);
  assert.ok(host.includes("استعدوا للتصويت"));
  assert.ok(player.includes("استعدوا للتصويت"));
  assert.ok(host.includes("صوّت {progress.submitted} من {progress.total}"));
});

test("no voter-to-target mapping is serialized to host or players", () => {
  const room = directVotingRoom(4);
  const round = room.round!;
  const voter = round.participantUids[0]!;
  const target = round.participantUids[1]!;
  round.votes.set(voter, target);
  for (const uid of round.participantUids.slice(1)) round.abstainedUids!.add(uid);
  voting.computeResult(room, { now: () => 1_001 });
  for (const uid of [room.hostUid, ...round.participantUids]) {
    const wire = JSON.stringify(buildView(room, uid, "https://game.test/join/AUTO1"));
    assert.equal(wire.includes("sealedVotes"), false);
    assert.equal(wire.includes("abstainedUids"), false);
    assert.equal(wire.includes("voterUid"), false);
    assert.equal(wire.includes("targetUid"), false);
  }
});
