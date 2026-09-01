/** Internal server-only room state. */
import type { CategoryId, GameMode, GamePhase } from "../../../shared/types.js";
import { ANSWER_MAX, DEFAULT_GAME_MODES, MAX_PLAYERS, MIN_PLAYERS, NAME_MAX, NAME_MIN } from "../../../shared/constants.js";
import { GameError } from "./errors.js";
export interface InternalPlayer { uid: string; name: string; normalizedName: string; score: number; connected: boolean; joinedAt: number; lastSeen: number; disconnectGeneration: number; disconnectedAt?: number; pendingRemoval?: boolean; isHost: boolean; }
export interface RoundState {
  kind: "IMITATION" | "TEXT_PAIR"; index: number; impostorUid: string; participantUids: string[];
  challengeIndex: number; mode: GameMode; promptId: string; prompt: string; readyUids: Set<string>; roundComplete: boolean;
  pairId: string; category: CategoryId; normalQuestion: string; impostorQuestion: string; answers: Map<string, string>;
  votes: Map<string, string>; resultComputed: boolean; groupFound?: boolean; roundScores: Map<string, number>;
}
export interface RoomState {
  code: string; hostUid: string; phase: GamePhase; createdAt: number; updatedAt: number; minPlayers: number; maxPlayers: number; totalRounds: number; currentRound: number;
  categories: CategoryId[]; selectedModes: GameMode[]; modeBag: GameMode[]; lastMode?: GameMode; players: Map<string, InternalPlayer>; round: RoundState | null;
  usedPairIds: Set<string>; usedPromptIds: Set<string>; impostorHistory: string[]; phaseEndsAt?: number; closed: boolean;
}
export function createRoomState(code: string, hostUid: string, now: number): RoomState { return { code, hostUid, phase: "LOBBY", createdAt: now, updatedAt: now, minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, totalRounds: 0, currentRound: 0, categories: [], selectedModes: [...DEFAULT_GAME_MODES], modeBag: [], players: new Map(), round: null, usedPairIds: new Set(), usedPromptIds: new Set(), impostorHistory: [], closed: false }; }
export function activePlayers(room: RoomState): InternalPlayer[] { return [...room.players.values()].filter((p) => p.connected); }
export function roundParticipants(room: RoomState): InternalPlayer[] { if (!room.round) return []; return room.round.participantUids.map((uid) => room.players.get(uid)).filter((p): p is InternalPlayer => p !== undefined); }
export function allPlayers(room: RoomState): InternalPlayer[] { return [...room.players.values()]; }
export function normalizeArabic(input: string): string { return input.normalize("NFKC").replace(/[ً-ٰٟـ]/g, "").replace(/[آأإٱ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي").replace(/ؤ/g, "و").replace(/ئ/g, "ي").replace(/\s+/g, " ").trim().toLowerCase(); }
export function stripUnsafeTextControls(input: string): string { return input.replace(/[\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, ""); }
export function cleanName(raw: unknown): string { if (typeof raw !== "string") throw new GameError("INVALID_NAME"); const name = stripUnsafeTextControls(raw).replace(/\s+/g, " ").trim(); const len = [...name].length; if (len < NAME_MIN || len > NAME_MAX) throw new GameError("INVALID_NAME"); return name; }
export function cleanAnswer(raw: unknown): string { if (typeof raw !== "string") throw new GameError("INVALID_ANSWER"); const answer = stripUnsafeTextControls(raw).replace(/\s+/g, " ").trim(); const len = [...answer].length; if (len < 1 || len > ANSWER_MAX) throw new GameError("INVALID_ANSWER"); return answer; }
