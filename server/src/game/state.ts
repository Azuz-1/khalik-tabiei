/**
 * Internal, server-only room + round state. THIS is where secrets live
 * (impostor identity, both questions, raw answers, raw votes). None of these
 * fields are ever serialized into a broadcast — see view.ts for the safe
 * per-recipient projection.
 */
import type { CategoryId, GamePhase } from "../../../shared/types.js";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  NAME_MAX,
  NAME_MIN,
  ANSWER_MAX,
} from "../../../shared/constants.js";
import { GameError } from "./errors.js";

export interface InternalPlayer {
  uid: string;
  /** Original display name, shown verbatim. */
  name: string;
  /** Normalized form used only for duplicate detection. */
  normalizedName: string;
  score: number;
  connected: boolean;
  joinedAt: number;
  lastSeen: number;
  isHost: boolean;
}

export interface RoundState {
  index: number; // 1-based round number
  pairId: string;
  category: CategoryId;
  // --- SECRET fields ---
  normalQuestion: string;
  impostorQuestion: string;
  impostorUid: string;
  answers: Map<string, string>; // uid -> answer (secret until REVEAL)
  votes: Map<string, string>; // voterUid -> targetUid (secret until RESULT)
  // --- derived after result ---
  resultComputed: boolean;
  groupFound?: boolean;
  roundScores: Map<string, number>; // uid -> delta this round
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
  currentRound: number; // 0 while in lobby
  categories: CategoryId[];
  /** Insertion-ordered map of players. */
  players: Map<string, InternalPlayer>;
  round: RoundState | null;
  usedPairIds: Set<string>;
  impostorHistory: string[]; // uids chosen as impostor, in order
  closed: boolean;
}

export function createRoomState(
  code: string,
  hostUid: string,
  now: number,
): RoomState {
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
    players: new Map(),
    round: null,
    usedPairIds: new Set(),
    impostorHistory: [],
    closed: false,
  };
}

/** Active = currently connected players who count toward the game. */
export function activePlayers(room: RoomState): InternalPlayer[] {
  return [...room.players.values()].filter((p) => p.connected);
}

export function allPlayers(room: RoomState): InternalPlayer[] {
  return [...room.players.values()];
}

// ---------------------------------------------------------------------------
// Input validation / normalization (defensive — all client input is untrusted)
// ---------------------------------------------------------------------------

/**
 * Normalize Arabic text for duplicate-name detection only. The visible name is
 * never altered. Handles alef/hamza variants, teh marbuta, alef maqsura,
 * tatweel, diacritics, and whitespace/case.
 */
export function normalizeArabic(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[ً-ٰٟـ]/g, "") // diacritics + tatweel
    .replace(/[آأإٱ]/g, "ا") // آأإٱ -> ا
    .replace(/ة/g, "ه") // ة -> ه
    .replace(/ى/g, "ي") // ى -> ي
    .replace(/ؤ/g, "و") // ؤ -> و
    .replace(/ئ/g, "ي") // ئ -> ي
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** Trim and validate a display name; returns the cleaned visible name. */
export function cleanName(raw: unknown): string {
  if (typeof raw !== "string") throw new GameError("INVALID_NAME");
  const name = raw.replace(/\s+/g, " ").trim();
  const len = [...name].length; // count code points, not UTF-16 units
  if (len < NAME_MIN || len > NAME_MAX) throw new GameError("INVALID_NAME");
  return name;
}

/** Trim and validate a submitted answer. */
export function cleanAnswer(raw: unknown): string {
  if (typeof raw !== "string") throw new GameError("INVALID_ANSWER");
  const answer = raw.replace(/\s+/g, " ").trim();
  const len = [...answer].length;
  if (len < 1 || len > ANSWER_MAX) throw new GameError("INVALID_ANSWER");
  return answer;
}
