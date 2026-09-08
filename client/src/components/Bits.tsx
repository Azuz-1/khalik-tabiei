import type { ClientView, RoundResult, VoteTallyEntry } from "../../../shared/types.js";
import { voteCountText } from "../i18n/counts.js";

export function VoteBoard({ rows, live = false }: { rows: VoteTallyEntry[]; live?: boolean }) {
  return (
    <div className="vote-board" data-count={rows.length} aria-live={live ? "polite" : undefined}>
      {rows.map((row) => (
        <div className="vote-card" key={row.uid} data-player-uid={row.uid}>
          <div className="vote-card-name">{row.name}</div>
          <div className="vote-card-count">
            <span className={`vote-count-value${live ? " live" : ""}`}>{voteCountText(row.votes)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

export function ResultBody({ result }: { result: RoundResult }) {
  if (!result.roundComplete) {
    return (
      <div className="stack" style={{ gap: 18 }}>
        <div className="verdict stack">
          <div className="big escaped">ما مسكتوه</div>
          <div className="subtitle center">نفس المتخفي مكمل…</div>
        </div>
      </div>
    );
  }

  const verdict = result.groupFound
    ? "مسكتوا المتخفي"
    : result.completionReason === "MATCH_END"
      ? "خلصت المباراة وما انمسك المتخفي"
      : "المتخفي نجا من دوره";
  const detail = result.completionReason === "MATCH_END"
    ? `انتهت المباراة في تحدّيه ${result.challengeIndex} من ${result.maxChallenges}`
    : `انتهى دوره في التحدّي ${result.challengeIndex} من ${result.maxChallenges}`;

  return (
    <div className="stack result-body" style={{ gap: 22 }}>
      <div className="verdict stack">
        <div className={`big ${result.groupFound ? "caught" : "escaped"}`}>
          {verdict}
        </div>
        <div className="subtitle center">المتخفي كان</div>
        <div className="impostor-name center">{result.impostorName}</div>
        <div className="pill-note" style={{ marginInline: "auto" }}>
          {detail}
        </div>
      </div>

      <div className="stack result-vote-section" style={{ gap: 12 }}>
        <div className="eyebrow center">الأصوات في آخر تحدّي</div>
        <VoteBoard rows={result.voteTally} />
      </div>
    </div>
  );
}

export function roundLabel(view: ClientView): string {
  const globalChallenge = view.room.completedChallenges + (view.room.phase === "RESULT" ? 0 : 1);
  const visibleChallenge = Math.min(view.room.targetChallenges, Math.max(1, globalChallenge));
  const base = `التحدّي ${visibleChallenge} من ${view.room.targetChallenges}`;
  const stint = view.challenge ? ` · المتخفي الحالي: ${view.challenge.index} من ${view.challenge.max}` : "";
  return `${base}${stint}`;
}
