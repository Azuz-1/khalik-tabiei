import type { ClientView, PublicPlayer, RevealedAnswer, Role } from "../../../shared/types.js";
import { CATEGORIES, GAME_MODES, MAX_CHALLENGES_PER_ROUND } from "../../../shared/constants.js";
import { activePlayers, roundParticipants, type RoomState } from "./state.js";
import { questionFor, ranking, requiredVotesFor } from "./engine.js";

const SECRET_IMITATION_PHASES = new Set(["QUESTION", "COUNTDOWN", "ACTION", "HOLD"]);
const PUBLIC_PROMPT_PHASES = new Set(["PROMPT_REVEAL", "DISCUSSION", "VOTING", "RESULT"]);

function roleFor(room: RoomState, uid: string): Role {
  if (uid === room.hostUid) return "host";
  if (room.players.has(uid)) return "player";
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
    isHost: false,
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

export function buildView(room: RoomState, uid: string, joinUrl: string): ClientView {
  const role = roleFor(room, uid);
  const self = room.players.get(uid);
  const round = room.round;
  const roundMaxChallenges = round?.maxChallenges ?? MAX_CHALLENGES_PER_ROUND;
  const view: ClientView = {
    self: { uid, role, name: self?.name, connected: self?.connected ?? true },
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

  if (role === "host") {
    view.blockedPlayers = [...room.kickedIdentities].map(([blockedUid, name]) => ({ uid: blockedUid, name }));
    if (room.phase === "LOBBY") view.settingsEditable = true;
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
    view.publicPrompt = { mode: round.mode, text: round.prompt };
  }

  if (room.phase === "VOTING" && round) {
    const participants = roundParticipants(room);
    view.votesProgress = {
      submitted: round.resolutionSealed ? participants.length : round.votes.size,
      total: participants.length,
      requiredVotes: requiredVotesFor(participants.length),
    };
    // Deliberately do not serialize live target totals. During voting the shared
    // screen shows only submitted/total so later voters cannot follow a live leader.
    if (role === "player" && self?.connected && round.participantUids.includes(uid)) {
      view.voteTargets = participants.filter((player) => player.uid !== uid).map((player) => ({ uid: player.uid, name: player.name }));
      view.myVoteSubmitted = round.votes.has(uid) || Boolean(round.resolutionSealed);
    }
  }

  if (room.phase === "RESULT" && round && round.resultComputed) {
    const revealIdentity = round.roundComplete;
    view.result = {
      ...(revealIdentity ? { impostorUid: round.impostorUid, impostorName: round.resultImpostorName ?? "—" } : {}),
      groupFound: round.groupFound ?? false,
      roundComplete: round.roundComplete,
      challengeIndex: round.challengeIndex,
      maxChallenges: roundMaxChallenges,
      mode: round.mode,
      requiredVotes: round.resultRequiredVotes ?? 0,
      ...(round.kind === "TEXT_PAIR" ? { normalQuestion: round.normalQuestion, impostorQuestion: round.impostorQuestion, category: round.category } : {}),
      voteTally: revealIdentity ? round.resultVoteTally ?? [] : [],
    };
    if (room.playStyle === "INDIVIDUAL" && revealIdentity) {
      view.scoreboard = ranking(room).map((row) => ({ ...row, roundDelta: round.roundScores.get(row.uid) ?? 0 }));
    }
    if (
      role === "host" &&
      round.roundComplete &&
      room.completedChallenges < room.targetChallenges &&
      activePlayers(room).length < room.minPlayers
    ) {
      view.nextRoundWarning = "نحتاج 3 لاعبين على الأقل عشان نكمل. إذا تقدمت الآن بنرجع للّوبي وتنتهي اللعبة الحالية وتنمسح نقاطها.";
    }
  }

  if (room.phase === "GAME_OVER") {
    const caughtRounds = room.roundOutcomes.filter((outcome) => outcome.caught).length;
    const escapedRounds = room.roundOutcomes.filter((outcome) => !outcome.caught).length;
    view.gameOver = {
      totalRounds: room.roundOutcomes.length,
      caughtRounds,
      escapedRounds,
      targetChallenges: room.targetChallenges,
      completedChallenges: room.completedChallenges,
    };
    if (room.playStyle === "INDIVIDUAL") view.scoreboard = ranking(room);
    if (role === "player" && self && room.feedbackEligibleUids.has(uid)) {
      const submitted = room.feedbackSubmittedUids.has(uid);
      view.feedback = {
        submitted,
        challenges: submitted
          ? []
          : room.completedChallengeSummaries.map(({ ordinal, mode, prompt }) => ({ ordinal, mode, prompt })),
      };
    }
  }

  return view;
}