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
/** Host-selectable Challenge totals. The match ends exactly at the selected total. */
export const CHALLENGE_OPTIONS = [3, 6, 9, 12] as const;
/** Legacy protocol name retained because SET_SETTINGS still transports the selected target as totalRounds. */
export const ROUND_OPTIONS = CHALLENGE_OPTIONS;
export const DEFAULT_ROUNDS = 9;
/** Default competitive match target when the Host does not change the Challenge count. */
export const BASE_CHALLENGES = 9;
/** Every impostor stint can last at most three Challenges, for every supported player count. */
export const MAX_CHALLENGES_PER_ROUND = 3;
/** Compatibility alias retained for older imports/tests; three-player stints now also use three Challenges. */
export const MAX_CHALLENGES_THREE_PLAYERS = MAX_CHALLENGES_PER_ROUND;

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

/** Competitive scoring values. TEAM remains protocol-compatible but is no longer exposed by the product UI. */
export const SCORING = {
  POINT_CORRECT_VOTE: 1,
  /** Legacy full-stint value retained for compatibility with old tests/clients; new scoring uses per-challenge survival. */
  POINT_IMPOSTOR_SURVIVES: 2,
  POINT_IMPOSTOR_SURVIVES_CHALLENGE: 1,
} as const;

export const TIMERS = {
  QUESTION_TO_ANSWERING: 2_500, // legacy TEXT_PAIR
  REVEAL_TO_DISCUSSION: 4_000, // legacy TEXT_PAIR
  COUNTDOWN: 5_000,
  ACTION: 1_000,
  /** After the synchronized action cue, give the group a full beat to look at each other before revealing the prompt. */
  HOLD: 5_000,
  PROMPT_REVEAL: 2_500,
  /** Public discussion window before voting begins automatically. */
  DISCUSSION: 45_000,
  /** Global ballot window. Missing ballots become abstentions at this deadline. */
  VOTING: 15_000,
  /** Hidden-result transition between survived Challenges in the same impostor stint. */
  SURVIVED_TRANSITION: 4_000,
  /** Full reveal window before the next stint/Challenge begins automatically. */
  FULL_RESULT: 20_000,
  /** Named owner authority transfers after this long without a live owner connection. */
  OWNER_TRANSFER_GRACE: 60_000,
  /** Unready disconnects expose one role-blind redeal recovery after this grace. */
  READY_DISCONNECT_GRACE: 30_000,
  // Legacy external-Host compatibility only. Named owners are real players and
  // use OWNER_TRANSFER_GRACE instead of pausing/closing the game clock.
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
