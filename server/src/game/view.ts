import type { ClientView, PublicPlayer, RevealedAnswer, Role, ScoreReason } from "../../../shared/types.js";
import { CATEGORIES, GAME_MODES, MAX_CHALLENGES_PER_ROUND } from "../../../shared/constants.js";
import { activePlayers, roundParticipants, type RoomState, type RoundState } from "./state.js";
import { questionFor, ranking } from "./engine.js";
import { promptNoveltyToken } from "./promptNovelty.js";

const SECRET_IMITATION_PHASES = new Set(["QUESTION", "COUNTDOWN", "ACTION", "HOLD"]);
const PUBLIC_PROMPT_PHASES = new Set(["PROMPT_REVEAL", "DISCUSSION", "VOTING", "RESULT"]);

function roleFor(room: RoomState, uid: string): Role {
  // Ownership is a capability, not a gameplay role. New room owners live in
  // players and therefore receive exactly the same private role/prompt/vote
  // projection as every other participant. The legacy host role remains only
  // for old/dev rooms whose owner was created without a player record.
  if (room.players.has(uid)) return "player";
  if (uid === room.hostUid) return "host";
  return "spectator";
}

/** Pure stable fallback for legacy/internal test players that predate explicit seat assignment. */
function stableSeatNumber(uid: string): number {
  let hash = 2166136261;
  for (const char of uid) {
    hash ^= char.codePointAt(0) ?? 0;
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) % 900_000 + 100_000;
}

function publicPlayers(room: RoomState): PublicPlayer[] {
  return [...room.players.values()].map((player) => ({
    uid: player.uid,
    name: player.name,
    seatNumber: player.seatNumber ?? stableSeatNumber(player.uid),
    connected: player.connected,
    isHost: player.uid === room.hostUid,
  }));
}

function revealAnswers(room: RoomState): RevealedAnswer[] {
  const round = room.round;
  if (!round) return [];
  const answers: RevealedAnswer[] = [];
  for (const player of room.players.values()) {
    const answer = round.answers.get(player.uid);
    if (answer !== undefined) answers.push({ uid: player.uid, name: player.name, answer });
  }
  return answers;
}

function roundScoreReason(round: RoundState, uid: string, delta: number): ScoreReason {
  if (!round.participantUids.includes(uid)) return { kind: "NOT_PARTICIPATING" };
  if (uid === round.impostorUid) return { kind: "IMPOSTOR_SURVIVAL", count: delta };
  return { kind: "NORMAL_CORRECT_STREAK", count: delta };
}

function completionReason(room: RoomState, round: RoundState, maxChallenges: number) {
  if (!round.roundComplete || round.kind !== "IMITATION") return undefined;
  if (round.groupFound) return "CAUGHT" as const;
  if (room.completedChallenges >= room.targetChallenges && round.challengeIndex < maxChallenges) return "MATCH_END" as const;
  return "MAX_CHALLENGES" as const;
}

export function buildView(room: RoomState, uid: string, joinUrl: string): ClientView {
  const role = roleFor(room, uid);
  const isOwner = uid === room.hostUid;
  const self = room.players.get(uid);
  const round = room.round;
  const roundMaxChallenges = round?.maxChallenges ?? MAX_CHALLENGES_PER_ROUND;
  const view: ClientView = {
    self: { uid, role, name: self?.name, connected: self?.connected ?? true, isOwner },
    room: {
      code: room.code,
      phase: room.phase,
      currentRound: room.currentRound,
      totalRounds: room.totalRounds,
      targetChallenges: room.targetChallenges,
      completedChallenges: room.completedChallenges,
      maxPlayers: room.maxPlayers,
      minPlayers: room.minPlayers,
      hostUid: room.hostUid,
      hostConnected: room.hostConnected,
      admissionLocked: room.admissionLocked,
      playStyle: room.playStyle,
      selectedModes: room.selectedModes,
      availableModes: GAME_MODES,
      categories: room.categories,
      availableCategories: CATEGORIES,
      joinUrl,
      ...(room.phaseEndsAt ? { phaseEndsAt: room.phaseEndsAt } : {}),
      ...(room.hostCloseDeadline ? { hostCloseDeadline: room.hostCloseDeadline } : {}),
      ...(room.pause ? { hostPause: { reason: room.pause.reason, originalPhase: room.pause.originalPhase } } : {}),
    },
    players: publicPlayers(room),
  };

  if (isOwner) {
    view.blockedPlayers = [...room.kickedIdentities].map(([blockedUid, name]) => ({ uid: blockedUid, name }));
    if (room.phase === "LOBBY") view.settingsEditable = true;
    if (
      room.phase === "QUESTION" &&
      round?.kind === "IMITATION" &&
      room.readyRecoveryDeadline !== undefined &&
      roundParticipants(room).some((player) => !player.connected && !round.readyUids.has(player.uid))
    ) {
      view.readyRecovery = { availableAt: room.readyRecoveryDeadline };
    }
  }

  if (round?.kind === "IMITATION" && room.phase !== "GAME_OVER") {
    view.challenge = { mode: round.mode, index: round.challengeIndex, max: roundMaxChallenges };
  }

  if (round?.kind === "TEXT_PAIR" && (room.phase === "QUESTION" || room.phase === "ANSWERING")) {
    const participants = roundParticipants(room);
    view.answersProgress = { submitted: round.answers.size, total: participants.length };
    if (role === "player" && self?.connected && round.participantUids.includes(uid)) {
      view.myQuestion = questionFor(round, uid);
      view.myAnswerSubmitted = round.answers.has(uid);
    }
  }

  if (round?.kind === "TEXT_PAIR" && ["REVEAL", "DISCUSSION", "VOTING", "RESULT"].includes(room.phase)) {
    view.reveal = revealAnswers(room);
  }

  if (round?.kind === "IMITATION" && SECRET_IMITATION_PHASES.has(room.phase)) {
    const participants = roundParticipants(room);
    if (room.phase === "QUESTION") view.readyProgress = { submitted: round.readyUids.size, total: participants.length };
    if (role === "player" && self?.connected && round.participantUids.includes(uid)) {
      view.myReady = round.readyUids.has(uid);
      if (uid === round.impostorUid) view.isImpostor = true;
      else {
        view.isImpostor = false;
        view.myPrompt = { mode: round.mode, text: round.prompt };
      }
    }
  }

  if (round?.kind === "IMITATION" && PUBLIC_PROMPT_PHASES.has(room.phase)) {
    view.publicPrompt = {
      mode: round.mode,
      text: round.prompt,
      // This stable token is intentionally withheld from Host/Spectator display
      // projections and from every pre-reveal phase. It lets a participant
      // browser remember this already-public prompt without exposing promptId.
      ...(role === "player" ? { noveltyToken: promptNoveltyToken(round.promptId) } : {}),
    };
  }

  if (room.phase === "VOTING" && round) {
    const participants = roundParticipants(room);
    view.votesProgress = {
      submitted: round.votes.size,
      total: participants.length,
    };
    // Deliberately do not serialize live target totals or a live quorum. During
    // voting every recipient sees only submitted/total plus the phase deadline.
    if (role === "player" && self?.connected && round.participantUids.includes(uid)) {
      view.voteTargets = participants.filter((player) => player.uid !== uid).map((player) => ({ uid: player.uid, name: player.name }));
      view.myVoteSubmitted = round.votes.has(uid) || Boolean(round.resolutionSealed);
    }
  }

  if (room.phase === "RESULT" && round && round.resultComputed) {
    const revealIdentity = round.roundComplete;
    const participantCount = round.sealedParticipants?.length ?? round.participantUids.length;
    const votesCast = round.sealedVotes?.size ?? round.votes.size;
    view.result = {
      ...(revealIdentity ? { impostorUid: round.impostorUid, impostorName: round.resultImpostorName ?? "—" } : {}),
      groupFound: round.groupFound ?? false,
      roundComplete: round.roundComplete,
      challengeIndex: round.challengeIndex,
      maxChallenges: roundMaxChallenges,
      mode: round.mode,
      ...(revealIdentity ? {
        requiredVotes: round.resultRequiredVotes ?? 0,
        votesCast,
        participantCount,
        completionReason: completionReason(room, round, roundMaxChallenges),
        voteTally: round.resultVoteTally ?? [],
      } : {}),
      ...(round.kind === "TEXT_PAIR" ? { normalQuestion: round.normalQuestion, impostorQuestion: round.impostorQuestion, category: round.category } : {}),
    };
    if (room.playStyle === "INDIVIDUAL" && revealIdentity) {
      view.scoreboard = ranking(room).map((row) => {
        const roundDelta = round.roundScores.get(row.uid) ?? 0;
        return { ...row, roundDelta, roundReason: roundScoreReason(round, row.uid, roundDelta) };
      });
    }
    if (
      isOwner &&
      round.roundComplete &&
      room.completedChallenges < room.targetChallenges &&
      activePlayers(room).length < room.minPlayers
    ) {
      view.nextRoundWarning = "نحتاج 3 لاعبين على الأقل عشان نكمل. إذا تقدمت الآن بنرجع لشاشة الانتظار وتنتهي اللعبة الحالية وتنمسح نقاطها.";
    }
  }

  if (room.phase === "GAME_OVER") {
    const caughtRounds = room.roundOutcomes.filter((outcome) => outcome.caught).length;
    const escapedRounds = room.roundOutcomes.filter((outcome) => !outcome.caught).length;
    const completedEscapeRounds = room.roundOutcomes.filter(
      (outcome) => !outcome.caught && outcome.challengeIndex >= MAX_CHALLENGES_PER_ROUND,
    ).length;
    const matchEndedUncaughtRounds = room.roundOutcomes.filter(
      (outcome) => !outcome.caught && outcome.challengeIndex < MAX_CHALLENGES_PER_ROUND,
    ).length;
    view.gameOver = {
      totalRounds: room.roundOutcomes.length,
      caughtRounds,
      escapedRounds,
      completedEscapeRounds,
      matchEndedUncaughtRounds,
      targetChallenges: room.targetChallenges,
      completedChallenges: room.completedChallenges,
    };
    if (room.playStyle === "INDIVIDUAL") view.scoreboard = ranking(room);
  }

  return view;
}
