/**
 * The authoritative game engine. Pure game logic with no I/O, no sockets and
 * no timers — everything is driven through explicit calls and injected
 * randomness/clock so it can be unit-tested in isolation.
 *
 * Every mutation validates the current phase and the caller's role/identity.
 * The RoomManager is the only caller; it has already authenticated the uid.
 */
import type { CategoryId, GamePhase } from "../../../shared/types.js";
import {
  DEFAULT_ROUNDS,
  ROUND_OPTIONS,
  SCORING,
} from "../../../shared/constants.js";
import { CATEGORY_IDS } from "../../../shared/constants.js";
import { GameError } from "./errors.js";
import {
  activePlayers,
  allPlayers,
  cleanAnswer,
  type RoomState,
  type RoundState,
} from "./state.js";
import { pairsForCategories, pickPair } from "./questions.js";

export interface EngineDeps {
  rng: () => number;
  now: () => number;
}

const defaultDeps: EngineDeps = { rng: Math.random, now: Date.now };

function touch(room: RoomState, deps: EngineDeps): void {
  room.updatedAt = deps.now();
}

function assertPhase(room: RoomState, ...phases: GamePhase[]): void {
  if (!phases.includes(room.phase)) throw new GameError("INVALID_PHASE");
}

function assertHost(room: RoomState, uid: string): void {
  if (room.hostUid !== uid) throw new GameError("NOT_HOST");
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export function setSettings(
  room: RoomState,
  uid: string,
  patch: { totalRounds?: number; categories?: CategoryId[] },
  deps: EngineDeps = defaultDeps,
): void {
  assertHost(room, uid);
  assertPhase(room, "LOBBY");
  if (patch.totalRounds !== undefined) {
    if (!ROUND_OPTIONS.includes(patch.totalRounds as (typeof ROUND_OPTIONS)[number])) {
      throw new GameError("BAD_REQUEST", "invalid round count");
    }
    room.totalRounds = patch.totalRounds;
  }
  if (patch.categories !== undefined) {
    const cats = Array.isArray(patch.categories) ? patch.categories : [];
    const valid = [...new Set(cats)].filter((c) => CATEGORY_IDS.includes(c));
    room.categories = valid;
  }
  touch(room, deps);
}

// ---------------------------------------------------------------------------
// Impostor selection — fair distribution, unpredictable to clients
// ---------------------------------------------------------------------------

/**
 * Choose exactly one active player as impostor. Prefers players who have been
 * impostor the fewest times so far this game; ties broken randomly.
 */
export function selectImpostor(
  room: RoomState,
  deps: EngineDeps = defaultDeps,
): string {
  const active = activePlayers(room);
  if (active.length === 0) throw new GameError("NOT_ENOUGH_PLAYERS");
  const counts = new Map<string, number>();
  for (const p of active) counts.set(p.uid, 0);
  for (const uid of room.impostorHistory) {
    if (counts.has(uid)) counts.set(uid, (counts.get(uid) ?? 0) + 1);
  }
  const min = Math.min(...counts.values());
  const candidates = active.filter((p) => (counts.get(p.uid) ?? 0) === min);
  const idx = Math.floor(deps.rng() * candidates.length);
  return candidates[Math.min(idx, candidates.length - 1)].uid;
}

// ---------------------------------------------------------------------------
// Round lifecycle
// ---------------------------------------------------------------------------

function beginRound(room: RoomState, deps: EngineDeps): void {
  const pair = pickPair(room.categories, room.usedPairIds, deps.rng);
  room.usedPairIds.add(pair.id);
  const impostorUid = selectImpostor(room, deps);
  room.impostorHistory.push(impostorUid);

  const round: RoundState = {
    index: room.currentRound,
    pairId: pair.id,
    category: pair.category,
    normalQuestion: pair.normalQuestion,
    impostorQuestion: pair.impostorQuestion,
    impostorUid,
    answers: new Map(),
    votes: new Map(),
    resultComputed: false,
    roundScores: new Map(),
  };
  room.round = round;
  room.phase = "QUESTION";
  touch(room, deps);
}

export function startGame(
  room: RoomState,
  uid: string,
  deps: EngineDeps = defaultDeps,
): void {
  assertHost(room, uid);
  assertPhase(room, "LOBBY");
  const active = activePlayers(room);
  if (active.length < room.minPlayers) throw new GameError("NOT_ENOUGH_PLAYERS");
  if (room.categories.length === 0) throw new GameError("NO_CATEGORY_SELECTED");
  if (pairsForCategories(room.categories).length === 0) {
    throw new GameError("NO_CATEGORY_SELECTED");
  }
  if (room.totalRounds === 0) room.totalRounds = DEFAULT_ROUNDS;
  room.currentRound = 1;
  room.usedPairIds.clear();
  room.impostorHistory = [];
  for (const p of room.players.values()) p.score = 0;
  beginRound(room, deps);
}

/** QUESTION -> ANSWERING (auto after the "get ready" beat). */
export function openAnswering(
  room: RoomState,
  deps: EngineDeps = defaultDeps,
): void {
  assertPhase(room, "QUESTION");
  room.phase = "ANSWERING";
  touch(room, deps);
}

/** Which question a given uid received this round. */
export function questionFor(round: RoundState, uid: string): string {
  return uid === round.impostorUid
    ? round.impostorQuestion
    : round.normalQuestion;
}

export function submitAnswer(
  room: RoomState,
  uid: string,
  rawAnswer: unknown,
  deps: EngineDeps = defaultDeps,
): { allSubmitted: boolean } {
  assertPhase(room, "ANSWERING");
  const round = room.round;
  if (!round) throw new GameError("INVALID_PHASE");
  const player = room.players.get(uid);
  if (!player || !player.connected) throw new GameError("NOT_PLAYER");
  if (round.answers.has(uid)) throw new GameError("ANSWER_ALREADY_SUBMITTED");
  const answer = cleanAnswer(rawAnswer);
  round.answers.set(uid, answer);
  touch(room, deps);
  return { allSubmitted: allAnswered(room) };
}

export function allAnswered(room: RoomState): boolean {
  const round = room.round;
  if (!round) return false;
  const active = activePlayers(room);
  if (active.length === 0) return false;
  return active.every((p) => round.answers.has(p.uid));
}

/** ANSWERING -> REVEAL. */
export function reveal(room: RoomState, deps: EngineDeps = defaultDeps): void {
  assertPhase(room, "ANSWERING");
  if (!room.round) throw new GameError("INVALID_PHASE");
  room.phase = "REVEAL";
  touch(room, deps);
}

/** REVEAL -> DISCUSSION (auto after the applause beat). */
export function toDiscussion(
  room: RoomState,
  deps: EngineDeps = defaultDeps,
): void {
  assertPhase(room, "REVEAL");
  room.phase = "DISCUSSION";
  touch(room, deps);
}

/** DISCUSSION -> VOTING (host presses "ابدأ التصويت"). */
export function startVoting(
  room: RoomState,
  uid: string,
  deps: EngineDeps = defaultDeps,
): void {
  assertHost(room, uid);
  assertPhase(room, "DISCUSSION");
  room.phase = "VOTING";
  touch(room, deps);
}

export function submitVote(
  room: RoomState,
  uid: string,
  targetUid: unknown,
  deps: EngineDeps = defaultDeps,
): { allVoted: boolean } {
  assertPhase(room, "VOTING");
  const round = room.round;
  if (!round) throw new GameError("INVALID_PHASE");
  const voter = room.players.get(uid);
  if (!voter || !voter.connected) throw new GameError("NOT_PLAYER");
  if (typeof targetUid !== "string") throw new GameError("INVALID_VOTE");
  if (targetUid === uid) throw new GameError("INVALID_VOTE"); // no self-vote
  const target = room.players.get(targetUid);
  if (!target || !target.connected) throw new GameError("INVALID_VOTE");
  if (round.votes.has(uid)) throw new GameError("VOTE_ALREADY_SUBMITTED");
  round.votes.set(uid, targetUid);
  touch(room, deps);
  return { allVoted: allVoted(room) };
}

export function allVoted(room: RoomState): boolean {
  const round = room.round;
  if (!round) return false;
  const active = activePlayers(room);
  if (active.length === 0) return false;
  return active.every((p) => round.votes.has(p.uid));
}

/**
 * VOTING -> RESULT. Tallies votes, applies the tie rule, updates scores.
 *
 * Tie rule (documented in-game): the group must land its single highest vote
 * count on one player. A tie at the top means the group failed — the impostor
 * survives. The impostor is "found" only when the unique top-voted player is
 * the impostor.
 */
export function computeResult(
  room: RoomState,
  deps: EngineDeps = defaultDeps,
): void {
  assertPhase(room, "VOTING");
  const round = room.round;
  if (!round) throw new GameError("INVALID_PHASE");

  const tally = new Map<string, number>();
  for (const p of room.players.values()) tally.set(p.uid, 0);
  for (const target of round.votes.values()) {
    tally.set(target, (tally.get(target) ?? 0) + 1);
  }

  let maxVotes = 0;
  for (const p of activePlayers(room)) {
    maxVotes = Math.max(maxVotes, tally.get(p.uid) ?? 0);
  }
  const topPlayers = activePlayers(room).filter(
    (p) => (tally.get(p.uid) ?? 0) === maxVotes,
  );
  const uniqueTop = maxVotes > 0 && topPlayers.length === 1 ? topPlayers[0].uid : null;
  const groupFound = uniqueTop === round.impostorUid;

  // Scoring
  const roundScores = new Map<string, number>();
  for (const p of room.players.values()) roundScores.set(p.uid, 0);
  if (groupFound) {
    for (const [voterUid, targetUid] of round.votes) {
      if (voterUid === round.impostorUid) continue; // impostor earns nothing
      if (targetUid === round.impostorUid) {
        roundScores.set(voterUid, SCORING.POINT_CORRECT_VOTE);
      }
    }
  } else {
    roundScores.set(round.impostorUid, SCORING.POINT_IMPOSTOR_SURVIVES);
  }
  for (const [uid, delta] of roundScores) {
    const p = room.players.get(uid);
    if (p) p.score += delta;
  }

  round.roundScores = roundScores;
  round.groupFound = groupFound;
  round.resultComputed = true;
  room.phase = "RESULT";
  touch(room, deps);
}

/** RESULT -> next QUESTION, or GAME_OVER when rounds are exhausted. */
export function nextRound(
  room: RoomState,
  uid: string,
  deps: EngineDeps = defaultDeps,
): void {
  assertHost(room, uid);
  assertPhase(room, "RESULT");
  if (room.currentRound >= room.totalRounds) {
    room.phase = "GAME_OVER";
    touch(room, deps);
    return;
  }
  room.currentRound += 1;
  beginRound(room, deps);
}

/** GAME_OVER -> LOBBY, keeping players but resetting all game progress. */
export function rematch(
  room: RoomState,
  uid: string,
  deps: EngineDeps = defaultDeps,
): void {
  assertHost(room, uid);
  assertPhase(room, "GAME_OVER");
  room.phase = "LOBBY";
  room.currentRound = 0;
  room.round = null;
  room.usedPairIds.clear();
  room.impostorHistory = [];
  for (const p of room.players.values()) p.score = 0;
  touch(room, deps);
}

// ---------------------------------------------------------------------------
// Scoreboard / winner
// ---------------------------------------------------------------------------

export function ranking(room: RoomState) {
  const rows = allPlayers(room)
    .map((p) => ({ uid: p.uid, name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ar"));
  return rows.map((r, i) => ({ ...r, rank: i + 1 }));
}
