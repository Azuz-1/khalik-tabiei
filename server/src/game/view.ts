import type { ClientView, PublicPlayer, RevealedAnswer, Role } from "../../../shared/types.js";
import { CATEGORIES, GAME_MODES, MAX_CHALLENGES_PER_ROUND } from "../../../shared/constants.js";
import { roundParticipants, type RoomState } from "./state.js";
import { questionFor, ranking } from "./engine.js";

function roleFor(room: RoomState, uid: string): Role { if (uid === room.hostUid) return "host"; if (room.players.has(uid)) return "player"; return "spectator"; }
function publicPlayers(room: RoomState): PublicPlayer[] { return [...room.players.values()].map((p) => ({ uid: p.uid, name: p.name, score: p.score, connected: p.connected, isHost: false })); }
function revealAnswers(room: RoomState): RevealedAnswer[] { const r = room.round; if (!r) return []; const out: RevealedAnswer[] = []; for (const p of room.players.values()) { const answer = r.answers.get(p.uid); if (answer !== undefined) out.push({ uid: p.uid, name: p.name, answer }); } return out; }

export function buildView(room: RoomState, uid: string, joinUrl: string): ClientView {
  const role = roleFor(room, uid); const self = room.players.get(uid); const round = room.round;
  const view: ClientView = {
    self: { uid, role, name: self?.name, connected: self?.connected ?? true },
    room: {
      code: room.code, phase: room.phase, currentRound: room.currentRound, totalRounds: room.totalRounds,
      maxPlayers: room.maxPlayers, minPlayers: room.minPlayers, hostUid: room.hostUid,
      selectedModes: room.selectedModes, availableModes: GAME_MODES,
      categories: room.categories, availableCategories: CATEGORIES, joinUrl,
      ...(room.phaseEndsAt ? { phaseEndsAt: room.phaseEndsAt } : {}),
    },
    players: publicPlayers(room),
  };
  if (role === "host" && room.phase === "LOBBY") view.settingsEditable = true;
  if (round?.kind === "IMITATION" && room.phase !== "GAME_OVER") view.challenge = { mode: round.mode, index: round.challengeIndex, max: MAX_CHALLENGES_PER_ROUND };

  if (round?.kind === "TEXT_PAIR" && (room.phase === "QUESTION" || room.phase === "ANSWERING")) {
    const participants = roundParticipants(room);
    view.answersProgress = { submitted: round.answers.size, total: participants.length };
    if (role === "player" && self?.connected && round.participantUids.includes(uid)) {
      view.myQuestion = questionFor(round, uid);
      view.myAnswerSubmitted = round.answers.has(uid);
    }
  }
  if (round?.kind === "TEXT_PAIR" && ["REVEAL", "DISCUSSION", "VOTING", "RESULT"].includes(room.phase)) view.reveal = revealAnswers(room);

  if (room.phase === "QUESTION" && round?.kind === "IMITATION") {
    const participants = roundParticipants(room);
    view.readyProgress = { submitted: round.readyUids.size, total: participants.length };
    if (role === "player" && self?.connected && round.participantUids.includes(uid)) {
      view.myReady = round.readyUids.has(uid);
      if (uid === round.impostorUid) view.isImpostor = true;
      else { view.isImpostor = false; view.myPrompt = { mode: round.mode, text: round.prompt }; }
    }
  }

  if (room.phase === "VOTING" && round) {
    const participants = roundParticipants(room);
    view.votesProgress = { submitted: round.votes.size, total: participants.length };
    if (role === "player" && self?.connected && round.participantUids.includes(uid)) {
      view.voteTargets = participants.filter((p) => p.uid !== uid).map((p) => ({ uid: p.uid, name: p.name }));
      view.myVoteSubmitted = round.votes.has(uid);
      if (round.votes.has(uid)) view.myVoteTargetUid = round.votes.get(uid);
    }
  }

  if (room.phase === "RESULT" && round && round.resultComputed) {
    const participants = roundParticipants(room);
    const impostor = room.players.get(round.impostorUid);
    const tally = new Map<string, number>();
    for (const p of participants) tally.set(p.uid, 0);
    for (const target of round.votes.values()) tally.set(target, (tally.get(target) ?? 0) + 1);
    const revealIdentity = round.roundComplete;
    view.result = {
      ...(revealIdentity ? { impostorUid: round.impostorUid, impostorName: impostor?.name ?? "—" } : {}),
      groupFound: round.groupFound ?? false,
      roundComplete: round.roundComplete,
      challengeIndex: round.challengeIndex,
      maxChallenges: round.kind === "IMITATION" ? MAX_CHALLENGES_PER_ROUND : 1,
      mode: round.mode,
      prompt: round.kind === "IMITATION" ? round.prompt : "",
      ...(round.kind === "TEXT_PAIR" ? { normalQuestion: round.normalQuestion, impostorQuestion: round.impostorQuestion, category: round.category } : {}),
      voteTally: participants.map((p) => ({ uid: p.uid, name: p.name, votes: tally.get(p.uid) ?? 0 })).filter((r) => r.votes > 0).sort((a, b) => b.votes - a.votes),
      voteBreakdown: revealIdentity ? [...round.votes.entries()].map(([voterUid, targetUid]) => ({
        voterUid,
        voterName: room.players.get(voterUid)?.name ?? "—",
        targetUid,
        targetName: room.players.get(targetUid)?.name ?? "—",
        correct: targetUid === round.impostorUid,
        voterWasImpostor: voterUid === round.impostorUid,
        points: round.roundScores.get(voterUid) ?? 0,
      })) : [],
      roundScores: revealIdentity ? [...round.roundScores.entries()].filter(([, d]) => d !== 0).map(([scoreUid, delta]) => ({ uid: scoreUid, delta })) : [],
    };
    view.scoreboard = ranking(room);
  }

  if (room.phase === "GAME_OVER") {
    const rows = ranking(room); const topScore = rows[0]?.score;
    view.gameOver = { winners: rows.filter((r) => topScore !== undefined && r.score === topScore).map(({ uid: winnerUid, name }) => ({ uid: winnerUid, name })), ranking: rows };
    view.scoreboard = rows;
  }
  return view;
}
