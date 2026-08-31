/**
 * Shared, centralized game constants. Tunable in one place so game balance
 * and limits can change without hunting through the codebase.
 */
import type { CategoryId, CategoryInfo } from "./types.js";

/** Player-count bounds. A game needs at least MIN; a room caps at MAX. */
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 10;

/** Room code: 5 chars from an unambiguous alphabet (no I, L, O, 0, 1). */
export const ROOM_CODE_LENGTH = 5;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Display-name rules. */
export const NAME_MIN = 2;
export const NAME_MAX = 16;

/** Answer length cap (short, conversational answers only). */
export const ANSWER_MAX = 40;

/** Allowed round counts offered in the host UI. */
export const ROUND_OPTIONS = [3, 5, 7, 10] as const;
export const DEFAULT_ROUNDS = 5;

/**
 * Centralized scoring. Change these to re-balance the game.
 *  - If the group correctly identifies the impostor, each normal player who
 *    voted for the impostor earns POINT_CORRECT_VOTE; the impostor earns 0.
 *  - If the impostor survives (wrong top vote or a tie at the top), the
 *    impostor earns POINT_IMPOSTOR_SURVIVES; everyone else earns 0.
 */
export const SCORING = {
  POINT_CORRECT_VOTE: 1,
  POINT_IMPOSTOR_SURVIVES: 2,
} as const;

/** Auto-advance timers (ms). Host still controls the discussion → voting step. */
export const TIMERS = {
  /** QUESTION "get ready" beat before answering opens. */
  QUESTION_TO_ANSWERING: 2500,
  /** REVEAL applause beat before the discussion prompt. */
  REVEAL_TO_DISCUSSION: 4000,
  /** Grace window (ms) before a disconnected player is considered droppable. */
  DISCONNECT_GRACE: 60_000,
} as const;

/** Ordered category catalog with Arabic labels. Add new categories here. */
export const CATEGORIES: CategoryInfo[] = [
  { id: "family", label: "العائلة" },
  { id: "friends", label: "الأصحاب" },
  { id: "food", label: "الأكل والشرب السعودي" },
  { id: "travel", label: "المدن والسفر داخل السعودية" },
  { id: "football", label: "كرة القدم" },
  { id: "ramadan", label: "رمضان والعيد" },
  { id: "majlis", label: "سوالف المجلس والجمعات" },
  { id: "work", label: "الجامعة والعمل" },
  { id: "general", label: "أسئلة عامة خفيفة" },
];

export const CATEGORY_IDS: CategoryId[] = CATEGORIES.map((c) => c.id);

export function isCategoryId(x: unknown): x is CategoryId {
  return typeof x === "string" && CATEGORY_IDS.includes(x as CategoryId);
}
