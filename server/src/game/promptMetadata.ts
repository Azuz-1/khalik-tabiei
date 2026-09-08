import type { GameMode } from "../../../shared/types.js";

export type PromptFamily =
  | "phone-messaging"
  | "sleep-energy"
  | "food-drink"
  | "travel-driving"
  | "shopping-money"
  | "home-routine"
  | "music-media"
  | "weather-outdoors"
  | "sports-games"
  | "social-gatherings"
  | "planning-time"
  | "personality-decisions"
  | "misc";

export type PromptQualityFlag =
  | "HIGH_CONSENSUS_RISK"
  | "CONTEXT_DEPENDENT"
  | "MEMORY_HEAVY"
  | "AMBIGUOUS_RESPONSE_RISK";

const FAMILY_PATTERNS: ReadonlyArray<readonly [PromptFamily, RegExp]> = [
  ["phone-messaging", /جوال|رسال|فويس|اتصال|مكالمة|إشعار|تطبيق|سوشيال|سكرين|شاحن|سماعات|قروب|إيموجي|أونلاين|يوتيوب/iu],
  ["sleep-energy", /نام|نوم|نايم|نمت|منبّه|غفوة|قيلولة|سهر|صحيت|تصحى|تعبان|طاقة|منتصف الليل/iu],
  ["food-drink", /أكل|مطعم|منيو|قهوة|شاهي|شاي|مويه|موية|مشروب|فطور|عشا|حلا|شطة|كبسة|مندي|بيتزا|ثلاجة|طبخ|بقالة|سوبرماركت|سناك/iu],
  ["shopping-money", /تسوق|اشتريت|شريت|شراء|خصم|سلة|عرض|هدية|كراتين/iu],
  ["travel-driving", /سفر|رحلة|مطار|سيار|الطريق|طريق|خرائط|موقف|ركنت|زحمة|شاليه|مدينة|مكان جديد|الشباك/iu],
  ["home-routine", /غرفت|البيت|غسيل|صحون|ترتّب|ترتيب|كرسي ملابس|درج|مصعد|روتين|قائمة/iu],
  ["music-media", /أغنية|أغاني|موسيقى|فيلم|مسلسل|بودكاست|صور|صورة|ألبوم|بلاي ليست|حلقة|قريت|تقرأ|كتاب/iu],
  ["weather-outdoors", /مطر|الجو|بارد|البرد|البر|البحر|مشي|تمشون|تمشي/iu],
  ["sports-games", /مباراة|فريق|ملعب|بلايستيشن|سوني|لعبة|ألعاب|كمبيوتر/iu],
  ["planning-time", /موعد|تأخر|بدري|خطة|تخطط|جدول|تذكير|تذكرك|مواعيد|آخر لحظة|جاهز|الساعة/iu],
  ["social-gatherings", /أهلك|أصحاب|صاحبك|الشلة|جمعة|جمعات|مجلس|المجلس|ناس|ضيف|ضيوف|سالفة|نكتة|يضحك|تضحك|قصة|تتعرف|أسماء الناس/iu],
  ["personality-decisions", /تفضّل|تحب|تتحمّل|تقرر|قرار|رأيك|رأيه|عفوي|حدسك|هدوء|هادي|مغامرة|مفاجآت|يختار|اختار/iu],
];

const QUALITY_FLAGS_BY_ID: Readonly<Record<string, readonly PromptQualityFlag[]>> = {
  H08: ["HIGH_CONSENSUS_RISK"],
  H001: ["HIGH_CONSENSUS_RISK"],
  H006: ["HIGH_CONSENSUS_RISK"],
  H013: ["HIGH_CONSENSUS_RISK"],
  H018: ["HIGH_CONSENSUS_RISK"],
  H033: ["HIGH_CONSENSUS_RISK"],
  H041: ["HIGH_CONSENSUS_RISK"],
  H061: ["HIGH_CONSENSUS_RISK"],
  H100: ["HIGH_CONSENSUS_RISK"],
  H09: ["CONTEXT_DEPENDENT"],
  H035: ["CONTEXT_DEPENDENT"],
  H036: ["CONTEXT_DEPENDENT"],
  H037: ["CONTEXT_DEPENDENT"],
  H038: ["CONTEXT_DEPENDENT"],
  H039: ["CONTEXT_DEPENDENT"],
  H040: ["CONTEXT_DEPENDENT"],
  H043: ["CONTEXT_DEPENDENT"],
  H063: ["CONTEXT_DEPENDENT"],
  H073: ["CONTEXT_DEPENDENT"],
  H074: ["CONTEXT_DEPENDENT"],
  H075: ["CONTEXT_DEPENDENT", "AMBIGUOUS_RESPONSE_RISK"],

  P03: ["HIGH_CONSENSUS_RISK"],
  P06: ["HIGH_CONSENSUS_RISK"],
  P09: ["HIGH_CONSENSUS_RISK"],
  P001: ["HIGH_CONSENSUS_RISK"],
  P007: ["HIGH_CONSENSUS_RISK"],
  P010: ["HIGH_CONSENSUS_RISK"],
  P015: ["HIGH_CONSENSUS_RISK"],
  P016: ["HIGH_CONSENSUS_RISK"],
  P026: ["HIGH_CONSENSUS_RISK"],
  P039: ["HIGH_CONSENSUS_RISK"],
  P041: ["HIGH_CONSENSUS_RISK"],
  P046: ["HIGH_CONSENSUS_RISK"],
  P051: ["HIGH_CONSENSUS_RISK"],
  P054: ["HIGH_CONSENSUS_RISK"],
  P062: ["HIGH_CONSENSUS_RISK"],
  P072: ["HIGH_CONSENSUS_RISK"],
  P073: ["HIGH_CONSENSUS_RISK"],
  P086: ["HIGH_CONSENSUS_RISK"],
  P090: ["HIGH_CONSENSUS_RISK"],
  P091: ["HIGH_CONSENSUS_RISK"],
  P094: ["HIGH_CONSENSUS_RISK"],
  P095: ["HIGH_CONSENSUS_RISK"],

  N06: ["MEMORY_HEAVY"],
  N006: ["MEMORY_HEAVY"],
  N015: ["MEMORY_HEAVY"],
  N019: ["MEMORY_HEAVY"],
  N029: ["MEMORY_HEAVY"],
  N049: ["MEMORY_HEAVY"],
  N069: ["MEMORY_HEAVY"],
  N007: ["HIGH_CONSENSUS_RISK"],
  N012: ["HIGH_CONSENSUS_RISK"],
  N061: ["HIGH_CONSENSUS_RISK"],
  N074: ["HIGH_CONSENSUS_RISK"],
  N093: ["AMBIGUOUS_RESPONSE_RISK"],
  N099: ["AMBIGUOUS_RESPONSE_RISK"],
};

export const PROMPT_QUALITY_FLAGS: readonly PromptQualityFlag[] = [
  "HIGH_CONSENSUS_RISK",
  "CONTEXT_DEPENDENT",
  "MEMORY_HEAVY",
  "AMBIGUOUS_RESPONSE_RISK",
];

export function qualityFlagsForPrompt(id: string): PromptQualityFlag[] {
  return [...(QUALITY_FLAGS_BY_ID[id] ?? [])];
}

export function promptQualityWeight(
  flags: readonly PromptQualityFlag[] | undefined,
  participantCount: number,
): number {
  if (!flags?.length) return 1;

  const small = participantCount <= 3;
  const medium = participantCount <= 5;
  let weight = 1;

  for (const flag of new Set(flags)) {
    if (flag === "HIGH_CONSENSUS_RISK") weight *= small ? 0.08 : medium ? 0.35 : 0.65;
    if (flag === "CONTEXT_DEPENDENT") weight *= small ? 0.2 : medium ? 0.5 : 0.75;
    if (flag === "MEMORY_HEAVY") weight *= small ? 0.3 : medium ? 0.6 : 0.8;
    if (flag === "AMBIGUOUS_RESPONSE_RISK") weight *= small ? 0.15 : medium ? 0.45 : 0.7;
  }

  return Math.max(weight, 0.01);
}

export function classifyPromptFamily(text: string, _mode?: GameMode): PromptFamily {
  for (const [family, pattern] of FAMILY_PATTERNS) {
    if (pattern.test(text)) return family;
  }
  return "misc";
}

export function normalizePromptText(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, " ").trim();
}
