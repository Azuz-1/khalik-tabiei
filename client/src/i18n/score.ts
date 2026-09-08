import type { ScoreReason } from "../../../shared/types.js";

function streakText(count: number): string {
  if (count <= 0) return "ما عنده سلسلة تصويت صحيحة في النهاية";
  if (count === 1) return "صح في آخر تصويت";
  if (count === 2) return "صح في آخر تصويتين";
  return `صح في آخر ${count} تصويتات`;
}

function survivalText(count: number): string {
  if (count <= 0) return "انمسك قبل ما ينجو من أي تحدّي";
  if (count === 1) return "نجا من تحدّي واحد";
  if (count === 2) return "نجا من تحدّيين";
  return `نجا من ${count} تحدّيات`;
}

export function scoreReasonText(reason?: ScoreReason): string {
  if (!reason) return "";
  switch (reason.kind) {
    case "NORMAL_CORRECT_STREAK": return streakText(reason.count);
    case "IMPOSTOR_SURVIVAL": return survivalText(reason.count);
    case "NOT_PARTICIPATING": return "ما شارك في دور المتخفي هذا";
  }
}

export function roundDeltaText(delta = 0): string {
  return delta > 0 ? `+${delta}` : "0";
}
