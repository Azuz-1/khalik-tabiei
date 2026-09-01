import type { CategoryId, GameMode, GamePhase } from "../../../shared/types.js";
import { DEFAULT_ROUNDS, GAME_MODE_IDS, MAX_CHALLENGES_PER_ROUND, ROUND_OPTIONS, SCORING } from "../../../shared/constants.js";
import { GameError } from "./errors.js";
import { activePlayers, allPlayers, cleanAnswer, roundParticipants, type RoomState, type RoundState } from "./state.js";
import { IMITATION_PROMPTS, type ImitationPrompt } from "./imitationPrompts.data.js";
import { pickPair } from "./questions.js";

export interface EngineDeps { rng: () => number; now: () => number; }
const defaultDeps: EngineDeps = { rng: Math.random, now: Date.now };
function touch(room: RoomState, deps: EngineDeps): void { room.updatedAt = deps.now(); }
function assertPhase(room: RoomState, ...phases: GamePhase[]): void { if (!phases.includes(room.phase)) throw new GameError("INVALID_PHASE"); }
function assertHost(room: RoomState, uid: string): void { if (room.hostUid !== uid) throw new GameError("NOT_HOST"); }

export function setSettings(room: RoomState, uid: string, patch: { totalRounds?: number; categories?: CategoryId[]; selectedModes?: GameMode[] }, deps: EngineDeps = defaultDeps): void {
  assertHost(room, uid);
  assertPhase(room, "LOBBY");
  if (patch.categories !== undefined) {
    // Legacy TEXT_PAIR content remains in the codebase, but is intentionally
    // not selectable through the current client/server protocol.
    throw new GameError("BAD_REQUEST", "legacy mode unavailable");
  }
  if (patch.totalRounds !== undefined) {
    if (!ROUND_OPTIONS.includes(patch.totalRounds as (typeof ROUND_OPTIONS)[number])) throw new GameError("BAD_REQUEST", "invalid round count");
    room.totalRounds = patch.totalRounds;
  }
  if (patch.selectedModes !== undefined) {
    const modes = [...new Set(Array.isArray(patch.selectedModes) ? patch.selectedModes : [])]
      .filter((m): m is GameMode => GAME_MODE_IDS.includes(m as GameMode));
    if (!modes.length) throw new GameError("NO_MODE_SELECTED");
    room.selectedModes = modes;
    room.modeBag = [];
  }
  touch(room, deps);
}

export function selectImpostor(room: RoomState, deps: EngineDeps = defaultDeps): string {
  const active = activePlayers(room);
  if (!active.length) throw new GameError("NOT_ENOUGH_PLAYERS");
  const counts = new Map(active.map((p) => [p.uid, 0]));
  for (const uid of room.impostorHistory) if (counts.has(uid)) counts.set(uid, (counts.get(uid) ?? 0) + 1);
  const min = Math.min(...counts.values());
  const candidates = active.filter((p) => (counts.get(p.uid) ?? 0) === min);
  return candidates[Math.min(Math.floor(deps.rng() * candidates.length), candidates.length - 1)].uid;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function pickBalancedMode(room: RoomState, deps: EngineDeps = defaultDeps): GameMode {
  if (!room.selectedModes.length) throw new GameError("NO_MODE_SELECTED");
  if (room.selectedModes.length === 1) return room.selectedModes[0];
  if (!room.modeBag.length) {
    room.modeBag = shuffle(room.selectedModes, deps.rng);
    if (room.lastMode && room.modeBag[0] === room.lastMode) {
      const swap = room.modeBag.findIndex((m) => m !== room.lastMode);
      if (swap > 0) [room.modeBag[0], room.modeBag[swap]] = [room.modeBag[swap], room.modeBag[0]];
    }
  }
  const mode = room.modeBag.shift()!;
  room.lastMode = mode;
  return mode;
}

function pickPrompt(room: RoomState, mode: GameMode, deps: EngineDeps): ImitationPrompt {
  const pool = IMITATION_PROMPTS.filter((p) => p.mode === mode);
  let candidates = pool.filter((p) => !room.usedPromptIds.has(p.id));
  if (!candidates.length) {
    for (const p of pool) room.usedPromptIds.delete(p.id);
    candidates = pool;
  }
  if (!candidates.length) throw new GameError("INTERNAL", `no prompts for ${mode}`);
  const prompt = candidates[Math.min(Math.floor(deps.rng() * candidates.length), candidates.length - 1)];
  room.usedPromptIds.add(prompt.id);
  return prompt;
}

function prepareChallenge(room: RoomState, impostorUid: string, challengeIndex: number, participantUids: string[], deps: EngineDeps): void {
  const mode = pickBalancedMode(room, deps);
  const prompt = pickPrompt(room, mode, deps);
  room.round = {
    kind: "IMITATION", index: room.currentRound, impostorUid, participantUids,
    challengeIndex, mode, promptId: prompt.id, prompt: prompt.text, readyUids: new Set(), roundComplete: false,
    pairId: "", category: "general", normalQuestion: "", impostorQuestion: "", answers: new Map(),
    votes: new Map(), resultComputed: false, roundScores: new Map(),
  };
  room.phaseEndsAt = undefined;
  room.phase = "QUESTION";
  touch(room, deps);
}

function beginImitationRound(room: RoomState, deps: EngineDeps): void {
  const impostorUid = selectImpostor(room, deps);
  room.impostorHistory.push(impostorUid);
  prepareChallenge(room, impostorUid, 1, activePlayers(room).map((p) => p.uid), deps);
}

/**
 * Isolated legacy helper retained so the old TEXT_PAIR engine/data can be
 * maintained without being reachable from current room settings or UI.
 */
export function beginLegacyRound(room: RoomState, deps: EngineDeps = defaultDeps): void {
  const pair = pickPair(room.categories, room.usedPairIds, deps.rng);
  room.usedPairIds.add(pair.id);
  const impostorUid = selectImpostor(room, deps);
  room.impostorHistory.push(impostorUid);
  room.round = {
    kind: "TEXT_PAIR", index: room.currentRound || 1, impostorUid,
    participantUids: activePlayers(room).map((p) => p.uid), challengeIndex: 1, mode: "HANDS",
    promptId: "", prompt: "", readyUids: new Set(), roundComplete: true,
    pairId: pair.id, category: pair.category, normalQuestion: pair.normalQuestion,
    impostorQuestion: pair.impostorQuestion, answers: new Map(), votes: new Map(),
    resultComputed: false, roundScores: new Map(),
  };
  room.phase = "QUESTION";
  touch(room, deps);
}

export function startGame(room: RoomState, uid: string, deps: EngineDeps = defaultDeps): void {
  assertHost(room, uid);
  assertPhase(room, "LOBBY");
  if (activePlayers(room).length < room.minPlayers) throw new GameError("NOT_ENOUGH_PLAYERS");
  if (!room.selectedModes.length) throw new GameError("NO_MODE_SELECTED");
  if (room.totalRounds === 0) room.totalRounds = DEFAULT_ROUNDS;
  room.currentRound = 1;
  room.categories = [];
  room.usedPromptIds.clear();
  room.usedPairIds.clear();
  room.modeBag = [];
  room.lastMode = undefined;
  room.impostorHistory = [];
  for (const p of room.players.values()) p.score = 0;
  beginImitationRound(room, deps);
}

// ---- Isolated legacy TEXT_PAIR operations ---------------------------------
export function questionFor(round: RoundState, uid: string): string { return uid === round.impostorUid ? round.impostorQuestion : round.normalQuestion; }
export function openAnswering(room: RoomState, deps: EngineDeps = defaultDeps): void { assertPhase(room, "QUESTION"); if (room.round?.kind !== "TEXT_PAIR") throw new GameError("INVALID_PHASE"); room.phase = "ANSWERING"; touch(room, deps); }
export function submitAnswer(room: RoomState, uid: string, raw: unknown, deps: EngineDeps = defaultDeps): { allSubmitted: boolean } {
  assertPhase(room, "ANSWERING"); const r = room.round; if (!r || r.kind !== "TEXT_PAIR") throw new GameError("INVALID_PHASE");
  const p = room.players.get(uid); if (!p || !p.connected || !r.participantUids.includes(uid)) throw new GameError("NOT_PLAYER");
  if (r.answers.has(uid)) throw new GameError("ANSWER_ALREADY_SUBMITTED");
  r.answers.set(uid, cleanAnswer(raw)); touch(room, deps); return { allSubmitted: allAnswered(room) };
}
export function allAnswered(room: RoomState): boolean { const r = room.round; return !!r && r.kind === "TEXT_PAIR" && roundParticipants(room).length > 0 && roundParticipants(room).every((p) => r.answers.has(p.uid)); }
export function reveal(room: RoomState, deps: EngineDeps = defaultDeps): void { assertPhase(room, "ANSWERING"); if (room.round?.kind !== "TEXT_PAIR") throw new GameError("INVALID_PHASE"); room.phase = "REVEAL"; touch(room, deps); }

// ---- Current IMITATION operations -----------------------------------------
export function markReady(room: RoomState, uid: string, deps: EngineDeps = defaultDeps): { allReady: boolean } {
  assertPhase(room, "QUESTION");
  const r = room.round;
  if (!r || r.kind !== "IMITATION") throw new GameError("INVALID_PHASE");
  const p = room.players.get(uid);
  if (!p || !p.connected || !r.participantUids.includes(uid)) throw new GameError("NOT_PLAYER");
  r.readyUids.add(uid);
  touch(room, deps);
  return { allReady: roundParticipants(room).every((player) => r.readyUids.has(player.uid)) };
}

export function startCountdown(room: RoomState, endsAt: number, deps: EngineDeps = defaultDeps): void {
  assertPhase(room, "QUESTION");
  if (room.round?.kind !== "IMITATION") throw new GameError("INVALID_PHASE");
  room.phase = "REVEAL";
  room.phaseEndsAt = endsAt;
  touch(room, deps);
}

export function toDiscussion(room: RoomState, deps: EngineDeps = defaultDeps): void {
  assertPhase(room, "REVEAL");
  room.phase = "DISCUSSION";
  room.phaseEndsAt = undefined;
  touch(room, deps);
}

export function startVoting(room: RoomState, uid: string, deps: EngineDeps = defaultDeps): void {
  assertHost(room, uid);
  assertPhase(room, "DISCUSSION");
  room.phase = "VOTING";
  touch(room, deps);
}

export function submitVote(room: RoomState, uid: string, targetUid: unknown, deps: EngineDeps = defaultDeps): { allVoted: boolean } {
  assertPhase(room, "VOTING");
  const r = room.round;
  if (!r) throw new GameError("INVALID_PHASE");
  const voter = room.players.get(uid);
  if (!voter || !voter.connected || !r.participantUids.includes(uid)) throw new GameError("NOT_PLAYER");
  if (typeof targetUid !== "string" || targetUid === uid || !r.participantUids.includes(targetUid)) throw new GameError("INVALID_VOTE");
  if (r.votes.has(uid)) throw new GameError("VOTE_ALREADY_SUBMITTED");
  r.votes.set(uid, targetUid);
  touch(room, deps);
  return { allVoted: allVoted(room) };
}

export function allVoted(room: RoomState): boolean {
  const r = room.round;
  return !!r && roundParticipants(room).length > 0 && roundParticipants(room).every((p) => r.votes.has(p.uid));
}

export function computeResult(room: RoomState, deps: EngineDeps = defaultDeps): void {
  assertPhase(room, "VOTING");
  const r = room.round;
  if (!r) throw new GameError("INVALID_PHASE");
  const participants = roundParticipants(room);
  const tally = new Map(participants.map((p) => [p.uid, 0]));
  for (const target of r.votes.values()) tally.set(target, (tally.get(target) ?? 0) + 1);
  const maxVotes = Math.max(0, ...tally.values());
  const top = participants.filter((p) => (tally.get(p.uid) ?? 0) === maxVotes);
  const uniqueTop = maxVotes > 0 && top.length === 1 ? top[0].uid : null;
  const found = uniqueTop === r.impostorUid;
  const scores = new Map(participants.map((p) => [p.uid, 0]));
  if (found) {
    for (const [voterUid, targetUid] of r.votes) {
      if (voterUid !== r.impostorUid && targetUid === r.impostorUid) scores.set(voterUid, SCORING.POINT_CORRECT_VOTE);
    }
  } else if (r.kind === "TEXT_PAIR" || r.challengeIndex >= MAX_CHALLENGES_PER_ROUND) {
    scores.set(r.impostorUid, SCORING.POINT_IMPOSTOR_SURVIVES);
  }
  for (const [scoreUid, delta] of scores) {
    const p = room.players.get(scoreUid);
    if (p) p.score += delta;
  }
  r.groupFound = found;
  r.roundComplete = r.kind === "TEXT_PAIR" || found || r.challengeIndex >= MAX_CHALLENGES_PER_ROUND;
  r.roundScores = scores;
  r.resultComputed = true;
  room.phase = "RESULT";
  touch(room, deps);
}

export function nextRound(room: RoomState, uid: string, deps: EngineDeps = defaultDeps): void {
  assertHost(room, uid);
  assertPhase(room, "RESULT");
  const r = room.round;
  if (!r) throw new GameError("INVALID_PHASE");
  if (r.kind === "IMITATION" && !r.roundComplete) {
    prepareChallenge(room, r.impostorUid, r.challengeIndex + 1, r.participantUids, deps);
    return;
  }
  if (room.currentRound >= room.totalRounds) {
    room.phase = "GAME_OVER";
    touch(room, deps);
    return;
  }
  room.currentRound += 1;
  if (r.kind === "TEXT_PAIR") beginLegacyRound(room, deps);
  else beginImitationRound(room, deps);
}

export function redealCurrentRound(room: RoomState, deps: EngineDeps = defaultDeps): void {
  assertPhase(room, "QUESTION", "ANSWERING", "REVEAL", "DISCUSSION", "VOTING");
  const r = room.round;
  if (!r) throw new GameError("INVALID_PHASE");
  if (room.impostorHistory.at(-1) === r.impostorUid) room.impostorHistory.pop();
  if (r.kind === "TEXT_PAIR") beginLegacyRound(room, deps);
  else beginImitationRound(room, deps);
}

export function abortToLobby(room: RoomState, deps: EngineDeps = defaultDeps): void {
  room.phase = "LOBBY";
  room.currentRound = 0;
  room.round = null;
  room.categories = [];
  room.usedPromptIds.clear();
  room.usedPairIds.clear();
  room.modeBag = [];
  room.lastMode = undefined;
  room.impostorHistory = [];
  room.phaseEndsAt = undefined;
  for (const p of room.players.values()) p.score = 0;
  touch(room, deps);
}

export function rematch(room: RoomState, uid: string, deps: EngineDeps = defaultDeps): void {
  assertHost(room, uid);
  assertPhase(room, "GAME_OVER");
  abortToLobby(room, deps);
}

export function ranking(room: RoomState) {
  const rows = allPlayers(room).map((p) => ({ uid: p.uid, name: p.name, score: p.score }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ar"));
  let previousScore: number | undefined;
  let previousRank = 0;
  return rows.map((r, i) => {
    const rank = previousScore === r.score ? previousRank : i + 1;
    previousScore = r.score;
    previousRank = rank;
    return { ...r, rank };
  });
}
