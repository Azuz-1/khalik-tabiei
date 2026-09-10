import { MAX_CHALLENGES_PER_ROUND, SCORING } from "../../../shared/constants.js";
import { aggregateVoteTally } from "./votes.js";
import { roundParticipants, type RoomState, type RoundState, type SealedParticipant } from "./state.js";
import { GameError } from "./errors.js";

export interface VotingDeps {
  now: () => number;
}

function touch(room: RoomState, deps: VotingDeps): void {
  room.updatedAt = deps.now();
}

function resolvedMaxChallenges(round: RoundState): number {
  return round.maxChallenges ?? MAX_CHALLENGES_PER_ROUND;
}

/** Majority is defined only over ballots actually submitted. Zero ballots can never catch. */
export function requiredVotesFor(votesCast: number): number {
  return votesCast > 0 ? Math.floor(votesCast / 2) + 1 : 0;
}

export function submitVote(
  room: RoomState,
  uid: string,
  targetUid: unknown,
  deps: VotingDeps,
): { allVoted: boolean } {
  if (room.phase !== "VOTING") throw new GameError("INVALID_PHASE");
  const round = room.round;
  if (!round) throw new GameError("INVALID_PHASE");
  if (round.resolutionSealed) throw new GameError("VOTE_ALREADY_SUBMITTED");

  const voter = room.players.get(uid);
  if (!voter || !voter.connected || !round.participantUids.includes(uid)) {
    throw new GameError("NOT_PLAYER");
  }
  if (typeof targetUid !== "string" || targetUid === uid || !round.participantUids.includes(targetUid)) {
    throw new GameError("INVALID_VOTE");
  }
  if (round.votes.has(uid)) throw new GameError("VOTE_ALREADY_SUBMITTED");

  round.abstainedUids?.delete(uid);
  round.votes.set(uid, targetUid);
  touch(room, deps);
  return { allVoted: allVoted(room) };
}

export function allVoted(room: RoomState): boolean {
  const round = room.round;
  if (!round) return false;
  if (round.resolutionSealed) return true;
  const participants = roundParticipants(room);
  return participants.length > 0 && participants.every(
    (player) => round.votes.has(player.uid) || Boolean(round.abstainedUids?.has(player.uid)),
  );
}

export function sealVoteResolution(room: RoomState, deps: VotingDeps): void {
  if (room.phase !== "VOTING") throw new GameError("INVALID_PHASE");
  const round = room.round;
  if (!round) throw new GameError("INVALID_PHASE");
  if (round.resolutionSealed) return;
  if (!allVoted(room)) throw new GameError("INVALID_PHASE", "ballot is incomplete");

  const participants: SealedParticipant[] = roundParticipants(room).map((player) => ({
    uid: player.uid,
    name: player.name,
  }));
  const participantSet = new Set(participants.map((player) => player.uid));
  round.sealedParticipants = participants;
  round.sealedVotes = new Map(
    [...round.votes].filter(([voterUid, targetUid]) =>
      participantSet.has(voterUid) && participantSet.has(targetUid),
    ),
  );
  round.resolutionSealed = true;
  touch(room, deps);
}

function addPendingScore(room: RoomState, uid: string, points: number): void {
  room.pendingRoundScores.set(uid, (room.pendingRoundScores.get(uid) ?? 0) + points);
}

function updateCorrectVoteStreaks(
  room: RoomState,
  round: RoundState,
  participants: SealedParticipant[],
  votes: Map<string, string>,
): void {
  const participantSet = new Set(participants.map((participant) => participant.uid));
  for (const uid of [...room.correctVoteStreakStart.keys()]) {
    if (!participantSet.has(uid) || uid === round.impostorUid) room.correctVoteStreakStart.delete(uid);
  }

  for (const participant of participants) {
    if (participant.uid === round.impostorUid) continue;
    if (votes.get(participant.uid) === round.impostorUid) {
      if (!room.correctVoteStreakStart.has(participant.uid)) {
        room.correctVoteStreakStart.set(participant.uid, round.challengeIndex);
      }
    } else {
      // Missing ballots and wrong ballots both break the uninterrupted streak.
      room.correctVoteStreakStart.delete(participant.uid);
    }
  }
}

function awardContinuousDiscoveryScores(room: RoomState, round: RoundState): void {
  for (const [uid, startChallenge] of room.correctVoteStreakStart) {
    const points = Math.max(0, round.challengeIndex - startChallenge + 1);
    if (points > 0) addPendingScore(room, uid, points);
  }
}

/**
 * Authoritative competitive settlement. It never serializes voter identity and
 * it uses the sealed submitted ballots as the only denominator for capture.
 */
export function computeResult(room: RoomState, deps: VotingDeps): void {
  if (room.phase !== "VOTING") throw new GameError("INVALID_PHASE");
  const round = room.round;
  if (!round) throw new GameError("INVALID_PHASE");
  if (round.resultComputed) return;
  if (!round.resolutionSealed) sealVoteResolution(room, deps);

  const participants = round.sealedParticipants ?? [];
  const votes = round.sealedVotes ?? new Map<string, string>();
  const tally = new Map(participants.map((player) => [player.uid, 0]));
  for (const targetUid of votes.values()) {
    if (tally.has(targetUid)) tally.set(targetUid, (tally.get(targetUid) ?? 0) + 1);
  }

  const votesCast = votes.size;
  const impostorVotes = tally.get(round.impostorUid) ?? 0;
  const requiredVotes = requiredVotesFor(votesCast);
  const found = votesCast > 0 && impostorVotes > votesCast / 2;
  const matchTargetReached =
    round.kind === "IMITATION" && room.completedChallenges + 1 >= room.targetChallenges;

  round.groupFound = found;
  round.roundComplete =
    round.kind === "TEXT_PAIR" ||
    found ||
    round.challengeIndex >= resolvedMaxChallenges(round) ||
    matchTargetReached;
  round.roundScores = new Map();
  round.resultRequiredVotes = requiredVotes;

  if (round.kind === "IMITATION") {
    room.completedChallenges += 1;
    updateCorrectVoteStreaks(room, round, participants, votes);
    if (!found) {
      addPendingScore(room, round.impostorUid, SCORING.POINT_IMPOSTOR_SURVIVES_CHALLENGE);
    }

    if (round.roundComplete) {
      awardContinuousDiscoveryScores(room, round);
      for (const [playerUid, delta] of room.pendingRoundScores) {
        const player = room.players.get(playerUid);
        if (!player) continue;
        player.score += delta;
        round.roundScores.set(playerUid, delta);
      }
      room.pendingRoundScores.clear();
      room.correctVoteStreakStart.clear();
      if (room.completedChallenges >= room.targetChallenges) {
        // Keep RoomManager's existing final-RESULT compatibility sentinel aligned.
        room.currentRound = room.totalRounds;
      }
    }
  }

  if (round.roundComplete) {
    round.resultImpostorName =
      participants.find((player) => player.uid === round.impostorUid)?.name ?? "—";
    round.resultVoteTally = aggregateVoteTally(participants, votes);
  }

  round.resultComputed = true;

  if (
    round.kind === "IMITATION" &&
    round.roundComplete &&
    !room.roundOutcomes.some((outcome) => outcome.roundIndex === round.index)
  ) {
    room.roundOutcomes.push({
      roundIndex: round.index,
      caught: found,
      challengeIndex: round.challengeIndex,
    });
  }

  room.phase = "RESULT";
  room.phaseEndsAt = undefined;
  touch(room, deps);
}
