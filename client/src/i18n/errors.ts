import type { ErrorCode } from "../../../shared/types.js";

export const ERROR_AR: Record<ErrorCode, string> = {
  ROOM_NOT_FOUND: "ما لقينا غرفة بهالكود",
  ROOM_FULL: "الغرفة ممتلئة الحين",
  ROOM_CLOSED: "الغرفة مقفلة",
  ROOM_NOT_IN_LOBBY: "اللعبة بدأت، ما تقدر تدخل الحين",
  ROOM_LOCKED: "المضيف موقف دخول لاعبين جدد الحين",
  DUPLICATE_NAME: "فيه لاعب بنفس الاسم، غيّره شوي",
  INVALID_NAME: "اسمك لازم يكون من حرفين إلى ١٦ حرف",
  NOT_HOST: "هذي الخطوة للمضيف بس",
  NOT_PLAYER: "لازم تدخل الغرفة أول",
  ALREADY_IN_ROOM: "أنت داخل غرفة أصلًا",
  NOT_IN_ROOM: "أنت مو داخل غرفة",
  ANSWER_ALREADY_SUBMITTED: "إجابتك مسجّلة من قبل",
  VOTE_ALREADY_SUBMITTED: "تصويتك مسجّل من قبل",
  INVALID_ANSWER: "اكتب إجابة قصيرة وواضحة",
  INVALID_VOTE: "ما قدرنا نسجّل هالتصويت، جرّب مرة ثانية",
  INVALID_PHASE: "هذي الخطوة مو وقتها الحين",
  NOT_ENOUGH_PLAYERS: "نحتاج ٣ لاعبين على الأقل عشان نبدأ",
  NO_CATEGORY_SELECTED: "اختر تصنيف واحد على الأقل",
  NO_MODE_SELECTED: "اختر طريقة لعب واحدة على الأقل",
  KICKED: "المضيف طلعك من الغرفة",
  RATE_LIMITED: "شوي شوي، جرّب بعد لحظة",
  BAD_REQUEST: "ما ضبطت، جرّب مرة ثانية",
  UNAUTHORIZED: "حدّث الصفحة وجرّب مرة ثانية",
  SERVER_RESTARTING: "الخادم يعاد تشغيله الآن؛ انتظر شوي قبل تبدأ لعبة جديدة",
  INTERNAL: "صار خطأ عندنا، جرّب مرة ثانية",
};

export function errorText(code: ErrorCode): string {
  return ERROR_AR[code] ?? "صار خطأ، جرّب مرة ثانية";
}
