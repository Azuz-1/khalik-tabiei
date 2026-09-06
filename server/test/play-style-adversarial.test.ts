import { readFile } from "node:fs/promises";
import { test } from "node:test";
import assert from "node:assert/strict";
import { HostAudioEventController } from "../../client/src/audio/hostAudioEvents.js";
import * as engine from "../src/game/engine.js";
import { RoomManager } from "../src/game/roomManager.js";
import { buildView } from "../src/game/view.js";
import { createRoomState, type InternalPlayer, type RoomState } from "../src/game/state.js";
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
    uid: `adv${index}`,
    name: `خصم${index}`,
    normalizedName: `خصم${index}`,
    score: 0,
    connected: true,
    joinedAt: index,
    lastSeen: index,
    disconnectGeneration: 0,
    isHost: false,
  };
  room.players.set(player.uid, player);
  return player;
}

function directRoom(count = 3, rounds = 3): RoomState {
  const room = createRoomState("ADV01", "host", 1_000);
  for (let index = 1; index <= count; index += 1) addPlayer(room, index);
  room.totalRounds = rounds;
  room.playStyle = "INDIVIDUAL";
  return room;
}

function toVoting(room: RoomState): void {
  for (const uid of room.round!.participantUids) engine.markReady(room, uid, deps);
  engine.startCountdown(room, 2_000, deps);
  engine.toAction(room, 2_100, deps);
  engine.toHold(room, 2_200, deps);
  engine.revealPrompt(room, 2_300, deps);
  engine.toDiscussion(room, deps);
  engine.startVoting(room, "host", deps);
}

function catchCurrentRound(room: RoomState): void {
  toVoting(room);
  const round = room.round!;
  const impostor = round.impostorUid;
  const normals = round.participantUids.filter((uid) => uid !== impostor);

  for (const normal of normals) engine.submitVote(room, normal, impostor, deps);
  engine.submitVote(room, impostor, normals[0], deps);
  engine.computeResult(room, deps);

  assert.equal(room.phase, "RESULT");
  assert.equal(room.round?.groupFound, true);
  assert.equal(room.round?.roundComplete, true);
}

async function waitForPhase(room: { phase: string }, phase: string): Promise<void> {
  const deadline = Date.now() + 500;
  while (room.phase !== phase && Date.now() < deadline) await wait(2);
  assert.equal(room.phase, phase);
}

async function setupManager(count = 3) {
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

async function managerToVoting(
  manager: RoomManager,
  host: ReturnType<typeof createRoom>,
  players: ReturnType<typeof joinPlayer>[],
  room: RoomState,
): Promise<void> {
  for (const player of players) {
    if (room.round?.participantUids.includes(player.uid)) {
      manager.handle(player.conn, { t: "MARK_READY" });
    }
  }
  await waitForPhase(room, "DISCUSSION");
  manager.handle(host.conn, { t: "START_VOTING" });
  assert.equal(room.phase, "VOTING");
}

test("five consecutive INDIVIDUAL games survive rematch without stale score state", () => {
  const room = directRoom(3, 3);

  for (let game = 1; game <= 5; game += 1) {
    engine.startGame(room, "host", deps);
    assert.equal(room.currentRound, 1);
    assert.equal(room.playStyle, "INDIVIDUAL");
    assert.equal(room.pendingRoundScores.size, 0);
    assert.ok([...room.players.values()].every((player) => player.score === 0));

    for (let round = 1; round <= 3; round += 1) {
      assert.equal(room.currentRound, round);
      catchCurrentRound(room);
      const resultView = buildView(room, "host", "http://game/join/ADV01");
      assert.equal(resultView.scoreboard?.length, 3);
      assert.equal(JSON.stringify(resultView).includes("pendingRoundScores"), false);
      engine.nextRound(room, "host", deps);
    }

    assert.equal(room.phase, "GAME_OVER");
    const final = buildView(room, "host", "http://game/join/ADV01");
    assert.equal(final.scoreboard?.length, 3);
    assert.ok(final.scoreboard?.every((row) => row.score === 2));
    assert.ok(final.scoreboard?.every((row) => row.rank === 1));

    engine.rematch(room, "host", deps);
    assert.equal(room.phase, "LOBBY");
    assert.equal(room.playStyle, "INDIVIDUAL");
    assert.equal(room.pendingRoundScores.size, 0);
    assert.equal(room.round, null);
    assert.ok([...room.players.values()].every((player) => player.score === 0));
    assert.equal(buildView(room, "host", "http://game/join/ADV01").scoreboard, undefined);
  }
});

test("transport reconnect after a committed correct vote preserves one ballot and scores once", async () => {
  const { manager, host, players, room } = await setupManager(3);
  await managerToVoting(manager, host, players, room);

  const impostor = players.find((player) => player.uid === room.round!.impostorUid)!;
  const normals = players.filter((player) => player.uid !== impostor.uid);
  const voter = normals[0];

  manager.handle(voter.conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
  assert.equal(room.round!.votes.get(voter.uid), impostor.uid);

  manager.disconnect(voter.conn);
  assert.equal(room.players.get(voter.uid)?.connected, false);
  assert.equal(room.round!.votes.get(voter.uid), impostor.uid, "transport loss keeps committed vote");

  const reconnect = authenticatedConnection(manager, voter.uid);
  const votingView = lastMessage(reconnect.socket, "STATE")!.view;
  assert.equal(votingView.room.phase, "VOTING");
  assert.equal(votingView.myVoteSubmitted, true, "reconnect restores submitted-vote state");

  manager.handle(normals[1].conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
  manager.handle(impostor.conn, { t: "SUBMIT_VOTE", targetUid: normals[0].uid });

  assert.equal(room.phase, "RESULT");
  assert.equal(room.round!.groupFound, true);
  assert.equal(room.players.get(voter.uid)?.score, 1, "reconnect cannot duplicate the +1");
  assert.equal(room.players.get(normals[1].uid)?.score, 1);
  assert.equal(room.players.get(impostor.uid)?.score, 0);
  manager.dispose();
});

test("two live tabs for one player cannot submit two votes or double-score", async () => {
  const { manager, host, players, room } = await setupManager(3);
  await managerToVoting(manager, host, players, room);

  const impostor = players.find((player) => player.uid === room.round!.impostorUid)!;
  const normals = players.filter((player) => player.uid !== impostor.uid);
  const voter = normals[0];
  const secondTab = authenticatedConnection(manager, voter.uid);

  manager.handle(voter.conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
  manager.handle(secondTab.conn, { t: "SUBMIT_VOTE", targetUid: normals[1].uid });
  assert.equal(lastMessage(secondTab.socket, "ERROR")?.code, "VOTE_ALREADY_SUBMITTED");
  assert.equal(room.round!.votes.get(voter.uid), impostor.uid, "first committed ballot wins");

  manager.handle(normals[1].conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
  manager.handle(impostor.conn, { t: "SUBMIT_VOTE", targetUid: normals[1].uid });

  assert.equal(room.phase, "RESULT");
  assert.equal(room.players.get(voter.uid)?.score, 1);
  assert.equal(room.round!.roundScores.get(voter.uid), 1);
  manager.dispose();
});

test("Host reconnect on a completed scored RESULT preserves the exact scoreboard", async () => {
  const { manager, host, players, room } = await setupManager(3);
  await managerToVoting(manager, host, players, room);

  const impostor = players.find((player) => player.uid === room.round!.impostorUid)!;
  const normals = players.filter((player) => player.uid !== impostor.uid);
  manager.handle(normals[0].conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
  manager.handle(normals[1].conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
  manager.handle(impostor.conn, { t: "SUBMIT_VOTE", targetUid: normals[0].uid });
  assert.equal(room.phase, "RESULT");

  const before = lastMessage(host.socket, "STATE")!.view;
  const scoreboardBefore = JSON.stringify(before.scoreboard);
  const scoresBefore = [...room.players.values()].map((player) => [player.uid, player.score]);
  const round = room.round;

  manager.disconnect(host.conn);
  assert.equal(room.hostConnected, false);
  const reconnect = authenticatedConnection(manager, host.uid);
  const after = lastMessage(reconnect.socket, "STATE")!.view;

  assert.equal(room.hostConnected, true);
  assert.equal(room.round, round);
  assert.equal(room.phase, "RESULT");
  assert.equal(JSON.stringify(after.scoreboard), scoreboardBefore);
  assert.deepEqual(
    [...room.players.values()].map((player) => [player.uid, player.score]),
    scoresBefore,
  );
  assert.equal(room.pendingRoundScores.size, 0);
  manager.dispose();
});

test("impostor leaving after hidden Challenge points aborts to a clean Lobby", async () => {
  const { manager, host, players, room } = await setupManager(4);
  await managerToVoting(manager, host, players, room);

  const impostor = players.find((player) => player.uid === room.round!.impostorUid)!;
  const normals = players.filter((player) => player.uid !== impostor.uid);

  // Two correct guesses are below the four-player majority of three, so the
  // points become hidden pending state and the same impostor should continue.
  manager.handle(normals[0].conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
  manager.handle(normals[1].conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
  manager.handle(normals[2].conn, { t: "SUBMIT_VOTE", targetUid: normals[0].uid });
  manager.handle(impostor.conn, { t: "SUBMIT_VOTE", targetUid: normals[1].uid });

  assert.equal(room.phase, "RESULT");
  assert.equal(room.round!.roundComplete, false);
  assert.equal(room.pendingRoundScores.size, 2);
  assert.ok([...room.players.values()].every((player) => player.score === 0));

  manager.handle(host.conn, { t: "NEXT_ROUND" });
  assert.equal(room.phase, "QUESTION");
  assert.equal(room.round!.challengeIndex, 2);
  assert.equal(room.round!.impostorUid, impostor.uid);

  manager.handle(impostor.conn, { t: "LEAVE_ROOM" });
  assert.equal(room.phase, "LOBBY");
  assert.equal(room.round, null);
  assert.equal(room.currentRound, 0);
  assert.equal(room.playStyle, "INDIVIDUAL");
  assert.equal(room.pendingRoundScores.size, 0);
  assert.ok([...room.players.values()].every((player) => player.score === 0));
  assert.equal(lastMessage(host.socket, "STATE")!.view.scoreboard, undefined);
  manager.dispose();
});

test("seat reconnecting after a new Round started stays TV-directed instead of rendering invalid actions", async () => {
  const { manager, host, players, room } = await setupManager(4);
  await managerToVoting(manager, host, players, room);

  const impostor = players.find((player) => player.uid === room.round!.impostorUid)!;
  const normals = players.filter((player) => player.uid !== impostor.uid);
  for (const normal of normals) {
    manager.handle(normal.conn, { t: "SUBMIT_VOTE", targetUid: impostor.uid });
  }
  manager.handle(impostor.conn, { t: "SUBMIT_VOTE", targetUid: normals[0].uid });
  assert.equal(room.phase, "RESULT");
  assert.equal(room.round!.roundComplete, true);

  const sidelined = normals.at(-1)!;
  manager.disconnect(sidelined.conn);
  assert.equal(room.players.get(sidelined.uid)?.connected, false);

  manager.handle(host.conn, { t: "NEXT_ROUND" });
  assert.equal(room.phase, "QUESTION");
  assert.equal(room.currentRound, 2);
  assert.equal(room.round!.participantUids.includes(sidelined.uid), false);

  const reconnect = authenticatedConnection(manager, sidelined.uid);
  let view = lastMessage(reconnect.socket, "STATE")!.view;
  assert.equal(view.room.phase, "QUESTION");
  assert.equal(view.self.connected, true);
  assert.equal(view.myReady, undefined);
  assert.equal(view.isImpostor, undefined);
  assert.equal(view.myPrompt, undefined);

  // The server remains authoritative and rejects a forged Ready from a seat
  // that is not participating in this Round.
  manager.handle(reconnect.conn, { t: "MARK_READY" });
  assert.equal(lastMessage(reconnect.socket, "ERROR")?.code, "NOT_PLAYER");

  const roundPlayers = players.filter((player) => room.round!.participantUids.includes(player.uid));
  for (const player of roundPlayers) manager.handle(player.conn, { t: "MARK_READY" });
  await waitForPhase(room, "DISCUSSION");
  manager.handle(host.conn, { t: "START_VOTING" });
  view = lastMessage(reconnect.socket, "STATE")!.view;
  assert.equal(view.room.phase, "VOTING");
  assert.equal(view.voteTargets, undefined);
  assert.equal(view.myVoteSubmitted, undefined);

  const playerSource = await readFile(
    new URL("../../client/src/screens/Player.tsx", import.meta.url),
    "utf8",
  );
  assert.ok(
    playerSource.includes("if (view.myReady === undefined) return <PlayerWatchScreen />;"),
    "non-participant QUESTION must stay on the TV-directed screen",
  );
  assert.ok(
    playerSource.includes("view.voteTargets === undefined && view.myVoteSubmitted === undefined"),
    "non-participant VOTING must not render an empty ballot",
  );
  manager.dispose();
});

test("switching from an INDIVIDUAL game to TEAM after rematch cannot leak old scores", () => {
  const room = directRoom(3, 1);
  engine.startGame(room, "host", deps);
  catchCurrentRound(room);
  assert.ok(buildView(room, "host", "http://game/join/ADV01").scoreboard);
  engine.nextRound(room, "host", deps);
  assert.equal(room.phase, "GAME_OVER");

  engine.rematch(room, "host", deps);
  engine.setSettings(room, "host", { playStyle: "TEAM" }, deps);
  engine.startGame(room, "host", deps);
  catchCurrentRound(room);

  assert.equal(room.playStyle, "TEAM");
  assert.ok([...room.players.values()].every((player) => player.score === 0));
  assert.equal(room.pendingRoundScores.size, 0);
  assert.equal(room.round!.roundScores.size, 0);
  assert.equal(buildView(room, "host", "http://game/join/ADV01").scoreboard, undefined);
});

test("INDIVIDUAL score rerenders and Host reconnect into RESULT do not replay result audio", () => {
  const controller = new HostAudioEventController();
  const voting = {
    roomCode: "ADV01",
    phase: "VOTING" as const,
    currentRound: 1,
    challengeIndex: 1,
    submittedVotes: 2,
    totalVotes: 3,
    playerUids: ["a", "b", "c"],
  };
  const result = {
    roomCode: "ADV01",
    phase: "RESULT" as const,
    currentRound: 1,
    challengeIndex: 1,
    playerUids: ["a", "b", "c"],
    result: { groupFound: true, roundComplete: true, challengeIndex: 1 },
  };

  assert.deepEqual(controller.update(voting), []);
  assert.deepEqual(controller.update(result), [
    { type: "voteReceived", count: 1 },
    { type: "caught" },
  ]);
  assert.deepEqual(controller.update(result), [], "scoreboard-only RESULT rerenders stay silent");

  const reconnectController = new HostAudioEventController();
  assert.deepEqual(
    reconnectController.update(result),
    [],
    "refresh/reconnect primes historical RESULT without replaying the caught sting",
  );
});
