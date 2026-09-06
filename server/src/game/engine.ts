import type { CategoryId, GameMode, GamePhase, PlayStyle } from "../../../shared/types.js";
import {
  DEFAULT_ROUNDS,
  GAME_MODE_IDS,
  MAX_CHALLENGES_PER_ROUND,
  ROUND_OPTIONS,
  SCORING,
} from "../../../shared/constants.js";
import { GameError } from "./errors.js";
import {
  activePlayers,
  allPlayers,
  cleanAnswer,
  roundParticipants,
  type RoomState,
  type RoundState,
} from "./state.js";
import { IMITATION_PROMPTS, type ImitationPrompt } from "./imitationPrompts.data.js";
import { pickPair } from "./questions.js";

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

export function setSettings(
  room: RoomState,
  uid: string,
  patch: {
    totalRounds?: number;
    categories?: CategoryId[];
    selectedModes?: GameMode[];
    playStyle?: PlayStyle;
  },
  deps: EngineDeps = defaultDeps,
): void {
  assertHost(room, uid);
  assertPhase(room, "LOBBY");

  if (patch.categories !== undefined) {
    // Legacy TEXT_PAIR content remains in the codebase, but is intentionally
    // not selectable through the current client/server protocol.
    throw new GameError("BAD_REQUEST", "legacy mode unavailable");
  }

  if (patch.totalRounds !== undefined) {
    if (!ROUND_OPTIONS.includes(patch.totalRounds as (typeof ROUND_OPTIONS)[number])) {
      throw new GameError("BAD_REQUEST", "invalid round count");
    }
    room.totalRounds = patch.totalRounds;
  }

  if (patch.selectedModes !== undefined) {
    const modes = [...new Set(Array.isArray(patch.selectedModes) ? patch.selectedModes : [])].filter(
      (mode): mode is GameMode => GAME_MODE_IDS.includes(mode as GameMode),
    );
    if (!modes.length) throw new GameError("NO_MODE_SELECTED");
    room.selectedModes = modes;
    room.modeBag = [];
    room.lastMode = undefined;
  }

  if (patch.playStyle !== undefined) {
    if (patch.playStyle !== "TEAM" && patch.playStyle !== "INDIVIDUAL") {
      throw new GameError("BAD_REQUEST", "invalid play style");
    }
    room.playStyle = patch.playStyle;
  }

  touch(room, deps);
}

export function selectImpostor(room: RoomState, deps: EngineDeps = defaultDeps): string {
  const active = activePlayers(room);
  if (!active.length) throw new GameError("NOT_ENOUGH_PLAYERS");

  const counts = new Map(active.map((player) => [player.uid, 0]));
  for (const uid of room.impostorHistory) {
    if (counts.has(uid)) counts.set(uid, (counts.get(uid) ?? 0) + 1);
  }

  const minimum = Math.min(...counts.values());
  const candidates = active.filter((player) => (counts.get(player.uid) ?? 0) === minimum);
  const index = Math.min(Math.floor(deps.rng() * candidates.length), candidates.length - 1);
  return candidates[index].uid;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}

/**
 * Challenge-level balanced shuffle. Every intentional new Challenge consumes
 * one entry. A reconnect/redeal preserves the already-selected Challenge mode
 * and therefore never calls this function.
 */
export function pickBalancedMode(room: RoomState, deps: EngineDeps = defaultDeps): GameMode {
  if (!room.selectedModes.length) throw new GameError("NO_MODE_SELECTED");
  if (room.selectedModes.length === 1) {
    room.lastMode = room.selectedModes[0];
    return room.selectedModes[0];
  }

  if (!room.modeBag.length) {
    room.modeBag = shuffle(room.selectedModes, deps.rng);
    if (room.lastMode && room.modeBag[0] === room.lastMode) {
      const swapIndex = room.modeBag.findIndex((mode) => mode !== room.lastMode);
      if (swapIndex > 0) {
        [room.modeBag[0], room.modeBag[swapIndex]] = [room.modeBag[swapIndex], room.modeBag[0]];
      }
    }
  }

  const mode = room.modeBag.shift()!;
  room.lastMode = mode;
  return mode;
}

function pickPrompt(room: RoomState, mode: GameMode, deps: EngineDeps): ImitationPrompt {
  const pool = IMITATION_PROMPTS.filter((prompt) => prompt.mode === mode);
  let candidates = pool.filter((prompt) => !room.usedPromptIds.has(prompt.id));

  if (!candidates.length) {
    // Prompt history is game-scoped. Only this mode is reset, and only after
    // every prompt in its bank has been consumed.
    for (const prompt of pool) room.usedPromptIds.delete(prompt.id);
    candidates = pool;
  }

  if (!candidates.length) throw new GameError("INTERNAL", `no prompts for ${mode}`);

  const index = Math.min(Math.floor(deps.rng() * candidates.length), candidates.length - 1);
  const prompt = candidates[index];
  room.usedPromptIds.add(prompt.id);
  return prompt;
}

function prepareChallenge(
  room: RoomState,
  impostorUid: string,
  challengeIndex: number,
  participantUids: string[],
  mode: GameMode,
  deps: EngineDeps,
): void {
  const prompt = pickPrompt(room, mode, deps);

  room.round = {
    kind: "IMITATION",
    index: room.currentRound,
    impostorUid,
    participantUids,
    challengeIndex,
    mode,
    promptId: prompt.id,
    prompt: prompt.text,
    readyUids: new Set(),
    roundComplete: false,
    pairId: "",
    category: "general",
    normalQuestion: "",
    impostorQuestion: "",
    answers: new Map(),
    votes: new Map(),
    resultComputed: false,
    roundScores: new Map(),
  };

  room.phaseEndsAt = undefined;
  room.phase = "QUESTION";
  touch(room, deps);
}

function beginImitationRound(room: RoomState, deps: EngineDeps): void {
  const impostorUid = selectImpostor(room, deps);
  const mode = pickBalancedMode(room, deps);
  room.impostorHistory.push(impostorUid);
  prepareChallenge(
    room,
    impostorUid,
    1,
    activePlayers(room).map((player) => player.uid),
    mode,
    deps,
  );
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
    kind: "TEXT_PAIR",
    index: room.currentRound || 1,
    impostorUid,
    participantUids: activePlayers(room).map((player) => player.uid),
    challengeIndex: 1,
    mode: "HANDS",
    promptId: "",
    prompt: "",
    readyUids: new Set(),
    roundComplete: true,
    pairId: pair.id,
    category: pair.category,
    normalQuestion: pair.normalQuestion,
    impostorQuestion: pair.impostorQuestion,
    answers: new Map(),
    votes: new Map(),
    resultComputed: false,
    roundScores: new Map(),
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
  room.roundOutcomes = [];
  room.pendingRoundScores.clear();

  for (const player of room.players.values()) player.score = 0;
  beginImitationRound(room, deps);
}

// ---- Isolated legacy TEXT_PAIR operations ---------------------------------

export function questionFor(round: RoundState, uid: string): string {
  return uid === round.impostorUid ? round.impostorQuestion : round.normalQuestion;
}

export function openAnswering(room: RoomState, deps: EngineDeps = defaultDeps): void {
  assertPhase(room, "QUESTION");
  if (room.round?.kind !== "TEXT_PAIR") throw new GameError("INVALID_PHASE");
  room.phase = "ANSWERING";
  touch(room, deps);
}

export function submitAnswer(
  room: RoomState,
  uid: string,
  raw: unknown,
  deps: EngineDeps = defaultDeps,
): { allSubmitted: boolean } {
  assertPhase(room, "ANSWERING");
  const round = room.round;
  if (!round || round.kind !== "TEXT_PAIR") throw new GameError("INVALID_PHASE");

  const player = room.players.get(uid);
  if (!player || !player.connected || !round.participantUids.includes(uid)) {
    throw new GameError("NOT_PLAYER");
  }
  if (round.answers.has(uid)) throw new GameError("ANSWER_ALREADY_SUBMITTED");

  round.answers.set(uid, cleanAnswer(raw));
  touch(room, deps);
  return { allSubmitted: allAnswered(room) };
}

export function allAnswered(room: RoomState): boolean {
  const round = room.round;
  if (!round || round.kind !== "TEXT_PAIR") return false;
  const participants = roundParticipants(room);
  return participants.length > 0 && participants.every((player) => round.answers.has(player.uid));
}

export function reveal(room: RoomState, deps: EngineDeps = defaultDeps): void {
  assertPhase(room, "ANSWERING");
  if (room.round?.kind !== "TEXT_PAIR") throw new GameError("INVALID_PHASE");
  room.phase = "REVEAL";
  touch(room, deps);
}

// ---- Current IMITATION operations -----------------------------------------

export function markReady(
  room: RoomState,
  uid: string,
  deps: EngineDeps = defaultDeps,
): { allReady: boolean } {
  assertPhase(room, "QUESTION");
  const round = room.round;
  if (!round || round.kind !== "IMITATION") throw new GameError("INVALID_PHASE");

  const player = room.players.get(uid);
  if (!player || !player.connected || !round.participantUids.includes(uid)) {
    throw new GameError("NOT_PLAYER");
  }

  round.readyUids.add(uid);
  touch(room, deps);
  return {
    allReady: roundParticipants(room).every((participant) => round.readyUids.has(participant.uid)),
  };
}

export function startCountdown(
  room: RoomState,
  endsAt: number,
  deps: EngineDeps = defaultDeps,
): void {
  assertPhase(room, "QUESTION");
  if (room.round?.kind !== "IMITATION") throw new GameError("INVALID_PHASE");
  room.phase = "COUNTDOWN";
  room.phaseEndsAt = endsAt;
  touch(room, deps);
}

export function toAction(
  room: RoomState,
  endsAt: number,
  deps: EngineDeps = defaultDeps,
): void {
  assertPhase(room, "COUNTDOWN");
  if (room.round?.kind !== "IMITATION") throw new GameError("INVALID_PHASE");
  room.phase = "ACTION";
  room.phaseEndsAt = endsAt;
  touch(room, deps);
}

export function toHold(
  room: RoomState,
  endsAt: number,
  deps: EngineDeps = defaultDeps,
): void {
  assertPhase(room, "ACTION");
  if (room.round?.kind !== "IMITATION") throw new GameError("INVALID_PHASE");
  room.phase = "HOLD";
  room.phaseEndsAt = endsAt;
  touch(room, deps);
}

export function revealPrompt(
  room: RoomState,
  endsAt: number,
  deps: EngineDeps = defaultDeps,
): void {
  assertPhase(room, "HOLD");
  if (room.round?.kind !== "IMITATION") throw new GameError("INVALID_PHASE");
  room.phase = "PROMPT_REVEAL";
  room.phaseEndsAt = endsAt;
  touch(room, deps);
}

export function toDiscussion(room: RoomState, deps: EngineDeps = defaultDeps): void {
  assertPhase(room, "PROMPT_REVEAL");
  if (room.round?.kind !== "IMITATION") throw new GameError("INVALID_PHASE");
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

export function requiredVotesFor(participantCount: number): number {
  return Math.floor(participantCount / 2) + 1;
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
  if (!voter || !voter.connected || !round.participantUids.includes(uid)) {
    throw new GameError("NOT_PLAYER");
  }
  if (
    typeof targetUid !== "string" ||
    targetUid === uid ||
    !round.participantUids.includes(targetUid)
  ) {
    throw new GameError("INVALID_VOTE");
  }
  if (round.votes.has(uid)) throw new GameError("VOTE_ALREADY_SUBMITTED");

  round.votes.set(uid, targetUid);
  touch(room, deps);
  return { allVoted: allVoted(room) };
}

export function allVoted(room: RoomState): boolean {
  const round = room.round;
  if (!round) return false;
  const participants = roundParticipants(room);
  return participants.length > 0 && participants.every((player) => round.votes.has(player.uid));
}

function addPendingScore(room: RoomState, uid: string, points: number): void {
  room.pendingRoundScores.set(uid, (room.pendingRoundScores.get(uid) ?? 0) + points);
}

export function computeResult(room: RoomState, deps: EngineDeps = defaultDeps): void {
  assertPhase(room, "VOTING");
  const round = room.round;
  if (!round) throw new GameError("INVALID_PHASE");

  const participants = roundParticipants(room);
  const tally = new Map(participants.map((player) => [player.uid, 0]));
  for (const targetUid of round.votes.values()) {
    tally.set(targetUid, (tally.get(targetUid) ?? 0) + 1);
  }

  const requiredVotes = requiredVotesFor(participants.length);
  const found = (tally.get(round.impostorUid) ?? 0) >= requiredVotes;

  if (room.playStyle === "INDIVIDUAL" && round.kind === "IMITATION") {
    // Every normal player's vote is their own point decision. Keep these
    // increments server-only until the round ends; exposing them after
    // Challenge 1/2 would reveal that a private guess was correct.
    for (const [voterUid, targetUid] of round.votes) {
      if (voterUid !== round.impostorUid && targetUid === round.impostorUid) {
        addPendingScore(room, voterUid, SCORING.POINT_CORRECT_VOTE);
      }
    }
  }

  round.groupFound = found;
  round.roundComplete =
    round.kind === "TEXT_PAIR" || found || round.challengeIndex >= MAX_CHALLENGES_PER_ROUND;
  round.roundScores = new Map();
  round.resultComputed = true;

  if (room.playStyle === "INDIVIDUAL" && round.kind === "IMITATION" && round.roundComplete) {
    if (!found) addPendingScore(room, round.impostorUid, SCORING.POINT_IMPOSTOR_SURVIVES);

    for (const [playerUid, delta] of room.pendingRoundScores) {
      const player = room.players.get(playerUid);
      if (!player) continue;
      player.score += delta;
      round.roundScores.set(playerUid, delta);
    }
    room.pendingRoundScores.clear();
  }

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

export function nextRound(room: RoomState, uid: string, deps: EngineDeps = defaultDeps): void {
  assertHost(room, uid);
  assertPhase(room, "RESULT");
  const round = room.round;
  if (!round) throw new GameError("INVALID_PHASE");

  if (round.kind === "IMITATION" && !round.roundComplete) {
    // The impostor/participants stay fixed, but an intentional next Challenge
    // consumes the next balanced mode and gets a fresh prompt from that mode.
    const mode = pickBalancedMode(room, deps);
    prepareChallenge(
      room,
      round.impostorUid,
      round.challengeIndex + 1,
      round.participantUids,
      mode,
      deps,
    );
    return;
  }

  if (room.currentRound >= room.totalRounds) {
    room.phase = "GAME_OVER";
    room.phaseEndsAt = undefined;
    touch(room, deps);
    return;
  }

  room.currentRound += 1;
  if (round.kind === "TEXT_PAIR") beginLegacyRound(room, deps);
  else beginImitationRound(room, deps);
}

export function redealCurrentRound(room: RoomState, deps: EngineDeps = defaultDeps): void {
  assertPhase(
    room,
    "QUESTION",
    "ANSWERING",
    "REVEAL",
    "COUNTDOWN",
    "ACTION",
    "HOLD",
    "PROMPT_REVEAL",
    "DISCUSSION",
    "VOTING",
    "RESULT",
  );
  const round = room.round;
  if (!round) throw new GameError("INVALID_PHASE");

  if (room.phase === "RESULT" && (round.kind !== "IMITATION" || round.roundComplete)) {
    throw new GameError("INVALID_PHASE");
  }

  if (room.impostorHistory.at(-1) === round.impostorUid) room.impostorHistory.pop();
  room.pendingRoundScores.clear();

  if (round.kind === "TEXT_PAIR") {
    beginLegacyRound(room, deps);
    return;
  }

  // A disconnect redeal preserves the already-selected Challenge mode. It may
  // choose a new fair impostor because the participant set changed, but it
  // must not consume another entry from the Challenge-level mode bag.
  const mode = round.mode;
  const impostorUid = selectImpostor(room, deps);
  room.impostorHistory.push(impostorUid);
  prepareChallenge(
    room,
    impostorUid,
    1,
    activePlayers(room).map((player) => player.uid),
    mode,
    deps,
  );
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
  room.roundOutcomes = [];
  room.pendingRoundScores.clear();
  room.phaseEndsAt = undefined;
  for (const player of room.players.values()) player.score = 0;
  touch(room, deps);
}

export function rematch(room: RoomState, uid: string, deps: EngineDeps = defaultDeps): void {
  assertHost(room, uid);
  assertPhase(room, "GAME_OVER");
  abortToLobby(room, deps);
}

/** Shared ranking helper for INDIVIDUAL play and dormant TEXT_PAIR compatibility. */
export function ranking(room: RoomState) {
  const rows = allPlayers(room)
    .map((player) => ({ uid: player.uid, name: player.name, score: player.score }))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name, "ar"));

  let previousScore: number | undefined;
  let previousRank = 0;

  return rows.map((row, index) => {
    const rank = previousScore === row.score ? previousRank : index + 1;
    previousScore = row.score;
    previousRank = rank;
    return { ...row, rank };
  });
}
