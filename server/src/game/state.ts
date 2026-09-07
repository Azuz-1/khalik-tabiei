/** Internal server-only room state. */
import type { CategoryId, GameMode, GamePhase, PlayStyle } from "../../../shared/types.js";
import {
  ANSWER_MAX,
  BASE_CHALLENGES,
  DEFAULT_GAME_MODES,
  MAX_PLAYERS,
  MIN_PLAYERS,
  NAME_MAX,
  NAME_MIN,
} from "../../../shared/constants.js";
import { GameError } from "./errors.js";

export interface InternalPlayer {
  uid: string;
  name: string;
  normalizedName: string;
  /** Stable for this occupied seat; rendered in addition to color/status. */
  seatNumber?: number;
  score: number;
  connected: boolean;
  joinedAt: number;
  lastSeen: number;
  disconnectGeneration: number;
  disconnectedAt?: number;
  pendingRemoval?: boolean;
  isHost: boolean;
}

export interface SealedParticipant { uid: string; name: string }

export interface PauseState {
  reason: "HOST_DISCONNECTED";
  originalPhase: GamePhase;
  remainingMs?: number;
  generation: number;
}

export interface RoundState {
  kind: "IMITATION" | "TEXT_PAIR";
  index: number;
  impostorUid: string;
  participantUids: string[];
  challengeIndex: number;
  /** Fixed for new impostor stints. Optional only for legacy/manual fixtures, which fall back to 3. */
  maxChallenges?: number;
  mode: GameMode;
  promptId: string;
  prompt: string;
  readyUids: Set<string>;
  roundComplete: boolean;
  pairId: string;
  category: CategoryId;
  normalQuestion: string;
  impostorQuestion: string;
  answers: Map<string, string>;
  votes: Map<string, string>;
  resolutionSealed?: boolean;
  sealedParticipants?: SealedParticipant[];
  sealedVotes?: Map<string, string>;
  resultComputed: boolean;
  groupFound?: boolean;
  resultRequiredVotes?: number;
  resultImpostorName?: string;
  resultVoteTally?: Array<{ uid: string; name: string; votes: number }>;
  roundScores: Map<string, number>;
}

export interface RoundOutcome {
  roundIndex: number;
  caught: boolean;
  challengeIndex: number;
}

export interface CompletedChallengeSummary {
  ordinal: number;
  challengeWithinStint: number;
  promptId: string;
  prompt: string;
  mode: GameMode;
}

export interface RoomState {
  code: string;
  hostUid: string;
  hostConnected: boolean;
  hostCloseDeadline?: number;
  pause?: PauseState;
  phase: GamePhase;
  createdAt: number;
  /** Operational bookkeeping; may include transport-level activity. */
  updatedAt: number;
  /** Product activity only. Heartbeats, reconnects, broadcasts, rejected actions and settings spam do not extend this. */
  meaningfulAt: number;
  /** Internal action-dedupe context. Incremented only when a new match actually starts. */
  matchGeneration: number;
  minPlayers: number;
  maxPlayers: number;
  totalRounds: number;
  currentRound: number;
  /** Competitive game length: play at least this many Challenges, then finish the active impostor stint. */
  targetChallenges: number;
  /** Authoritative count of completed Challenges in the current match. */
  completedChallenges: number;
  admissionLocked: boolean;
  /** Blocks a signed anonymous UID, not a physical person. */
  kickedIdentities: Map<string, string>;

  categories: CategoryId[];
  playStyle: PlayStyle;
  selectedModes: GameMode[];
  modeBag: GameMode[];
  lastMode?: GameMode;
  players: Map<string, InternalPlayer>;
  round: RoundState | null;
  /** Server-only score deltas accumulated during the active impostor stint. */
  pendingRoundScores: Map<string, number>;
  /** Server-only start Challenge for each normal player's current uninterrupted correct-vote streak. */
  correctVoteStreakStart: Map<string, number>;
  usedPairIds: Set<string>;
  usedPromptIds: Set<string>;
  impostorHistory: string[];
  roundOutcomes: RoundOutcome[];
  /** Compact current-match history used only for optional post-game challenge feedback. */
  completedChallengeSummaries: CompletedChallengeSummary[];
  /** Server-only UIDs that actually participated in at least one Challenge this match. */
  feedbackEligibleUids: Set<string>;
  /** Operational UID set prevents duplicate feedback; UIDs are never exported to analytics. */
  feedbackSubmittedUids: Set<string>;
  phaseEndsAt?: number;
  timerGeneration: number;
  closed: boolean;
}

export function createRoomState(code: string, hostUid: string, now: number): RoomState {
  return {
    code,
    hostUid,
    hostConnected: true,
    phase: "LOBBY",
    createdAt: now,
    updatedAt: now,
    meaningfulAt: now,
    matchGeneration: 0,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    totalRounds: 0,
    currentRound: 0,
    targetChallenges: BASE_CHALLENGES,
    completedChallenges: 0,
    admissionLocked: false,
    kickedIdentities: new Map(),
    categories: [],
    playStyle: "INDIVIDUAL",
    selectedModes: [...DEFAULT_GAME_MODES],
    modeBag: [],
    players: new Map(),
    round: null,
    pendingRoundScores: new Map(),
    correctVoteStreakStart: new Map(),
    usedPairIds: new Set(),
    usedPromptIds: new Set(),
    impostorHistory: [],
    roundOutcomes: [],
    completedChallengeSummaries: [],
    feedbackEligibleUids: new Set(),
    feedbackSubmittedUids: new Set(),
    timerGeneration: 0,
    closed: false,
  };
}

export function activePlayers(room: RoomState): InternalPlayer[] {
  return [...room.players.values()].filter((player) => player.connected);
}

export function roundParticipants(room: RoomState): InternalPlayer[] {
  if (!room.round) return [];
  return room.round.participantUids
    .map((uid) => room.players.get(uid))
    .filter((player): player is InternalPlayer => player !== undefined);
}

export function allPlayers(room: RoomState): InternalPlayer[] {
  return [...room.players.values()];
}

/**
 * Comparison-only Arabic key. Display text is never replaced by this value.
 * Default-ignorable code points are removed here so visually identical names
 * such as سالم and سالم\u200b collide. This is not a complete confusable-spoofing system.
 */
export function normalizeArabic(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/\p{Default_Ignorable_Code_Point}/gu, "")
    .replace(/[ً-ٰٟـ]/g, "")
    .replace(/[آأإٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function stripUnsafeTextControls(input: string): string {
  return input.replace(
    /[\u0000-\u001f\u007f-\u009f\u061c\u200b\u200e\u200f\u202a-\u202e\u2060\u2066-\u2069\ufeff]/g,
    "",
  );
}

function graphemeLength(input: string): number {
  const Segmenter = Intl.Segmenter;
  if (Segmenter) {
    return [...new Segmenter("ar", { granularity: "grapheme" }).segment(input)].length;
  }
  return [...input].length;
}

function hasVisibleContent(input: string): boolean {
  return input
    .replace(/\s/gu, "")
    .replace(/\p{Default_Ignorable_Code_Point}/gu, "")
    .length > 0;
}

/** Name length is measured in Unicode grapheme clusters after display cleaning. */
export function cleanName(raw: unknown): string {
  if (typeof raw !== "string") throw new GameError("INVALID_NAME");
  const name = stripUnsafeTextControls(raw.normalize("NFC")).replace(/\s+/g, " ").trim();
  if (!hasVisibleContent(name)) throw new GameError("INVALID_NAME");
  const length = graphemeLength(name);
  if (length < NAME_MIN || length > NAME_MAX) throw new GameError("INVALID_NAME");
  return name;
}

export function cleanAnswer(raw: unknown): string {
  if (typeof raw !== "string") throw new GameError("INVALID_ANSWER");
  const answer = stripUnsafeTextControls(raw).replace(/\s+/g, " ").trim();
  const length = [...answer].length;
  if (length < 1 || length > ANSWER_MAX) throw new GameError("INVALID_ANSWER");
  return answer;
}
