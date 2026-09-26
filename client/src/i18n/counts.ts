export function requiredVotesText(count: number): string {
  if (count === 1) return "صوت واحد";
  if (count === 2) return "صوتين";
  return `${count} أصوات`;
}

export function waitForPlayersText(count: number): string {
  if (count <= 0) return "ابدأ اللعبة";
  if (count === 1) return "ننتظر لاعب واحد";
  if (count === 2) return "ننتظر لاعبين";
  return `ننتظر ${count} لاعبين`;
}

export function voteCountText(count: number): string {
  if (count === 0) return "ما عليه أصوات";
  if (count === 1) return "صوت واحد";
  if (count === 2) return "صوتين";
  return `${count} أصوات`;
}

export function challengeCountText(count: number): string {
  if (count === 1) return "تحدّي واحد";
  if (count === 2) return "تحدّيين";
  return `${count} تحدّيات`;
}

/** Copy for the server-authoritative lobby stint cap (`room.impostorStintMax`). */
export function stintRuleText(max?: number): string {
  if (max === undefined) return "مدة دور المتخفي تعتمد على عدد اللاعبين.";
  if (max === 1) return "كل متخفي له تحدّي واحد.";
  return `كل متخفي يستمر حتى ينمسك أو يكمل ${challengeCountText(max)} كحد أقصى.`;
}
