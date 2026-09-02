/** Shared game constants. */
import type {
  CategoryId,
  CategoryInfo,
  GameMode,
  GameModeInfo,
} from "./types.js";

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
  {
    id: "HANDS",
    icon: "🙋",
    label: "ارفع",
    description: "ارفع يدك إذا ينطبق عليك المطلوب.",
    roundInstructions: [
      "إذا ينطبق عليك المطلوب، ارفع يدك.",
      "إذا ما ينطبق عليك، خل يدك تحت.",
    ],
    normalInstruction: "وقت «ارفعوا!» نفّذ المطلوب وثبّت حركتك.",
    impostorInstruction: "وقت «ارفعوا!» قرر ترفع يدك أو تخليها تحت وخلك طبيعي.",
    actionLabel: "ارفعوا! 👀",
  },
  {
    id: "POINT",
    icon: "👉",
    label: "أشر",
    description: "أشر على شخص واحد حسب المطلوب.",
    roundInstructions: [
      "وقت «أشروا!» أشر على شخص واحد تشوف أن المطلوب ينطبق عليه.",
    ],
    normalInstruction: "وقت «أشروا!» أشر على شخص واحد حسب المطلوب وثبّت إشارتك.",
    impostorInstruction: "وقت «أشروا!» أشر على شخص واحد وخلك طبيعي.",
    actionLabel: "أشروا! 👀",
  },
  {
    id: "NUMBER",
    icon: "🔢",
    label: "كم؟",
    description: "جاوب من 0 إلى 5 بأصابعك بنفس اللحظة.",
    roundInstructions: [
      "جاوب من 0 إلى 5 بأصابعك.",
      "صفر = قبضة مقفلة.",
    ],
    normalInstruction: "وقت «ورّونا!» ورّنا جوابك من 0 إلى 5 بأصابعك.",
    impostorInstruction: "وقت «ورّونا!» ارفع من 0 إلى 5 أصابع وخلك طبيعي.",
    actionLabel: "ورّونا! 👀",
  },
];

export const GAME_MODE_IDS: GameMode[] = GAME_MODES.map((mode) => mode.id);
export const DEFAULT_GAME_MODES: GameMode[] = [...GAME_MODE_IDS];

/** Legacy-only constants kept for dormant TEXT_PAIR compatibility. */
export const SCORING = {
  POINT_CORRECT_VOTE: 1,
  POINT_IMPOSTOR_SURVIVES: 2,
} as const;

export const TIMERS = {
  QUESTION_TO_ANSWERING: 2_500, // legacy TEXT_PAIR
  REVEAL_TO_DISCUSSION: 4_000, // legacy TEXT_PAIR
  COUNTDOWN: 5_000,
  ACTION: 1_000,
  HOLD: 2_000,
  PROMPT_REVEAL: 2_500,
  DISCONNECT_GRACE: 60_000,
} as const;

/** Legacy TEXT_PAIR categories retained for future content work. */
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

export const CATEGORY_IDS: CategoryId[] = CATEGORIES.map((category) => category.id);

export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === "string" && CATEGORY_IDS.includes(value as CategoryId);
}
