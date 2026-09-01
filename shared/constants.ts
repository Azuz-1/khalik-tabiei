/** Shared game constants. */
import type { CategoryId, CategoryInfo, GameMode, GameModeInfo } from "./types.js";

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 10;
export const MAX_ACTIVE_ROOMS = 500;
export const MAX_CONNECTIONS_PER_UID = 4;
export const ROOM_CODE_LENGTH = 5;
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const NAME_MIN = 2;
export const NAME_MAX = 16;
export const ANSWER_MAX = 40;
export const UID_RE = /^u_[a-f0-9]{24}$/;
export const ROUND_OPTIONS = [3, 5, 7, 10] as const;
export const DEFAULT_ROUNDS = 5;
export const MAX_CHALLENGES_PER_ROUND = 3;

export const GAME_MODES: GameModeInfo[] = [
  { id: "HANDS", icon: "🙋", label: "ارفع", description: "ارفع يدك إذا ينطبق عليك المطلوب." },
  { id: "POINT", icon: "👉", label: "أشر", description: "أشر على واحد من الموجودين حسب المطلوب." },
  { id: "NUMBER", icon: "🔢", label: "كم؟", description: "جاوب برقم بأصابعك بنفس اللحظة." },
];
export const GAME_MODE_IDS: GameMode[] = GAME_MODES.map((m) => m.id);
export const DEFAULT_GAME_MODES: GameMode[] = [...GAME_MODE_IDS];

export const SCORING = { POINT_CORRECT_VOTE: 1, POINT_IMPOSTOR_SURVIVES: 2 } as const;
export const TIMERS = {
  QUESTION_TO_ANSWERING: 2500, // legacy TEXT_PAIR
  REVEAL_TO_DISCUSSION: 4000,
  PHYSICAL_COUNTDOWN: 4200,
  DISCONNECT_GRACE: 60_000,
} as const;

export const CATEGORIES: CategoryInfo[] = [
  { id: "family", label: "العائلة" }, { id: "friends", label: "الأصحاب" },
  { id: "food", label: "الأكل والشرب السعودي" }, { id: "travel", label: "المدن والسفر داخل السعودية" },
  { id: "football", label: "كرة القدم" }, { id: "ramadan", label: "رمضان والعيد" },
  { id: "majlis", label: "سوالف المجلس والجمعات" }, { id: "work", label: "الجامعة والعمل" },
  { id: "general", label: "أسئلة عامة خفيفة" },
];
export const CATEGORY_IDS: CategoryId[] = CATEGORIES.map((c) => c.id);
export function isCategoryId(x: unknown): x is CategoryId { return typeof x === "string" && CATEGORY_IDS.includes(x as CategoryId); }
