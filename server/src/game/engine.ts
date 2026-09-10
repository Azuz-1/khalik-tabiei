import { randomInt } from "node:crypto";
import type { CategoryId, GameMode, GamePhase, PlayStyle } from "../../../shared/types.js";
import {
  BASE_CHALLENGES,
  GAME_MODE_IDS,
  MAX_CHALLENGES_PER_ROUND,
  MAX_CHALLENGES_THREE_PLAYERS,
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
  type SealedParticipant,
} from "./state.js";
import { IMITATION_PROMPTS, type ImitationPrompt } from "./imitationPrompts.data.js";
import { promptQualityWeight, type PromptFamily } from "./promptMetadata.js";
import { pickPair } from "./questions.js";
import { aggregateVoteTally } from "./votes.js";

export interface EngineDeps {
  rng: () => number;
  now: () => number;
}

const secureRng = () => randomInt(0, 2 ** 32) / 2 ** 32;
const defaultDeps: EngineDeps = { rng: secureRng, now: Date.now };

function touch(room: RoomState, deps: EngineDeps): void {
  room.updatedAt = deps.now();
}

function assertPhase(room: RoomState, ...phases: GamePhase[]): void {
  if (!phases.includes(room.phase)) throw new GameError("INVALID_PHASE");
}

function assertHost(room: RoomState, uid: string): void {
  if (room.hostUid !== uid) throw new GameError("NOT_HOST");
}

interface ProposedSettings {
  totalRounds: number;
  selectedModes: GameMode[];
  playStyle: PlayStyle;
}

type SettingsPatch = {
  totalRounds?: number;
  categories?: CategoryId[];
  selectedModes?: GameMode[];
  playStyle?: PlayStyle;
};

function deriveProposedSettings(room: RoomState, patch: SettingsPatch): ProposedSettings {
  const selectedModes =
    patch.selectedModes === undefined
      ? [...room.selectedModes]
      : [...new Set(Array.isArray(patch.selectedModes) ? patch.selectedModes : [])].filter(
          (mode): mode is GameMode => GAME_MODE_IDS.includes(mode as GameMode),
        );

  return {
    totalRounds: patch.totalRounds ?? room.totalRounds,
    selectedModes,
    playStyle: patch.playStyle ?? room.playStyle,
  };
}

function validateProposedSettings(proposed: ProposedSettings, patch: SettingsPatch): void {
  if (patch.categories !== undefined) {
    throw new GameError("BAD_REQUEST", "legacy mode unavailable");
  }

  if (
    patch.totalRounds !== undefined &&
    !ROUND_OPTIONS.includes(proposed.totalRounds as (typeof ROUND_OPTIONS)[number])
  ) {
    throw new GameError("BAD_REQUEST", "invalid challenge count");
  }

  if (patch.selectedModes !== undefined && !proposed.selectedModes.length) {
    throw new GameError("NO_MODE_SELECTED");
  }

  if (
    patch.playStyle !== undefined &&
    proposed.playStyle !== "TEAM" &&
    proposed.playStyle !== "INDIVIDUAL"
  ) {
    throw new GameError("BAD_REQUEST", "invalid play style");
  }
}

function commitSettings(room: RoomState, proposed: ProposedSettings, patch: SettingsPatch): void {
  if (patch.totalRounds !== undefined) {
    room.totalRounds = proposed.totalRounds;
    room.targetChallenges = proposed.totalRounds;
  }
  if (patch.selectedModes !== undefined) {
    room.selectedModes = proposed.selectedModes;
    room.modeBag = [];
    room.lastMode = undefined;
  }
  if (patch.playStyle !== undefined) room.playStyle = proposed.playStyle;
}

export function setSettings(
  room: RoomState,
  uid: string,
  patch: SettingsPatch,
  deps: EngineDeps = defaultDeps,
): void {
  assertHost(room, uid);
  assertPhase(room, "LOBBY");

  const proposed = deriveProposedSettings(room, patch);
  validateProposedSettings(proposed, patch);
  commitSettings(room, proposed, patch);
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
  const weights = active.map(
    (player) => 1 / (1 + (counts.get(player.uid) ?? 0) - minimum),
  );
  let ticket = deps.rng() * weights.reduce((sum, weight) => sum + weight, 0);

  for (let index = 0; index < active.length; index += 1) {
    ticket -= weights[index]!;
    if (ticket < 0) return active[index]!.uid;
  }
  return active[active.length - 1]!.uid;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const output = [...items];
  for (let index = output.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [output[index], output[swapIndex]] = [output[swapIndex], output[index]];
  }
  return output;
}

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

export function choosePromptCandidate(
  candidates: ImitationPrompt[],
  previousFamily: PromptFamily | undefined,
  rng: () => number,
  participantCount = 4,
): ImitationPrompt {
  if (!candidates.length) throw new GameError("INTERNAL", "no prompt candidates");
  const spaced = previousFamily ? candidates.filter((prompt) => prompt.family !== previousFamily) : candidates;
  const selectionPool = spaced.length ? spaced : candidates;
  const weights = selectionPool.map((prompt) => promptQualityWeight(prompt.flags, participantCount));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const normalizedRng = Math.max(0, Math.min(rng(), 1 - Number.EPSILON));
  let ticket = normalizedRng * totalWeight;

  for (let index = 0; index < selectionPool.length; index += 1) {
    ticket -= weights[index]!;
    if (ticket < 0) return selectionPool[index]!;
  }
  return selectionPool[selectionPool.length - 1]!;
}

function pickPrompt(
  room: RoomState,
  mode: GameMode,
  participantCount: number,
  deps: EngineDeps,
): ImitationPrompt {
  const pool = IMITATION_PROMPTS.filter((prompt) => prompt.mode === mode);
  let candidates = pool.filter((prompt) => !room.usedPromptIds.has(prompt.id));

  if (!candidates.length) {
    for (const prompt of pool) room.usedPromptIds.delete(prompt.id);
    candidates = pool;
  }

  if (!candidates.length) throw new GameError("INTERNAL", `no prompts for ${mode}`);

  const previousFamily = room.round?.promptId
    ? IMITATION_PROMPTS.find((prompt) => prompt.id === room.round?.promptId)?.family
    : undefined;
  const prompt = choosePromptCandidate(candidates, previousFamily, deps.rng, participantCount);
  room.usedPromptIds.add(prompt.id);
  return prompt;
}

function maxChallengesForParticipantCount(participantCount: number): number {
  return participantCount === 3 ? MAX_CHALLENGES_THREE_PLAYERS : MAX_CHALLENGES_PER_ROUND;
}

function resolvedMaxChallenges(round: RoundState): number {
  return round.maxChallenges ?? MAX_CHALLENGES_PER_ROUND;
}

function prepareChallenge(
  room: RoomState,
  impostorUid: string,
  challengeIndex: number,
  participantUids: string[],
  maxChallenges: number,
  mode: GameMode,
  deps: EngineDeps,
): void {
  const prompt = pickPrompt(room, mode, participantUids.length, deps);
  room.timerGeneration += 1;
  room.pause = undefined;
  room.round = {
    kind: "IMITATION",
    index: room.currentRound,
    impostorUid,
    participantUids,
    challengeIndex,
    maxChallenges,
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
    abstainedUids: new Set(),
    resultComputed: false,
    roundScores: new Map(),
  };

  room.phaseEndsAt = undefined;
  room.phase = "QUESTION";
  touch(room, deps);
}

function beginImitationRound(room: RoomState, deps: EngineDeps): void {
  const active = activePlayers(room);
  const impostorUid = selectImpostor(room, deps);
  const mode = pickBalancedMode(room, deps);
  room.impostorHistory.push(impostorUid);
  room.pendingRoundScores.clear();
  room.correctVoteStreakStart.clear();
  prepareChallenge(
    room,
    impostorUid,
    1,
    active.map((player) => player.uid),
    maxChallengesForParticipantCount(active.length),
    mode,
    deps,
  );
}

export function beginLegacyRound(room: RoomState, deps: EngineDeps = defaultDeps): void {
  const pair = pickPair(room.categories, room.usedPairIds, deps.rng);
  room.usedPairIds.add(pair.id);

  const impostorUid = selectImpostor(room, deps);
  room.impostorHistory.push(impostorUid);
  room.timerGeneration += 1;
  room.pause = undefined;
  room.round = {
    kind: "TEXT_PAIR",
    index: room.currentRound || 1,
    impostorUid,
    participantUids: activePlayers(room).map((player) => player.uid),
    challengeIndex: 1,
    maxChallenges: 1,
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
    abstainedUids: new Set(),
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

  const configuredTarget = ROUND_OPTIONS.includes(room.targetChallenges as (typeof ROUND_OPTIONS)[number])
    ? room.targetChallenges
    : BASE_CHALLENGES;
  room.playStyle = "INDIVIDUAL";
  room.targetChallenges = configuredTarget;
  // RoomManager historically uses totalRounds/currentRound to recognize a final RESULT.
  // Keep those fields as an internal compatibility sentinel only; product progress is challenge-based.
  room.totalRounds = configuredTarget;
  room.currentRound = 1;
  room.completedChallenges = 0;
  room.categories = [];
  room.usedPromptIds.clear();
  room.usedPairIds.clear();
  room.modeBag = [];
  room.lastMode = undefined;
  room.impostorHistory = [];
  room.roundOutcomes = [];
  room.pendingRoundScores.clear();
  room.correctVoteStreakStart.clear();

  for (const player of room.players.values()) player.score = 0;
  beginImitationRound(room, deps);
}

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

export function startCountdown(room: RoomState, endsAt: number, deps: EngineDeps = defaultDeps): void {
  assertPhase(room, "QUESTION");
  if (room.round?.kind !== "IMITATION") throw new GameError("INVALID_PHASE");
  room.phase = "COUNTDOWN";
  room.phaseEndsAt = endsAt;
  touch(room, deps);
}

export function restartCountdown(room: RoomState, endsAt: number, deps: EngineDeps = defaultDeps): void {
  assertPhase(room, "COUNTDOWN", "ACTION", "HOLD");
  if (room.round?.kind !== "IMITATION") throw new GameError("INVALID_PHASE");
  room.phase = "COUNTDOWN";
  room.phaseEndsAt = endsAt;
  touch(room, deps);
}

export function toAction(room: RoomState, endsAt: number, deps: EngineDeps = defaultDeps): void {
  assertPhase(room, "COUNTDOWN");
  if (room.round?.kind !== "IMITATION") throw new GameError("INVALID_PHASE");
  room.phase = "ACTION";
  room.phaseEndsAt = endsAt;
  touch(room, deps);
}

export function toHold(room: RoomState, endsAt: number, deps: EngineDeps = defaultDeps): void {
  assertPhase(room, "ACTION");
  if (room.round?.kind !== "IMITATION") throw new GameError("INVALID_PHASE");
  room.phase = "HOLD";
  room.phaseEndsAt = endsAt;
  touch(room, deps);
}

export function revealPrompt(room: RoomState, endsAt: number, deps: EngineDeps = defaultDeps): void {
  assertPhase(room, "HOLD");
  if (room.round?.kind !== "IMITATION") throw new GameError("INVALID_PHASE");
  room.phase = "PROMPT_REVEAL";
  room.phaseEndsAt = endsAt;
  touch(room, deps);
}

export function resumePromptReveal(room: RoomState, endsAt: number, deps: EngineDeps = defaultDeps): void {
  assertPhase(room, "PROMPT_REVEAL");
  if (room.round?.kind !== "IMITATION") throw new GameError("INVALID_PHASE");
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

export function sealVoteResolution(room: RoomState, deps: EngineDeps = defaultDeps): void {
  assertPhase(room, "VOTING");
  const round = room.round;
  if (!round) throw new GameError("INVALID_PHASE");
  if (round.resolutionSealed) return;
  if (!allVoted(room)) throw new GameError("INVALID_PHASE", "ballot is incomplete");

  const participants: SealedParticipant[] = roundParticipants(room).map((player) => ({ uid: player.uid, name: player.name }));
  const participantSet = new Set(participants.map((player) => player.uid));
  round.sealedParticipants = participants;
  round.sealedVotes = new Map([...round.votes].filter(([voterUid]) => participantSet.has(voterUid)));
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
    const votedForImpostor = votes.get(participant.uid) === round.impostorUid;
    if (votedForImpostor) {
      if (!room.correctVoteStreakStart.has(participant.uid)) room.correctVoteStreakStart.set(participant.uid, round.challengeIndex);
    } else {
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

export function computeResult(room: RoomState, deps: EngineDeps = defaultDeps): void {
  assertPhase(room, "VOTING");
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

  const requiredVotes = requiredVotesFor(participants.length);
  const found = (tally.get(round.impostorUid) ?? 0) >= requiredVotes;
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
    if (!found) addPendingScore(room, round.impostorUid, SCORING.POINT_IMPOSTOR_SURVIVES_CHALLENGE);

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
        // Make the existing RoomManager final-RESULT guard agree with the challenge-based match boundary.
        room.currentRound = room.totalRounds;
      }
    }
  }

  if (round.roundComplete) {
    round.resultImpostorName = participants.find((player) => player.uid === round.impostorUid)?.name ?? "—";
    round.resultVoteTally = aggregateVoteTally(participants, votes);
  }

  round.resultComputed = true;

  if (
    round.kind === "IMITATION" &&
    round.roundComplete &&
    !room.roundOutcomes.some((outcome) => outcome.roundIndex === round.index)
  ) {
    room.roundOutcomes.push({ roundIndex: round.index, caught: found, challengeIndex: round.challengeIndex });
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
    const mode = pickBalancedMode(room, deps);
    prepareChallenge(
      room,
      round.impostorUid,
      round.challengeIndex + 1,
      round.participantUids,
      resolvedMaxChallenges(round),
      mode,
      deps,
    );
    return;
  }

  if (round.kind === "IMITATION") {
    if (room.completedChallenges >= room.targetChallenges) {
      room.timerGeneration += 1;
      room.pause = undefined;
      room.phase = "GAME_OVER";
      room.phaseEndsAt = undefined;
      touch(room, deps);
      return;
    }

    room.currentRound += 1;
    beginImitationRound(room, deps);
    return;
  }

  if (room.currentRound >= room.totalRounds) {
    room.timerGeneration += 1;
    room.pause = undefined;
    room.phase = "GAME_OVER";
    room.phaseEndsAt = undefined;
    touch(room, deps);
    return;
  }

  room.currentRound += 1;
  beginLegacyRound(room, deps);
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

  if (room.phase === "RESULT" && (round.kind !== "IMITATION" || round.roundComplete)) throw new GameError("INVALID_PHASE");

  if (room.impostorHistory.at(-1) === round.impostorUid) room.impostorHistory.pop();
  room.pendingRoundScores.clear();
  room.correctVoteStreakStart.clear();

  if (round.kind === "TEXT_PAIR") {
    beginLegacyRound(room, deps);
    return;
  }

  const mode = round.mode;
  const active = activePlayers(room);
  const impostorUid = selectImpostor(room, deps);
  room.impostorHistory.push(impostorUid);
  prepareChallenge(
    room,
    impostorUid,
    1,
    active.map((player) => player.uid),
    maxChallengesForParticipantCount(active.length),
    mode,
    deps,
  );
}

export function abortToLobby(room: RoomState, deps: EngineDeps = defaultDeps): void {
  const configuredTarget = ROUND_OPTIONS.includes(room.targetChallenges as (typeof ROUND_OPTIONS)[number])
    ? room.targetChallenges
    : BASE_CHALLENGES;
  room.timerGeneration += 1;
  room.pause = undefined;
  room.phase = "LOBBY";
  room.currentRound = 0;
  room.totalRounds = configuredTarget;
  room.targetChallenges = configuredTarget;
  room.completedChallenges = 0;
  room.round = null;
  room.categories = [];
  room.usedPromptIds.clear();
  room.usedPairIds.clear();
  room.modeBag = [];
  room.lastMode = undefined;
  room.impostorHistory = [];
  room.roundOutcomes = [];
  room.pendingRoundScores.clear();
  room.correctVoteStreakStart.clear();
  room.phaseEndsAt = undefined;
  for (const player of room.players.values()) player.score = 0;
  touch(room, deps);
}

export function rematch(room: RoomState, uid: string, deps: EngineDeps = defaultDeps): void {
  assertHost(room, uid);
  assertPhase(room, "GAME_OVER");
  abortToLobby(room, deps);
}

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
