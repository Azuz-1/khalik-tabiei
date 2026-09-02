import type { ClientView, RoundResult } from "../../../shared/types.js";

export function ResultBody({ result }: { result: RoundResult }) {
  if (!result.roundComplete) {
    return (
      <div className="stack" style={{ gap: 18 }}>
        <div className="verdict stack">
          <div className="big escaped">ما مسكتوه 👀</div>
          <div className="subtitle center">نفس المتخفي مكمل…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="verdict stack">
        <div className={`big ${result.groupFound ? "caught" : "escaped"}`}>
          {result.groupFound ? "✅ مسكتوا المتخفي" : "😈 المتخفي نجا"}
        </div>
        <div className="subtitle center">المتخفي كان</div>
        <div className="impostor-name center">{result.impostorName}</div>
        <div className="pill-note" style={{ marginInline: "auto" }}>
          انتهت في التحدي {result.challengeIndex}/{result.maxChallenges}
        </div>
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <div className="eyebrow">الأصوات في التحدي الحاسم</div>
        {result.voteTally.map((row) => (
          <div key={row.uid} className="row between" style={{ fontWeight: 800 }}>
            <span>{row.name}</span>
            <span style={{ color: "var(--violet-2)" }}>
              {row.votes} {row.votes === 1 ? "صوت" : "أصوات"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function roundLabel(view: ClientView): string {
  const challenge = view.challenge
    ? ` · تحدي ${view.challenge.index}/${view.challenge.max}`
    : "";
  return `جولة ${view.room.currentRound} من ${view.room.totalRounds}${challenge}`;
}
