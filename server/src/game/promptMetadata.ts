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

export function classifyPromptFamily(text: string, _mode?: GameMode): PromptFamily {
  for (const [family, pattern] of FAMILY_PATTERNS) {
    if (pattern.test(text)) return family;
  }
  return "misc";
}

export function normalizePromptText(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, " ").trim();
}
