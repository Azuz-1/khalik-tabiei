/** Internal server-only room state. */
import type { CategoryId, GameMode, GamePhase, PlayStyle } from "../../../shared/types.js";
import {
  ANSWER_MAX,
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
  /** Used only by INDIVIDUAL play; TEAM remains score-free. */
  score: number;
  connected: boolean;
  joinedAt: number;
  lastSeen: number;
  disconnectGeneration: number;
  disconnectedAt?: number;
  pendingRemoval?: boolean;
  isHost: boolean;
}

export interface SealedParticipant {
  uid: string;
  name: string;
}

export interface PauseState {
  reason: "HOST_DISCONNECTED";
  originalPhase: GamePhase;
  remainingMs?: number;
  generation: number;
}

/**
 * Legacy and current rounds still share one state interface because generic
 * room/reconnect helpers consume both shapes. TEXT_PAIR remains legacy-only and
 * is not selectable in the current product.
 */
export interface RoundState {
  kind: "IMITATION" | "TEXT_PAIR";
  index: number;
  impostorUid: string;
  participantUids: string[];

  challengeIndex: number;
  /** Current Challenge's selected mode; survived Challenges may rotate modes. */
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
  /**
   * Once every currently eligible voter has voted, the resolving ballot is
   * sealed before any membership-dependent work. This lets a Host reconnect
   * publish exactly the ballot that completed while the Host was offline.
   */
  resolutionSealed?: boolean;
  sealedParticipants?: SealedParticipant[];
  sealedVotes?: Map<string, string>;
  resultComputed: boolean;
  groupFound?: boolean;
  /** Majority threshold that actually governed this computed result. */
  resultRequiredVotes?: number;
  /** Frozen public identity after a completed Round, so later removal cannot rewrite history. */
  resultImpostorName?: string;
  /** Frozen anonymous aggregate tally for the Challenge that produced this completed result. */
  resultVoteTally?: Array<{ uid: string; name: string; votes: number }>;
  /** Round-complete INDIVIDUAL score delta. Empty for TEAM/intermediate results. */
  roundScores: Map<string, number>;
}

export interface RoundOutcome {
  roundIndex: number;
  caught: boolean;
  challengeIndex: number;
}

export interface RoomState {
  code: string;
  hostUid: string;
  hostConnected: boolean;
  /** Server-provided grace deadline; transport reconnects never extend it via heartbeat. */
  hostCloseDeadline?: number;
  /** Publicly projectable pause status without exposing hidden game state. */
  pause?: PauseState;
  phase: GamePhase;
  createdAt: number;
  updatedAt: number;
  minPlayers: number;
  maxPlayers: number;
  totalRounds: number;
  currentRound: number;

  categories: CategoryId[];
  playStyle: PlayStyle;
  selectedModes: GameMode[];
  /** Balanced Challenge-level mode bag. Redeals never consume it. */
  modeBag: GameMode[];
  lastMode?: GameMode;
  players: Map<string, InternalPlayer>;
  round: RoundState | null;

  /** Hidden across survived Challenges so a point cannot leak the impostor early. */
  pendingRoundScores: Map<string, number>;
  usedPairIds: Set<string>;
  /** Game-scoped prompt history. A mode resets only after its own pool is exhausted. */
  usedPromptIds: Set<string>;
  impostorHistory: string[];
  roundOutcomes: RoundOutcome[];
  phaseEndsAt?: number;
  /** Invalidates callbacks from an older physical sequence/reset. */
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
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    totalRounds: 0,
    currentRound: 0,
    categories: [],
    playStyle: "TEAM",
    selectedModes: [...DEFAULT_GAME_MODES],
    modeBag: [],
    players: new Map(),
    round: null,
    pendingRoundScores: new Map(),
    usedPairIds: new Set(),
    usedPromptIds: new Set(),
    impostorHistory: [],
    roundOutcomes: [],
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

export function normalizeArabic(input: string): string {
  return input
    .normalize("NFKC")
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
    /[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g,
    "",
  );
}

export function cleanName(raw: unknown): string {
  if (typeof raw !== "string") throw new GameError("INVALID_NAME");
  const name = stripUnsafeTextControls(raw).replace(/\s+/g, " ").trim();
  const length = [...name].length;
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
