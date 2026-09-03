import type { GameMode } from "../../../shared/types.js";
import { EXTRA_IMITATION_PROMPTS } from "./imitationPrompts.extra.js";

export interface ImitationPrompt {
  id: string;
  mode: GameMode;
  text: string;
  flags?: string[];
}

export const BASE_IMITATION_PROMPTS: ImitationPrompt[] = [
  { id: "H01", mode: "HANDS", text: "ارفع يدك إذا سبق ورجعت تتأكد إنك قفلت الباب أو السيارة." },
  { id: "H02", mode: "HANDS", text: "ارفع يدك إذا قلت «أنا بالطريق» وأنت للحين بالبيت." },
  { id: "H03", mode: "HANDS", text: "ارفع يدك إذا تفضل الشاي على القهوة." },
  { id: "H04", mode: "HANDS", text: "ارفع يدك إذا تحب الكزبرة." },
  { id: "H05", mode: "HANDS", text: "ارفع يدك إذا عندك رسالة ما رديت عليها من أسبوع أو أكثر." },
  { id: "H06", mode: "HANDS", text: "ارفع يدك إذا تحط أكثر من منبّه عشان تقوم." },
  { id: "H07", mode: "HANDS", text: "ارفع يدك إذا تسمع الفويسات بسرعة مضاعفة." },
  { id: "H08", mode: "HANDS", text: "ارفع يدك إذا قد فتحت رسالة وقلت برد عليها بعدين، وبعدها نسيت." },
  { id: "H09", mode: "HANDS", text: "ارفع يدك إذا سبق واشتريت شي من إعلان طلع لك في إنستغرام." },
  { id: "H10", mode: "HANDS", text: "ارفع يدك إذا تنام والجوال بيدك." },
  { id: "P01", mode: "POINT", text: "أشر على اللي ممكن ينام بنص الفيلم." },
  { id: "P02", mode: "POINT", text: "أشر على اللي لو دخلتم مطعم جديد بيطلب نفس الشي اللي طلبه واحد ثاني." },
  { id: "P03", mode: "POINT", text: "أشر على اللي بيرد على رسايلك بأسرع وقت." },
  { id: "P04", mode: "POINT", text: "أشر على اللي طلبه في المطعم دايم نفس الشي." },
  { id: "P05", mode: "POINT", text: "أشر على اللي لو دخل مقهى بيطلب أغرب شي بالمنيو." },
  { id: "P06", mode: "POINT", text: "أشر على اللي ممكن يوصل آخر واحد للموعد.", flags: ["HIGH_CONSENSUS_RISK"] },
  { id: "P07", mode: "POINT", text: "أشر على اللي بيحفظ كلمات الأغاني كاملة." },
  { id: "P08", mode: "POINT", text: "أشر على اللي لو انقطع النت أسبوع بيكون أهدى واحد فيكم." },
  { id: "P09", mode: "POINT", text: "أشر على اللي دايم معه شاحن.", flags: ["HIGH_CONSENSUS_RISK"] },
  { id: "P10", mode: "POINT", text: "أشر على اللي لو سولفتوا عن شي قديم بيتذكر التفاصيل كلها." },
  { id: "N01", mode: "NUMBER", text: "من آخر 5 أيام، كم يوم شربت قهوة؟" },
  { id: "N02", mode: "NUMBER", text: "من آخر 5 أيام، كم يوم قمت من أول منبّه؟" },
  { id: "N03", mode: "NUMBER", text: "من 0 إلى 5، قد إيش تحب الأكل الحار؟" },
  { id: "N04", mode: "NUMBER", text: "من آخر 5 أيام، كم يوم سويت رياضة ولو مشي؟" },
  { id: "N05", mode: "NUMBER", text: "من آخر 5 أيام، كم يوم كلمت أحد من أهلك مكالمة؟" },
  { id: "N06", mode: "NUMBER", text: "من آخر 5 مرات فتحت المتصفح، كم مرة نسيت ليش فتحته؟" },
  { id: "N07", mode: "NUMBER", text: "من آخر 5 ليالٍ، كم ليلة تابعت مسلسل أو فيلم؟" },
  { id: "N08", mode: "NUMBER", text: "من 0 إلى 5، قد إيش تصبر في الزحمة؟" },
  { id: "N09", mode: "NUMBER", text: "من آخر 5 أيام، كم يوم أكلت من برا؟" },
  { id: "N10", mode: "NUMBER", text: "من 0 إلى 5، قد إيش أنت شخص يخطط للسفر بدري؟" },
];

export const IMITATION_PROMPTS: ImitationPrompt[] = [
  ...BASE_IMITATION_PROMPTS,
  ...EXTRA_IMITATION_PROMPTS,
];
