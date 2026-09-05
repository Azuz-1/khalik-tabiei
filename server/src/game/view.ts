import type {
  ClientView,
  PublicPlayer,
  RevealedAnswer,
  Role,
  VoteTallyEntry,
} from "../../../shared/types.js";
import {
  CATEGORIES,
  GAME_MODES,
  MAX_CHALLENGES_PER_ROUND,
} from "../../../shared/constants.js";
import { roundParticipants, type InternalPlayer, type RoomState } from "./state.js";
import { questionFor, ranking, requiredVotesFor } from "./engine.js";

const SECRET_IMITATION_PHASES = new Set(["QUESTION", "COUNTDOWN", "ACTION", "HOLD"]);
const PUBLIC_PROMPT_PHASES = new Set(["PROMPT_REVEAL", "DISCUSSION", "VOTING", "RESULT"]);

function roleFor(room: RoomState, uid: string): Role {
  if (uid === room.hostUid) return "host";
  if (room.players.has(uid)) return "player";
  return "spectator";
}

function publicPlayers(room: RoomState): PublicPlayer[] {
  return [...room.players.values()].map((player) => ({
    uid: player.uid,
    name: player.name,
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
    if (answer !== undefined) {
      answers.push({ uid: player.uid, name: player.name, answer });
    }
  }
  return answers;
}

function aggregateVoteTally(
  participants: InternalPlayer[],
  votes: Map<string, string>,
): VoteTallyEntry[] {
  const tally = new Map(participants.map((player) => [player.uid, 0]));
  for (const targetUid of votes.values()) {
    tally.set(targetUid, (tally.get(targetUid) ?? 0) + 1);
  }

  // Participant order is intentionally stable. Live TV cards must never jump
  // around as vote counts change.
  return participants.map((player) => ({
    uid: player.uid,
    name: player.name,
    votes: tally.get(player.uid) ?? 0,
  }));
}

export function buildView(room: RoomState, uid: string, joinUrl: string): ClientView {
  const role = roleFor(room, uid);
  const self = room.players.get(uid);
  const round = room.round;

  const view: ClientView = {
    self: {
      uid,
      role,
      name: self?.name,
      connected: self?.connected ?? true,
    },
    room: {
      code: room.code,
      phase: room.phase,
      currentRound: room.currentRound,
      totalRounds: room.totalRounds,
      maxPlayers: room.maxPlayers,
      minPlayers: room.minPlayers,
      hostUid: room.hostUid,
      hostConnected: room.hostConnected,
      playStyle: room.playStyle,
      selectedModes: room.selectedModes,
      availableModes: GAME_MODES,
      categories: room.categories,
      availableCategories: CATEGORIES,
      joinUrl,
      ...(room.phaseEndsAt ? { phaseEndsAt: room.phaseEndsAt } : {}),
    },
    players: publicPlayers(room),
  };

  if (role === "host" && room.phase === "LOBBY") {
    view.settingsEditable = true;
  }

  if (round?.kind === "IMITATION" && room.phase !== "GAME_OVER") {
    view.challenge = {
      mode: round.mode,
      index: round.challengeIndex,
      max: MAX_CHALLENGES_PER_ROUND,
    };
  }

  if (
    round?.kind === "TEXT_PAIR" &&
    (room.phase === "QUESTION" || room.phase === "ANSWERING")
  ) {
    const participants = roundParticipants(room);
    view.answersProgress = {
      submitted: round.answers.size,
      total: participants.length,
    };

    if (role === "player" && self?.connected && round.participantUids.includes(uid)) {
      view.myQuestion = questionFor(round, uid);
      view.myAnswerSubmitted = round.answers.has(uid);
    }
  }

  if (
    round?.kind === "TEXT_PAIR" &&
    ["REVEAL", "DISCUSSION", "VOTING", "RESULT"].includes(room.phase)
  ) {
    view.reveal = revealAnswers(room);
  }

  if (round?.kind === "IMITATION" && SECRET_IMITATION_PHASES.has(room.phase)) {
    const participants = roundParticipants(room);

    if (room.phase === "QUESTION") {
      view.readyProgress = {
        submitted: round.readyUids.size,
        total: participants.length,
      };
    }

    if (role === "player" && self?.connected && round.participantUids.includes(uid)) {
      view.myReady = round.readyUids.has(uid);
      if (uid === round.impostorUid) {
        // The impostor knows their role and mode, but the server intentionally
        // omits prompt text, promptId, and prompt-derived metadata pre-reveal.
        view.isImpostor = true;
      } else {
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
      submitted: round.votes.size,
      total: participants.length,
      requiredVotes: requiredVotesFor(participants.length),
    };

    if (role === "host") {
      // Deliberately live for the shared TV. This is aggregate-only: the
      // voter->target Map stays server-internal and is never projected.
      view.liveVoteTally = aggregateVoteTally(participants, round.votes);
    }

    if (role === "player" && self?.connected && round.participantUids.includes(uid)) {
      view.voteTargets = participants
        .filter((player) => player.uid !== uid)
        .map((player) => ({ uid: player.uid, name: player.name }));
      view.myVoteSubmitted = round.votes.has(uid);
    }
  }

  if (room.phase === "RESULT" && round && round.resultComputed) {
    const participants = roundParticipants(room);
    const impostor = room.players.get(round.impostorUid);
    const revealIdentity = round.roundComplete;

    view.result = {
      ...(revealIdentity
        ? {
            impostorUid: round.impostorUid,
            impostorName: impostor?.name ?? "—",
          }
        : {}),
      groupFound: round.groupFound ?? false,
      roundComplete: round.roundComplete,
      challengeIndex: round.challengeIndex,
      maxChallenges: round.kind === "IMITATION" ? MAX_CHALLENGES_PER_ROUND : 1,
      mode: round.mode,
      requiredVotes: requiredVotesFor(participants.length),
      ...(round.kind === "TEXT_PAIR"
        ? {
            normalQuestion: round.normalQuestion,
            impostorQuestion: round.impostorQuestion,
            category: round.category,
          }
        : {}),
      voteTally: revealIdentity ? aggregateVoteTally(participants, round.votes) : [],
    };

    if (room.playStyle === "INDIVIDUAL" && revealIdentity) {
      view.scoreboard = ranking(room).map((row) => ({
        ...row,
        roundDelta: round.roundScores.get(row.uid) ?? 0,
      }));
    }
  }

  if (room.phase === "GAME_OVER") {
    const caughtRounds = room.roundOutcomes.filter((outcome) => outcome.caught).length;
    const escapedRounds = room.roundOutcomes.filter((outcome) => !outcome.caught).length;
    view.gameOver = {
      totalRounds: room.totalRounds,
      caughtRounds,
      escapedRounds,
    };

    if (room.playStyle === "INDIVIDUAL") {
      view.scoreboard = ranking(room);
    }
  }

  return view;
}
