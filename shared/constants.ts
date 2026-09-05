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
    label: "ارفع يدك",
    fullLabel: "ارفع يدك",
    description: "إذا المطلوب ينطبق عليك، ارفع يدك.",
    onboardingInstructions: [
      "إذا المطلوب ينطبق عليك، ارفع يدك.",
      "إذا ما ينطبق عليك، خل يدك تحت.",
    ],
    normalInstruction: "وقت «ارفعوا!» ارفع يدك إذا المطلوب ينطبق عليك.",
    impostorInstruction: "وقت «ارفعوا!» قرر ترفع يدك أو تخليها تحت وخلك طبيعي.",
    actionLabel: "ارفعوا!",
  },
  {
    id: "POINT",
    icon: "👉",
    label: "أشر على شخص",
    fullLabel: "أشر على شخص",
    description: "اختر الشخص اللي تشوف إن المطلوب ينطبق عليه.",
    onboardingInstructions: [
      "شوف المطلوب واختر الشخص اللي تشوف إنه ينطبق عليه.",
      "وقت «أشروا!» الكل يأشر بنفس اللحظة.",
    ],
    normalInstruction: "وقت «أشروا!» أشر على شخص واحد حسب المطلوب.",
    impostorInstruction: "وقت «أشروا!» أشر على شخص واحد وخلك طبيعي.",
    actionLabel: "أشروا!",
  },
  {
    id: "NUMBER",
    icon: "🔢",
    label: "ارفع أصابعك",
    fullLabel: "ارفع أصابعك",
    description: "جاوب من 0 إلى 5 بأصابعك.",
    onboardingInstructions: [
      "جاوب من 0 إلى 5 بأصابعك.",
      "إذا جوابك صفر، خل يدك قبضة.",
      "وقت «ارفعوا أصابعكم!» الكل يرفع جوابه بنفس اللحظة.",
    ],
    normalInstruction: "وقت «ارفعوا أصابعكم!» ارفع أصابعك بالعدد اللي اخترته من 0 إلى 5.",
    impostorInstruction: "وقت «ارفعوا أصابعكم!» ارفع من 0 إلى 5 أصابع وخلك طبيعي.",
    actionLabel: "ارفعوا أصابعكم!",
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
  // Only the Host has a disconnect expiry. Player seats have no transport
  // expiry timer: they remain until reconnect, LEAVE_ROOM, KICK_PLAYER, or room close.
  HOST_DISCONNECT_GRACE: 5 * 60 * 1_000,
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
