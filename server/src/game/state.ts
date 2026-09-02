/** Internal server-only room state. */
import type { CategoryId, GameMode, GamePhase } from "../../../shared/types.js";
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
  /** Retained internally for legacy compatibility; current gameplay never changes or exposes it. */
  score: number;
  connected: boolean;
  joinedAt: number;
  lastSeen: number;
  disconnectGeneration: number;
  disconnectedAt?: number;
  pendingRemoval?: boolean;
  isHost: boolean;
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
  resultComputed: boolean;
  groupFound?: boolean;
  /** Retained internally as an always-zero legacy field; never serialized. */
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
  phase: GamePhase;
  createdAt: number;
  updatedAt: number;
  minPlayers: number;
  maxPlayers: number;
  totalRounds: number;
  currentRound: number;

  categories: CategoryId[];
  selectedModes: GameMode[];
  /** Balanced Challenge-level mode bag. Redeals never consume it. */
  modeBag: GameMode[];
  lastMode?: GameMode;
  players: Map<string, InternalPlayer>;
  round: RoundState | null;

  usedPairIds: Set<string>;
  /** Game-scoped prompt history. A mode resets only after its own pool is exhausted. */
  usedPromptIds: Set<string>;
  impostorHistory: string[];
  roundOutcomes: RoundOutcome[];
  phaseEndsAt?: number;
  closed: boolean;
}

export function createRoomState(code: string, hostUid: string, now: number): RoomState {
  return {
    code,
    hostUid,
    phase: "LOBBY",
    createdAt: now,
    updatedAt: now,
    minPlayers: MIN_PLAYERS,
    maxPlayers: MAX_PLAYERS,
    totalRounds: 0,
    currentRound: 0,
    categories: [],
    selectedModes: [...DEFAULT_GAME_MODES],
    modeBag: [],
    players: new Map(),
    round: null,
    usedPairIds: new Set(),
    usedPromptIds: new Set(),
    impostorHistory: [],
    roundOutcomes: [],
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
