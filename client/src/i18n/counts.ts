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
