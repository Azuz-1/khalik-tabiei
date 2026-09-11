import test from "node:test";
import assert from "node:assert/strict";
import { CHALLENGE_OPTIONS, GAME_MODE_IDS } from "../../shared/constants.js";
import type { GameMode } from "../../shared/types.js";
import * as engine from "../src/game/engine.js";
import { GameError } from "../src/game/errors.js";
import { createRoomState, type RoomState } from "../src/game/state.js";
import * as voting from "../src/game/voting.js";

const MODE_SETS: GameMode[][] = [
  ["HANDS"],
  ["POINT"],
  ["NUMBER"],
  [...GAME_MODE_IDS],
];

const GROUPS = [
  "good-cop-unanimous",
  "all-abstain",
  "single-correct-ballot",
  "split-two-ballots",
  "partial-majority",
  "bad-cop-strategic-tie",
  "alternating-survive-catch",
  "owner-abstains",
  "one-normal-votes-wrong",
  "bad-cop-self-vote-probe",
] as const;

type GroupProfile = (typeof GROUPS)[number];

function uid(index: number): string {
  return `u_${index.toString(16).padStart(24, "0")}`;
}

function seededRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1_664_525) + 1_013_904_223) >>> 0;
    return state / 2 ** 32;
  };
}

function fixture(playerCount: number, seed: number) {
  let clock = 10_000 + seed;
  const deps = {
    rng: seededRng(seed),
    now: () => ++clock,
  };
  const ownerUid = uid(1);
  const room = createRoomState("ABCDE", ownerUid, clock);
  for (let index = 1; index <= playerCount; index += 1) {
    const playerUid = uid(index);
    const name = index === 1 ? "المالك" : `لاعب ${index}`;
    room.players.set(playerUid, {
      uid: playerUid,
      name,
      normalizedName: name,
      seatNumber: index,
      score: 0,
      connected: true,
      joinedAt: clock + index,
      lastSeen: clock + index,
      disconnectGeneration: 0,
      isHost: index === 1,
    });
  }
  return { room, deps };
}

function enterVoting(room: RoomState, deps: { rng: () => number; now: () => number }): void {
  const round = room.round;
  assert.ok(round && round.kind === "IMITATION");
  for (const participantUid of round.participantUids) {
    engine.markReady(room, participantUid, deps);
  }
  engine.startCountdown(room, deps.now() + 1, deps);
  engine.toAction(room, deps.now() + 1, deps);
  engine.toHold(room, deps.now() + 1, deps);
  engine.revealPrompt(room, deps.now() + 1, deps);
  engine.toDiscussion(room, deps);
  engine.startVoting(room, room.hostUid, deps);
  assert.equal(room.phase, "VOTING");
}

function abstain(room: RoomState, playerUid: string): void {
  const round = room.round;
  assert.ok(round);
  round.abstainedUids ??= new Set();
  round.abstainedUids.add(playerUid);
}

function validFallbackTarget(participants: string[], voterUid: string): string {
  const target = participants.find((candidate) => candidate !== voterUid);
  assert.ok(target);
  return target;
}

function applyBallotProfile(
  room: RoomState,
  profile: GroupProfile,
  deps: { rng: () => number; now: () => number },
): void {
  const round = room.round;
  assert.ok(round && round.kind === "IMITATION");
  const participants = [...round.participantUids];
  const impostorUid = round.impostorUid;
  const normals = participants.filter((participantUid) => participantUid !== impostorUid);
  assert.ok(normals.length >= 2);

  const cast = (voterUid: string, targetUid: string) => {
    voting.submitVote(room, voterUid, targetUid, deps);
  };
  const castUnanimousCatch = () => {
    for (const voterUid of participants) {
      cast(
        voterUid,
        voterUid === impostorUid ? validFallbackTarget(normals, voterUid) : impostorUid,
      );
    }
  };

  switch (profile) {
    case "good-cop-unanimous":
      castUnanimousCatch();
      break;
    case "all-abstain":
      for (const playerUid of participants) abstain(room, playerUid);
      break;
    case "single-correct-ballot":
      cast(normals[0]!, impostorUid);
      for (const playerUid of participants) if (playerUid !== normals[0]) abstain(room, playerUid);
      break;
    case "split-two-ballots":
      cast(normals[0]!, impostorUid);
      cast(normals[1]!, normals[0]!);
      for (const playerUid of participants) {
        if (playerUid !== normals[0] && playerUid !== normals[1]) abstain(room, playerUid);
      }
      break;
    case "partial-majority":
      cast(normals[0]!, impostorUid);
      cast(normals[1]!, impostorUid);
      for (const playerUid of participants) {
        if (playerUid !== normals[0] && playerUid !== normals[1]) abstain(room, playerUid);
      }
      break;
    case "bad-cop-strategic-tie":
      cast(normals[0]!, impostorUid);
      cast(impostorUid, normals[0]!);
      for (const playerUid of participants) {
        if (playerUid !== normals[0] && playerUid !== impostorUid) abstain(room, playerUid);
      }
      break;
    case "alternating-survive-catch":
      if (round.challengeIndex % 2 === 1) {
        for (const playerUid of participants) abstain(room, playerUid);
      } else {
        castUnanimousCatch();
      }
      break;
    case "owner-abstains":
      for (const voterUid of participants) {
        if (voterUid === room.hostUid) {
          abstain(room, voterUid);
          continue;
        }
        cast(
          voterUid,
          voterUid === impostorUid ? validFallbackTarget(participants, voterUid) : impostorUid,
        );
      }
      break;
    case "one-normal-votes-wrong":
      cast(normals[0]!, normals[1]!);
      for (const voterUid of participants) {
        if (voterUid === normals[0]) continue;
        cast(
          voterUid,
          voterUid === impostorUid ? normals[0]! : impostorUid,
        );
      }
      break;
    case "bad-cop-self-vote-probe": {
      const attacker = participants[0]!;
      assert.throws(
        () => voting.submitVote(room, attacker, attacker, deps),
        (error: unknown) => error instanceof GameError && error.code === "INVALID_VOTE",
      );
      assert.equal(round.votes.has(attacker), false, "rejected self-vote must not consume the ballot");
      castUnanimousCatch();
      break;
    }
  }

  assert.equal(voting.allVoted(room), true, `${profile}: every participant must be vote-complete or abstained`);
}

function settleChallenge(
  room: RoomState,
  profile: GroupProfile,
  deps: { rng: () => number; now: () => number },
): { caught: boolean; mode: GameMode } {
  enterVoting(room, deps);
  const round = room.round!;
  const mode = round.mode;
  applyBallotProfile(room, profile, deps);

  const submittedVotes = new Map(round.votes);
  const votesCast = submittedVotes.size;
  const impostorVotes = [...submittedVotes.values()].filter((targetUid) => targetUid === round.impostorUid).length;
  const expectedRequired = voting.requiredVotesFor(votesCast);
  const expectedCaught = votesCast > 0 && impostorVotes > votesCast / 2;

  voting.sealVoteResolution(room, deps);
  voting.computeResult(room, deps);

  assert.equal(room.phase, "RESULT");
  assert.equal(round.resultRequiredVotes, expectedRequired);
  assert.equal(round.groupFound, expectedCaught);
  assert.ok(round.challengeIndex >= 1 && round.challengeIndex <= 3, "impostor stint must never exceed three Challenges");
  if (!round.roundComplete) {
    assert.equal(round.resultImpostorName, undefined, "intermediate survival must not reveal impostor identity");
    assert.equal(round.resultVoteTally, undefined, "intermediate survival must not reveal target totals");
  }
  return { caught: expectedCaught, mode };
}

test("acceptance matrix: 10 behavior groups x 3-10 players x every mode set x every Challenge target", () => {
  let matches = 0;
  let challenges = 0;
  let caughtChallenges = 0;
  const coverage = new Map<string, number>();

  for (let groupIndex = 0; groupIndex < GROUPS.length; groupIndex += 1) {
    const profile = GROUPS[groupIndex]!;
    for (let playerCount = 3; playerCount <= 10; playerCount += 1) {
      for (const targetChallenges of CHALLENGE_OPTIONS) {
        for (let modeIndex = 0; modeIndex < MODE_SETS.length; modeIndex += 1) {
          const selectedModes = MODE_SETS[modeIndex]!;
          const seed = 100_000 + groupIndex * 10_000 + playerCount * 100 + targetChallenges * 10 + modeIndex;
          const { room, deps } = fixture(playerCount, seed);
          engine.setSettings(room, room.hostUid, { totalRounds: targetChallenges, selectedModes }, deps);
          engine.startGame(room, room.hostUid, deps);

          const seenModes = new Set<GameMode>();
          while (room.phase !== "GAME_OVER") {
            if (room.phase === "QUESTION") {
              const before = room.completedChallenges;
              const result = settleChallenge(room, profile, deps);
              challenges += 1;
              if (result.caught) caughtChallenges += 1;
              seenModes.add(result.mode);
              assert.equal(room.completedChallenges, before + 1, "exactly one Challenge must settle per result");
              continue;
            }
            if (room.phase === "RESULT") {
              engine.nextRound(room, room.hostUid, deps);
              continue;
            }
            assert.fail(`unexpected phase ${room.phase} in ${profile}/${playerCount}/${targetChallenges}/${selectedModes.join("+")}`);
          }

          matches += 1;
          assert.equal(room.completedChallenges, targetChallenges, "match must end on the selected Challenge total exactly");
          assert.equal(room.targetChallenges, targetChallenges);
          assert.equal(room.players.size, playerCount);
          assert.ok(room.roundOutcomes.every((outcome) => outcome.challengeIndex >= 1 && outcome.challengeIndex <= 3));
          for (const player of room.players.values()) {
            assert.equal(Number.isInteger(player.score), true);
            assert.ok(player.score >= 0);
          }
          const ranking = engine.ranking(room);
          assert.equal(ranking.length, playerCount);
          assert.ok(ranking.every((row) => Number.isInteger(row.rank) && row.rank >= 1));

          if (selectedModes.length === 1) {
            assert.deepEqual([...seenModes], selectedModes);
          } else {
            assert.deepEqual([...seenModes].sort(), [...GAME_MODE_IDS].sort(), "mixed mode must exercise all physical modes");
          }
          const key = `${profile}:${playerCount}:${targetChallenges}:${selectedModes.join("+")}`;
          coverage.set(key, (coverage.get(key) ?? 0) + 1);
        }
      }
    }
  }

  assert.equal(matches, 10 * 8 * 4 * 4, "matrix must execute 1,280 complete matches");
  assert.equal(challenges, 10 * 8 * 4 * (3 + 6 + 9 + 12), "matrix must settle 9,600 Challenges");
  assert.equal(coverage.size, matches, "every matrix cell must be unique and executed once");
  assert.ok(caughtChallenges > 0, "matrix must include successful captures");
  assert.ok(caughtChallenges < challenges, "matrix must include impostor survivals");
});
