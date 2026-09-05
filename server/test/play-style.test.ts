import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { SCORING } from "../../shared/constants.js";
import * as engine from "../src/game/engine.js";
import { RoomManager } from "../src/game/roomManager.js";
import { createRoomState, type InternalPlayer, type RoomState } from "../src/game/state.js";
import { buildView } from "../src/game/view.js";
import {
  authenticatedConnection,
  createRoom,
  joinPlayer,
  lastMessage,
  wait,
} from "./helpers.js";

const deps = { rng: () => 0, now: () => 1_000 };

function addPlayer(room: RoomState, index: number): InternalPlayer {
  const player: InternalPlayer = {
    uid: `p${index}`,
    name: `لاعب${index}`,
    normalizedName: `لاعب${index}`,
    score: 0,
    connected: true,
    joinedAt: 1,
    lastSeen: 1,
    disconnectGeneration: 0,
    isHost: false,
  };
  room.players.set(player.uid, player);
  return player;
}

function roomWith(count = 4): RoomState {
  const room = createRoomState("ABCDE", "host", 1_000);
  for (let index = 1; index <= count; index += 1) addPlayer(room, index);
  room.totalRounds = 3;
  return room;
}

function toVoting(room: RoomState): void {
  for (const uid of room.round!.participantUids) engine.markReady(room, uid, deps);
  engine.startCountdown(room, 6_000, deps);
  engine.toAction(room, 2_000, deps);
  engine.toHold(room, 3_000, deps);
  engine.revealPrompt(room, 3_500, deps);
  engine.toDiscussion(room, deps);
  engine.startVoting(room, "host", deps);
}

function submitVotes(room: RoomState, targets: Record<string, string>): void {
  for (const voterUid of room.round!.participantUids) {
    engine.submitVote(room, voterUid, targets[voterUid], deps);
  }
  engine.computeResult(room, deps);
}

function assertNoScoreLeak(view: ReturnType<typeof buildView>): void {
  assert.equal(view.scoreboard, undefined);
  const json = JSON.stringify(view);
  assert.equal(json.includes("roundDelta"), false);
  assert.equal(json.includes("pendingRoundScores"), false);
}

function assertNoVoteMapping(view: ReturnType<typeof buildView>): void {
  const json = JSON.stringify(view);
  assert.equal(json.includes("voterUid"), false);
  assert.equal(json.includes("voterName"), false);
  assert.equal(json.includes("targetUid"), false);
  assert.equal(json.includes("voteBreakdown"), false);
}

test("TEAM remains the default and stays completely score-free", () => {
  const room = roomWith(3);
  assert.equal(room.playStyle, "TEAM");
  engine.startGame(room, "host", deps);
  toVoting(room);

  const round = room.round!;
  const impostor = round.impostorUid;
  const normals = round.participantUids.filter((uid) => uid !== impostor);
  submitVotes(room, {
    [normals[0]]: impostor,
    [normals[1]]: impostor,
    [impostor]: normals[0],
  });

  assert.equal(round.groupFound, true);
  assert.ok([...room.players.values()].every((player) => player.score === 0));
  assert.equal(room.pendingRoundScores.size, 0);
  assert.equal(round.roundScores.size, 0);
  const view = buildView(room, "host", "http://game/join/ABCDE");
  assert.equal(view.scoreboard, undefined);
  assert.equal(JSON.stringify(view).includes("roundDelta"), false);
});

test("INDIVIDUAL is a Lobby-only setting", () => {
  const room = roomWith();
  engine.setSettings(room, "host", { playStyle: "INDIVIDUAL" }, deps);
  assert.equal(room.playStyle, "INDIVIDUAL");
  engine.startGame(room, "host", deps);
  assert.throws(
    () => engine.setSettings(room, "host", { playStyle: "TEAM" }, deps),
    /INVALID_PHASE/,
  );
});

test("INDIVIDUAL correct normal vote is +1 and caught impostor gets no survival points", () => {
  const room = roomWith(4);
  engine.setSettings(room, "host", { playStyle: "INDIVIDUAL" }, deps);
  engine.startGame(room, "host", deps);
  toVoting(room);

  const round = room.round!;
  const impostor = round.impostorUid;
  const normals = round.participantUids.filter((uid) => uid !== impostor);
  submitVotes(room, {
    [normals[0]]: impostor,
    [normals[1]]: impostor,
    [normals[2]]: impostor,
    [impostor]: normals[0],
  });

  assert.equal(round.groupFound, true);
  assert.equal(round.roundComplete, true);
  for (const uid of normals) assert.equal(room.players.get(uid)?.score, SCORING.POINT_CORRECT_VOTE);
  assert.equal(room.players.get(impostor)?.score, 0);
  assert.equal(round.roundScores.get(impostor) ?? 0, 0);

  const scoreboard = buildView(room, "host", "http://game/join/ABCDE").scoreboard;
  assert.ok(scoreboard);
  assert.equal(scoreboard.filter((row) => row.roundDelta === 1).length, normals.length);
});

test("wrong normal vote is worth zero while correct points remain server-only mid-round", () => {
  const room = roomWith(4);
  engine.setSettings(room, "host", { playStyle: "INDIVIDUAL" }, deps);
  engine.startGame(room, "host", deps);
  toVoting(room);

  const round = room.round!;
  const impostor = round.impostorUid;
  const normals = round.participantUids.filter((uid) => uid !== impostor);
  submitVotes(room, {
    [normals[0]]: impostor,
    [normals[1]]: impostor,
    [normals[2]]: normals[0],
    [impostor]: normals[0],
  });

  assert.equal(round.groupFound, false);
  assert.equal(round.roundComplete, false);
  assert.equal(room.pendingRoundScores.get(normals[0]), 1);
  assert.equal(room.pendingRoundScores.get(normals[1]), 1);
  assert.equal(room.pendingRoundScores.get(normals[2]) ?? 0, 0);
  assert.ok([...room.players.values()].every((player) => player.score === 0));

  for (const uid of ["host", ...round.participantUids]) {
    assertNoScoreLeak(buildView(room, uid, "http://game/join/ABCDE"));
  }
});

test("Challenge 1/2 scores stay hidden and completed Round reveals accumulated deltas", () => {
  const room = roomWith(3);
  engine.setSettings(room, "host", { playStyle: "INDIVIDUAL" }, deps);
  engine.startGame(room, "host", deps);
  const impostor = room.round!.impostorUid;
  const normals = room.round!.participantUids.filter((uid) => uid !== impostor);

  for (let challenge = 1; challenge <= 2; challenge += 1) {
    toVoting(room);
    const currentNormals = room.round!.participantUids.filter((uid) => uid !== impostor);
    submitVotes(room, {
      [currentNormals[0]]: impostor,
      [currentNormals[1]]: currentNormals[0],
      [impostor]: currentNormals[1],
    });

    assert.equal(room.round?.roundComplete, false);
    assert.equal(room.players.get(currentNormals[0])?.score, 0);
    for (const uid of ["host", ...room.round!.participantUids]) {
      assertNoScoreLeak(buildView(room, uid, "http://game/join/ABCDE"));
    }
    engine.nextRound(room, "host", deps);
    assert.equal(room.round?.impostorUid, impostor);
  }

  toVoting(room);
  const finalNormals = room.round!.participantUids.filter((uid) => uid !== impostor);
  submitVotes(room, {
    [finalNormals[0]]: impostor,
    [finalNormals[1]]: finalNormals[0],
    [impostor]: finalNormals[1],
  });

  assert.equal(room.round?.roundComplete, true);
  assert.equal(room.round?.groupFound, false);
  const scoreboard = buildView(room, "host", "http://game/join/ABCDE").scoreboard;
  assert.ok(scoreboard);
  assert.equal(scoreboard.find((row) => row.uid === normals[0])?.roundDelta, 3);
});

test("INDIVIDUAL awards impostor +2 only after surviving the complete Round", () => {
  const room = roomWith(3);
  engine.setSettings(room, "host", { playStyle: "INDIVIDUAL" }, deps);
  engine.startGame(room, "host", deps);
  const impostor = room.round!.impostorUid;

  for (let challenge = 1; challenge <= 3; challenge += 1) {
    toVoting(room);
    const normals = room.round!.participantUids.filter((uid) => uid !== impostor);
    submitVotes(room, {
      [normals[0]]: normals[1],
      [normals[1]]: normals[0],
      [impostor]: normals[0],
    });

    if (challenge < 3) {
      assert.equal(room.round?.roundComplete, false);
      assert.equal(room.players.get(impostor)?.score, 0);
      assertNoScoreLeak(buildView(room, "host", "http://game/join/ABCDE"));
      engine.nextRound(room, "host", deps);
    }
  }

  assert.equal(room.round?.roundComplete, true);
  assert.equal(room.round?.groupFound, false);
  assert.equal(room.players.get(impostor)?.score, SCORING.POINT_IMPOSTOR_SURVIVES);
  assert.equal(room.round?.roundScores.get(impostor), SCORING.POINT_IMPOSTOR_SURVIVES);
});

test("GAME_OVER exposes final ranking with shared ranks for ties and no vote mapping", () => {
  const room = roomWith(3);
  room.totalRounds = 1;
  engine.setSettings(room, "host", { playStyle: "INDIVIDUAL" }, deps);
  engine.startGame(room, "host", deps);
  toVoting(room);

  const impostor = room.round!.impostorUid;
  const normals = room.round!.participantUids.filter((uid) => uid !== impostor);
  submitVotes(room, {
    [normals[0]]: impostor,
    [normals[1]]: impostor,
    [impostor]: normals[0],
  });
  engine.nextRound(room, "host", deps);
  assert.equal(room.phase, "GAME_OVER");

  const view = buildView(room, "host", "http://game/join/ABCDE");
  assert.ok(view.scoreboard);
  const normalRows = view.scoreboard.filter((row) => normals.includes(row.uid));
  assert.equal(normalRows.length, 2);
  assert.equal(normalRows[0].score, 1);
  assert.equal(normalRows[1].score, 1);
  assert.equal(normalRows[0].rank, normalRows[1].rank, "equal scores share rank");
  assertNoVoteMapping(view);
});

test("rematch keeps INDIVIDUAL setting but resets totals, pending scores, and round deltas", () => {
  const room = roomWith(3);
  room.playStyle = "INDIVIDUAL";
  room.phase = "GAME_OVER";
  room.players.get("p1")!.score = 4;
  room.players.get("p2")!.score = 2;
  room.pendingRoundScores.set("p1", 1);
  room.round = {
    kind: "IMITATION",
    index: 3,
    impostorUid: "p3",
    participantUids: ["p1", "p2", "p3"],
    challengeIndex: 3,
    mode: "HANDS",
    promptId: "H01",
    prompt: "x",
    readyUids: new Set(),
    roundComplete: true,
    pairId: "",
    category: "general",
    normalQuestion: "",
    impostorQuestion: "",
    answers: new Map(),
    votes: new Map(),
    resultComputed: true,
    groupFound: false,
    roundScores: new Map([["p1", 1]]),
  };

  engine.rematch(room, "host", deps);

  assert.equal(room.phase, "LOBBY");
  assert.equal(room.playStyle, "INDIVIDUAL");
  assert.equal(room.pendingRoundScores.size, 0);
  assert.equal(room.round, null);
  assert.ok([...room.players.values()].every((player) => player.score === 0));
  assert.equal(buildView(room, "host", "http://game/join/ABCDE").scoreboard, undefined);
});

async function setupIndividualManager(count = 4) {
  const manager = new RoomManager({
    rng: () => 0,
    hostDisconnectGraceMs: 100,
    countdownMs: 2,
    actionMs: 2,
    holdMs: 2,
    promptRevealMs: 2,
  });
  const host = createRoom(manager);
  const players = Array.from({ length: count }, (_, index) =>
    joinPlayer(manager, host.code, index + 2),
  );
  const room = manager.roomForTests(host.code)!;
  manager.handle(host.conn, {
    t: "SET_SETTINGS",
    totalRounds: 3,
    selectedModes: ["HANDS", "POINT", "NUMBER"],
    playStyle: "INDIVIDUAL",
  });
  manager.handle(host.conn, { t: "START_GAME" });
  return { manager, host, players, room };
}

test("player reconnect and Host reconnect preserve INDIVIDUAL scoring state", async () => {
  const { manager, host, players, room } = await setupIndividualManager(3);
  const player = players[0];
  room.players.get(player.uid)!.score = 3;
  room.pendingRoundScores.set(player.uid, 1);
  const round = room.round;
  const impostorUid = room.round!.impostorUid;
  const challengeIndex = room.round!.challengeIndex;

  manager.disconnect(player.conn);
  const playerReconnect = authenticatedConnection(manager, player.uid);
  assert.equal(room.players.get(player.uid)?.score, 3);
  assert.equal(room.pendingRoundScores.get(player.uid), 1);
  assert.equal(room.playStyle, "INDIVIDUAL");
  assert.equal(lastMessage(playerReconnect.socket, "STATE")?.view.room.playStyle, "INDIVIDUAL");

  manager.disconnect(host.conn);
  assert.equal(room.hostConnected, false);
  const hostReconnect = authenticatedConnection(manager, host.uid);
  assert.equal(room.hostConnected, true);
  assert.equal(room.playStyle, "INDIVIDUAL");
  assert.equal(room.players.get(player.uid)?.score, 3);
  assert.equal(room.pendingRoundScores.get(player.uid), 1);
  assert.equal(room.round, round);
  assert.equal(room.round?.impostorUid, impostorUid);
  assert.equal(room.round?.challengeIndex, challengeIndex);
  assert.equal(lastMessage(hostReconnect.socket, "STATE")?.view.room.playStyle, "INDIVIDUAL");

  manager.dispose();
});

test("kicking a missing normal preserves committed ballots and never creates a ghost score row", async () => {
  const { manager, host, players, room } = await setupIndividualManager(4);
  for (const player of players) manager.handle(player.conn, { t: "MARK_READY" });
  const deadline = Date.now() + 200;
  while (room.phase !== "DISCUSSION" && Date.now() < deadline) await wait(2);
  assert.equal(room.phase, "DISCUSSION");
  manager.handle(host.conn, { t: "START_VOTING" });

  const impostor = players.find((player) => player.uid === room.round!.impostorUid)!;
  const normals = players.filter((player) => player.uid !== impostor.uid);
  const missing = normals.at(-1)!;
  const remainingNormals = normals.filter((player) => player.uid !== missing.uid);

  manager.handle(impostor.conn, { t: "SUBMIT_VOTE", targetUid: missing.uid });
  manager.handle(remainingNormals[0].conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
  manager.handle(remainingNormals[1].conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
  assert.equal(room.round!.votes.get(impostor.uid), missing.uid);

  manager.handle(host.conn, { t: "KICK_PLAYER", uid: missing.uid });

  assert.equal(room.phase, "RESULT");
  assert.equal(room.round!.votes.get(impostor.uid), missing.uid, "wasted target remains committed");
  assert.equal(room.round!.groupFound, true, "3-player majority recalculates to two");
  assert.equal(room.players.has(missing.uid), false);
  assert.equal(room.pendingRoundScores.has(missing.uid), false);
  for (const normal of remainingNormals) assert.equal(room.players.get(normal.uid)?.score, 1);
  assert.equal(room.players.get(impostor.uid)?.score, 0);

  const view = lastMessage(host.socket, "STATE")!.view;
  assert.ok(view.scoreboard);
  assert.equal(view.scoreboard.some((row) => row.uid === missing.uid), false);
  assert.equal(view.result?.voteTally.some((row) => row.uid === missing.uid), false);
  assertNoVoteMapping(view);
  manager.dispose();
});

test("scoring UI uses authoritative challenge max and hides zero-vote majority copy", async () => {
  const host = await readFile(new URL("../../client/src/screens/Host.tsx", import.meta.url), "utf8");
  const player = await readFile(new URL("../../client/src/screens/Player.tsx", import.meta.url), "utf8");

  assert.ok(host.includes("result.maxChallenges"));
  assert.equal(host.includes("challengeIndex ?? 1) + 1, 3"), false);
  assert.ok(host.includes("progress.requiredVotes > 0"));
  assert.ok(player.includes("progress.requiredVotes > 0"));
  assert.ok(player.includes("طالع الشاشة"));
  assert.equal(player.includes("مغادرة الغرفة"), false, "PR #15 single-owner exit stays intact");
});
