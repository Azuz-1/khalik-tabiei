import type { ErrorCode } from "../../../shared/types.js";

/** Maps server error codes to natural Saudi Arabic, player-facing copy. */
export const ERROR_AR: Record<ErrorCode, string> = {
  ROOM_NOT_FOUND: "ما لقينا غرفة بهذا الكود 👀",
  ROOM_FULL: "الغرفة فلّت 😅",
  ROOM_CLOSED: "الغرفة مقفلة",
  ROOM_NOT_IN_LOBBY: "اللعبة بدأت، ما تقدر تدخل الحين",
  DUPLICATE_NAME: "فيه واحد نفس اسمك بالغرفة، غيّره شوي",
  INVALID_NAME: "الاسم لازم يكون بين حرفين و ١٦ حرف",
  NOT_HOST: "هذي للمضيف بس",
  NOT_PLAYER: "لازم تكون داخل الغرفة",
  ALREADY_IN_ROOM: "انت أصلاً داخل غرفة",
  NOT_IN_ROOM: "ما انت داخل غرفة",
  ANSWER_ALREADY_SUBMITTED: "أرسلت إجابتك من قبل",
  VOTE_ALREADY_SUBMITTED: "صوّتت من قبل",
  INVALID_ANSWER: "اكتب إجابة قصيرة وواضحة",
  INVALID_VOTE: "التصويت غير صحيح",
  INVALID_PHASE: "الحركة هذي مو وقتها الحين",
  NOT_ENOUGH_PLAYERS: "نحتاج ٣ لاعبين على الأقل",
  NO_CATEGORY_SELECTED: "اختر تصنيف واحد على الأقل",
  KICKED: "تم إخراجك من الغرفة",
  RATE_LIMITED: "بروية شوي 🙂",
  BAD_REQUEST: "صار خطأ بسيط، جرّب مرة ثانية",
  UNAUTHORIZED: "فيه مشكلة بالجلسة، حدّث الصفحة",
  INTERNAL: "صار خطأ عندنا، جرّب مرة ثانية",
};

export function errorText(code: ErrorCode): string {
  return ERROR_AR[code] ?? "صار خطأ، جرّب مرة ثانية";
}
