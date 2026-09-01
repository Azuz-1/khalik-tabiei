/**
 * Per-recipient view projection — the ONLY bridge from secret server state to
 * the wire. Given the full room and the identity of ONE recipient, it returns
 * a `ClientView` containing public data plus that recipient's own private
 * data, and nothing else.
 *
 * Security invariants enforced here:
 *  - `myQuestion` is filled from the recipient's OWN uid only.
 *  - Impostor identity and both questions appear ONLY in RESULT / GAME_OVER.
 *  - Raw answers/votes never leak; only counts are exposed pre-reveal.
 */
import type {
  ClientView,
  PublicPlayer,
  Role,
  RevealedAnswer,
} from "../../../shared/types.js";
import { CATEGORIES } from "../../../shared/constants.js";
import { roundParticipants, type RoomState } from "./state.js";
import { questionFor, ranking } from "./engine.js";

function roleFor(room: RoomState, uid: string): Role {
  if (uid === room.hostUid) return "host";
  if (room.players.has(uid)) return "player";
  return "spectator";
}

function publicPlayers(room: RoomState): PublicPlayer[] {
  return [...room.players.values()].map((p) => ({
    uid: p.uid,
    name: p.name,
    score: p.score,
    connected: p.connected,
    isHost: false,
  }));
}

function revealAnswers(room: RoomState): RevealedAnswer[] {
  const round = room.round;
  if (!round) return [];
  const out: RevealedAnswer[] = [];
  for (const p of room.players.values()) {
    const answer = round.answers.get(p.uid);
    if (answer !== undefined) out.push({ uid: p.uid, name: p.name, answer });
  }
  return out;
}

export function buildView(
  room: RoomState,
  uid: string,
  joinUrl: string,
): ClientView {
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
      categories: room.categories,
      availableCategories: CATEGORIES,
      joinUrl,
    },
    players: publicPlayers(room),
  };

  if (role === "host" && room.phase === "LOBBY") {
    view.settingsEditable = true;
  }

  // --- QUESTION / ANSWERING -------------------------------------------------
  if (room.phase === "QUESTION" || room.phase === "ANSWERING") {
    if (round) {
      const participants = roundParticipants(room);
      view.answersProgress = {
        submitted: round.answers.size,
        total: participants.length,
      };
      if (role === "player" && self?.connected && round.participantUids.includes(uid)) {
        // Each player receives ONLY their own question.
        view.myQuestion = questionFor(round, uid);
        view.myAnswerSubmitted = round.answers.has(uid);
      }
    }
  }

  // --- REVEAL / DISCUSSION / VOTING / RESULT: public answers ---------------
  if (
    room.phase === "REVEAL" ||
    room.phase === "DISCUSSION" ||
    room.phase === "VOTING" ||
    room.phase === "RESULT"
  ) {
    view.reveal = revealAnswers(room);
  }

  // --- VOTING ---------------------------------------------------------------
  if (room.phase === "VOTING" && round) {
    const participants = roundParticipants(room);
    view.votesProgress = { submitted: round.votes.size, total: participants.length };
    if (role === "player" && self?.connected && round.participantUids.includes(uid)) {
      view.voteTargets = participants
        .filter((p) => p.uid !== uid)
        .map((p) => ({ uid: p.uid, name: p.name }));
      view.myVoteSubmitted = round.votes.has(uid);
      if (round.votes.has(uid)) view.myVoteTargetUid = round.votes.get(uid);
    }
  }

  // --- RESULT: secrets are now safe to reveal to everyone -------------------
  if (room.phase === "RESULT" && round && round.resultComputed) {
    const impostor = room.players.get(round.impostorUid);
    const tally = new Map<string, number>();
    for (const p of room.players.values()) tally.set(p.uid, 0);
    for (const target of round.votes.values()) {
      tally.set(target, (tally.get(target) ?? 0) + 1);
    }
    view.result = {
      impostorUid: round.impostorUid,
      impostorName: impostor?.name ?? "—",
      groupFound: round.groupFound ?? false,
      normalQuestion: round.normalQuestion,
      impostorQuestion: round.impostorQuestion,
      category: round.category,
      voteTally: [...room.players.values()]
        .map((p) => ({ uid: p.uid, name: p.name, votes: tally.get(p.uid) ?? 0 }))
        .filter((r) => r.votes > 0)
        .sort((a, b) => b.votes - a.votes),
      roundScores: [...round.roundScores.entries()]
        .filter(([, d]) => d !== 0)
        .map(([u, delta]) => ({ uid: u, delta })),
    };
    view.scoreboard = ranking(room);
  }

  // --- GAME_OVER ------------------------------------------------------------
  if (room.phase === "GAME_OVER") {
    const rows = ranking(room);
    const topScore = rows[0]?.score;
    view.gameOver = {
      winners: rows
        .filter((row) => topScore !== undefined && row.score === topScore)
        .map(({ uid: winnerUid, name }) => ({ uid: winnerUid, name })),
      ranking: rows,
    };
    view.scoreboard = rows;
  }

  return view;
}
