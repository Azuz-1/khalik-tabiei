import test from "node:test";
import assert from "node:assert/strict";
import type { GameMode } from "../../shared/types.js";
import * as engine from "../src/game/engine.js";
import { RoomManager } from "../src/game/roomManager.js";
import { authenticatedConnection, createRoom, joinPlayer, lastMessage } from "./helpers.js";

const TARGETS = [3, 6, 9, 12] as const;
const PLAYER_COUNTS = [3, 4, 5, 6, 7, 8, 9, 10] as const;
const MODE_SETS: readonly GameMode[][] = [
  ["HANDS"],
  ["POINT"],
  ["NUMBER"],
  ["HANDS", "POINT"],
  ["HANDS", "NUMBER"],
  ["POINT", "NUMBER"],
  ["HANDS", "POINT", "NUMBER"],
];
const OUTCOME_PATTERNS: readonly (readonly Outcome[])[] = [
  ["catch"],
  ["survive"],
  ["survive", "catch"],
  ["catch", "survive"],
  ["survive", "survive", "catch"],
  ["catch", "survive", "survive"],
];

type Outcome = "catch" | "survive";

function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 0x1_0000_0000;
  };
}

function errorCodes(socket: { messages: Array<{ t: string; code?: string }> }): string[] {
  return socket.messages.filter((message) => message.t === "ERROR").map((message) => message.code ?? "");
}

function advanceToDiscussion(room: NonNullable<ReturnType<RoomManager["roomForTests"]>>, now: () => number): void {
  const deps = { rng: () => 0.5, now };
  engine.startCountdown(room, now() + 1, deps);
  engine.toAction(room, now() + 1, deps);
  engine.toHold(room, now() + 1, deps);
  engine.revealPrompt(room, now() + 1, deps);
  engine.toDiscussion(room, deps);
}

function voteTargetForSurvival(voterUid: string, impostorUid: string, participantUids: string[]): string {
  const normal = participantUids.find((uid) => uid !== voterUid && uid !== impostorUid);
  if (normal) return normal;
  const fallback = participantUids.find((uid) => uid !== voterUid);
  if (!fallback) throw new Error("no legal vote target");
  return fallback;
}

function resolveChallenge(
  manager: RoomManager,
  host: ReturnType<typeof createRoom>,
  players: ReturnType<typeof joinPlayer>[],
  outcome: Outcome,
  now: () => number,
): { promptId: string; challengeIndex: number; roundComplete: boolean; caught: boolean } {
  const room = manager.roomForTests(host.code)!;
  assert.equal(room.phase, "QUESTION");
  assert.equal(room.round?.kind, "IMITATION");
  const round = room.round!;
  const promptId = round.promptId;
  const challengeIndex = round.challengeIndex;
  const impostorUid = round.impostorUid;
  const participantUids = [...round.participantUids];

  advanceToDiscussion(room, now);
  assert.equal(manager.handle(host.conn, { t: "START_VOTING" }), true);
  assert.equal(room.phase, "VOTING");
  assert.equal(engine.requiredVotesFor(participantUids.length), Math.floor(participantUids.length / 2) + 1);

  for (const player of players) {
    const targetUid = outcome === "catch" && player.uid !== impostorUid
      ? impostorUid
      : voteTargetForSurvival(player.uid, impostorUid, participantUids);
    assert.notEqual(targetUid, player.uid);
    assert.equal(manager.handle(player.conn, { t: "SUBMIT_VOTE", targetUid }), true);
  }

  assert.equal(room.phase, "RESULT");
  assert.equal(room.round?.resultComputed, true);
  assert.equal(room.round?.groupFound, outcome === "catch");
  return {
    promptId,
    challengeIndex,
    roundComplete: room.round!.roundComplete,
    caught: room.round!.groupFound ?? false,
  };
}

test("32-match matrix: every player count 3..10 × exact target 3/6/9/12", () => {
  let scenario = 0;
  let totalChallengesPlayed = 0;

  for (const playerCount of PLAYER_COUNTS) {
    for (const target of TARGETS) {
      scenario += 1;
      let clock = scenario * 1_000_000;
      const now = () => ++clock;
      const modes = MODE_SETS[(scenario - 1) % MODE_SETS.length]!;
      const pattern = OUTCOME_PATTERNS[(scenario - 1) % OUTCOME_PATTERNS.length]!;
      const manager = new RoomManager({ rng: seededRng(0xabc000 + scenario), now });
      const host = createRoom(manager);
      const players = Array.from({ length: playerCount }, (_, index) => joinPlayer(manager, host.code, index + 2));
      const room = manager.roomForTests(host.code)!;

      assert.equal(manager.handle(host.conn, { t: "SET_SETTINGS", totalRounds: target, selectedModes: modes }), true);
      assert.equal(room.targetChallenges, target);
      assert.deepEqual(room.selectedModes, modes);
      assert.equal(manager.handle(host.conn, { t: "START_GAME" }), true);
      assert.equal(room.phase, "QUESTION");
      assert.equal(room.players.size, playerCount);

      const promptIds = new Set<string>();
      const observedModes = new Set<GameMode>();
      let completed = 0;
      let sawCatch = false;
      let sawSurvival = false;

      while (completed < target) {
        assert.equal(room.phase, "QUESTION", `S${scenario}: expected QUESTION before C${completed + 1}`);
        assert.equal(room.round?.participantUids.length, playerCount);
        assert.equal(room.round?.maxChallenges, 3, `S${scenario}: all group sizes use 3-Challenge stint cap`);
        observedModes.add(room.round!.mode);
        assert.ok(modes.includes(room.round!.mode), `S${scenario}: selected-mode contract`);

        const outcome = pattern[completed % pattern.length]!;
        const result = resolveChallenge(manager, host, players, outcome, now);
        completed += 1;
        totalChallengesPlayed += 1;
        promptIds.add(result.promptId);
        sawCatch ||= result.caught;
        sawSurvival ||= !result.caught;

        assert.equal(room.completedChallenges, completed, `S${scenario}: exact progress after C${completed}`);
        assert.ok(result.challengeIndex >= 1 && result.challengeIndex <= 3, `S${scenario}: challenge-in-stint range`);
        if (completed < target) {
          assert.equal(manager.handle(host.conn, { t: "NEXT_ROUND" }), true);
          assert.equal(room.phase, "QUESTION");
        } else {
          assert.equal(result.roundComplete, true, `S${scenario}: final Challenge seals its stint`);
          assert.equal(manager.handle(host.conn, { t: "NEXT_ROUND" }), true);
          assert.equal(room.phase, "GAME_OVER");
        }
      }

      assert.equal(room.completedChallenges, target, `S${scenario}: never overshoots selected target`);
      assert.equal(promptIds.size, target, `S${scenario}: no prompt repeats inside match`);
      assert.equal(room.players.size, playerCount, `S${scenario}: roster stable`);
      assert.ok(observedModes.size >= 1);
      assert.equal(sawCatch, pattern.includes("catch"));
      assert.equal(sawSurvival, pattern.includes("survive"));

      const finalState = lastMessage(host.socket, "STATE")?.view;
      assert.equal(finalState?.room.phase, "GAME_OVER");
      assert.equal(finalState?.gameOver?.targetChallenges, target);
      assert.equal(finalState?.gameOver?.completedChallenges, target);
      assert.equal(finalState?.scoreboard?.length, playerCount);
      assert.ok(finalState?.scoreboard?.every((row) => Number.isInteger(row.score) && row.score >= 0));
      assert.ok(finalState?.scoreboard?.every((row) => Number.isInteger(row.rank) && row.rank >= 1));

      manager.dispose();
    }
  }

  assert.equal(scenario, 32);
  assert.equal(totalChallengesPlayed, PLAYER_COUNTS.length * TARGETS.reduce((sum, target) => sum + target, 0));
});

test("adversarial permissions and invalid-action sequence cannot corrupt a live match", () => {
  let clock = 50_000;
  const now = () => ++clock;
  const manager = new RoomManager({ rng: seededRng(99), now });
  const host = createRoom(manager);
  const players = [2, 3, 4, 5].map((index) => joinPlayer(manager, host.code, index));
  const room = manager.roomForTests(host.code)!;

  assert.equal(manager.handle(players[0]!.conn, { t: "SET_SETTINGS", totalRounds: 3 }), false);
  assert.ok(errorCodes(players[0]!.socket).includes("NOT_HOST"));
  assert.equal(manager.handle(players[0]!.conn, { t: "START_GAME" }), false);
  assert.ok(errorCodes(players[0]!.socket).includes("NOT_HOST"));

  assert.equal(manager.handle(host.conn, { t: "SET_SETTINGS", totalRounds: 3, selectedModes: ["HANDS", "POINT", "NUMBER"] }), true);
  assert.equal(manager.handle(host.conn, { t: "START_GAME" }), true);
  assert.equal(room.phase, "QUESTION");

  const late = joinPlayer(manager, host.code, 20, "متأخر");
  assert.ok(errorCodes(late.socket).includes("ROOM_NOT_IN_LOBBY"));
  assert.equal(room.players.size, 4);

  advanceToDiscussion(room, now);
  assert.equal(manager.handle(players[0]!.conn, { t: "START_VOTING" }), false);
  assert.ok(errorCodes(players[0]!.socket).includes("NOT_HOST"));
  assert.equal(room.phase, "DISCUSSION");
  assert.equal(manager.handle(host.conn, { t: "START_VOTING" }), true);

  assert.equal(manager.handle(players[0]!.conn, { t: "SUBMIT_VOTE", targetUid: players[0]!.uid }), false);
  assert.ok(errorCodes(players[0]!.socket).includes("INVALID_VOTE"));
  assert.equal(room.phase, "VOTING");

  const impostorUid = room.round!.impostorUid;
  const legalTarget = players.find((player) => player.uid !== players[0]!.uid && player.uid !== impostorUid)?.uid
    ?? players.find((player) => player.uid !== players[0]!.uid)!.uid;
  assert.equal(manager.handle(players[0]!.conn, { t: "SUBMIT_VOTE", targetUid: legalTarget }), true);
  assert.equal(manager.handle(players[0]!.conn, { t: "SUBMIT_VOTE", targetUid: legalTarget }), false);
  assert.ok(errorCodes(players[0]!.socket).includes("VOTE_ALREADY_SUBMITTED"));

  assert.equal(manager.handle(players[1]!.conn, { t: "NEXT_ROUND" }), false);
  assert.ok(errorCodes(players[1]!.socket).includes("NOT_HOST"));
  assert.equal(room.phase, "VOTING");

  for (const player of players.slice(1)) {
    const targetUid = player.uid === impostorUid
      ? players.find((candidate) => candidate.uid !== player.uid)!.uid
      : impostorUid;
    assert.equal(manager.handle(player.conn, { t: "SUBMIT_VOTE", targetUid }), true);
  }
  assert.equal(room.phase, "RESULT");
  assert.equal(room.completedChallenges, 1);
  manager.dispose();
});

test("disconnect/reconnect preserves the same seat and active Challenge", () => {
  const manager = new RoomManager({ rng: seededRng(1234) });
  const host = createRoom(manager);
  const players = [2, 3, 4, 5, 6].map((index) => joinPlayer(manager, host.code, index));
  assert.equal(manager.handle(host.conn, { t: "START_GAME" }), true);
  const room = manager.roomForTests(host.code)!;
  const reconnecting = players[2]!;
  const originalSeat = room.players.get(reconnecting.uid)?.seatNumber;
  const originalImpostor = room.round?.impostorUid;
  const originalPrompt = room.round?.promptId;

  manager.disconnect(reconnecting.conn);
  assert.equal(room.players.get(reconnecting.uid)?.connected, false);
  const restored = authenticatedConnection(manager, reconnecting.uid);
  assert.equal(room.players.get(reconnecting.uid)?.connected, true);
  assert.equal(room.players.get(reconnecting.uid)?.seatNumber, originalSeat);
  assert.equal(room.round?.impostorUid, originalImpostor);
  assert.equal(room.round?.promptId, originalPrompt);
  assert.ok(room.round?.participantUids.includes(reconnecting.uid));
  assert.equal(lastMessage(restored.socket, "STATE")?.view.self.uid, reconnecting.uid);
  manager.dispose();
});

test("rematch resets progress and scores but preserves selected Challenge total", () => {
  let clock = 90_000;
  const now = () => ++clock;
  const manager = new RoomManager({ rng: seededRng(7), now });
  const host = createRoom(manager);
  const players = [2, 3, 4].map((index) => joinPlayer(manager, host.code, index));
  const room = manager.roomForTests(host.code)!;
  assert.equal(manager.handle(host.conn, { t: "SET_SETTINGS", totalRounds: 3, selectedModes: ["NUMBER"] }), true);
  assert.equal(manager.handle(host.conn, { t: "START_GAME" }), true);

  for (let completed = 0; completed < 3; completed += 1) {
    resolveChallenge(manager, host, players, completed === 0 ? "catch" : "survive", now);
    assert.equal(manager.handle(host.conn, { t: "NEXT_ROUND" }), true);
  }
  assert.equal(room.phase, "GAME_OVER");
  assert.ok([...room.players.values()].some((player) => player.score > 0));

  assert.equal(manager.handle(host.conn, { t: "REMATCH" }), true);
  assert.equal(room.phase, "LOBBY");
  assert.equal(room.targetChallenges, 3);
  assert.equal(room.completedChallenges, 0);
  assert.equal(room.round, null);
  assert.ok([...room.players.values()].every((player) => player.score === 0));

  assert.equal(manager.handle(host.conn, { t: "START_GAME" }), true);
  const restarted = manager.roomForTests(host.code)!;
  assert.equal(restarted.phase, "QUESTION");
  assert.equal(restarted.targetChallenges, 3);
  assert.equal(restarted.completedChallenges, 0);
  assert.equal(restarted.round?.mode, "NUMBER");
  manager.dispose();
});
