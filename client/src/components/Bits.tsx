import type { ClientView, RoundResult, VoteTallyEntry } from "../../../shared/types.js";

export function VoteBoard({ rows, live = false }: { rows: VoteTallyEntry[]; live?: boolean }) {
  return (
    <div className="vote-board" data-count={rows.length} aria-live={live ? "polite" : undefined}>
      {rows.map((row) => (
        <div className="vote-card" key={row.uid} data-player-uid={row.uid}>
          <div className="vote-card-name">{row.name}</div>
          <div className="vote-card-count">
            <span className={`vote-count-value${live ? " live" : ""}`}>{row.votes}</span>
            <span className="vote-count-label">{row.votes === 1 ? "صوت" : "أصوات"}</span>
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

  return (
    <div className="stack result-body" style={{ gap: 22 }}>
      <div className="verdict stack">
        <div className={`big ${result.groupFound ? "caught" : "escaped"}`}>
          {result.groupFound ? "مسكتوا المتخفي" : "المتخفي نجا"}
        </div>
        <div className="subtitle center">المتخفي كان</div>
        <div className="impostor-name center">{result.impostorName}</div>
        <div className="pill-note" style={{ marginInline: "auto" }}>
          انتهت الجولة في التحدّي {result.challengeIndex} من {result.maxChallenges}
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
  const challenge = view.challenge ? ` · تحدّي ${view.challenge.index}/${view.challenge.max}` : "";
  return `جولة ${view.room.currentRound} من ${view.room.totalRounds}${challenge}`;
}
