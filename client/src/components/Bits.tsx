import type { ClientView, RoundResult, ScoreboardRow } from "../../../shared/types.js";

export function Scoreboard({ rows, selfUid }: { rows: ScoreboardRow[]; selfUid?: string }) {
  return (
    <div className="scoreboard">
      {rows.map((r) => (
        <div key={r.uid} className={`score-row${r.rank === 1 ? " first" : ""}`}>
          <span className="rank">{r.rank === 1 ? "🏆" : r.rank}</span>
          <span className="nm">
            {r.name}
            {r.uid === selfUid ? " (أنت)" : ""}
          </span>
          <span className="pts">{r.score}</span>
        </div>
      ))}
    </div>
  );
}

/** The dramatic reveal body: verdict, impostor, both questions, and individual votes. */
export function ResultBody({ result }: { result: RoundResult }) {
  const caught = result.groupFound;
  return (
    <div className="stack" style={{ gap: 22 }}>
      <div className="verdict stack">
        <div className={`big ${caught ? "caught" : "escaped"}`}>{caught ? "انكشف! 😈" : "عدّت عليه 😎"}</div>
        <div className="subtitle center">المتخفي كان</div>
        <div className="impostor-name center">{result.impostorName}</div>
      </div>

      <div className="qpair">
        <div className="qrow">
          <div className="lbl">سؤال المجموعة</div>
          <div className="val">{result.normalQuestion}</div>
        </div>
        <div className="qrow" style={{ borderColor: "rgba(217,70,239,0.4)" }}>
          <div className="lbl" style={{ color: "var(--pink)" }}>سؤال المتخفي</div>
          <div className="val">{result.impostorQuestion}</div>
        </div>
      </div>

      {result.voteBreakdown.length > 0 ? (
        <div className="stack" style={{ gap: 10 }}>
          <div className="eyebrow">مين صوّت لمين؟</div>
          {result.voteBreakdown.map((vote) => {
            const status = vote.voterWasImpostor
              ? "المتخفي"
              : vote.correct
                ? vote.points > 0 ? `صح ✓ +${vote.points}` : "اختيار صح ✓ بدون نقطة"
                : "غلط ✕";
            return (
              <div key={vote.voterUid} className="card" style={{ padding: 12 }}>
                <div className="row between" style={{ gap: 12 }}>
                  <span style={{ fontWeight: 900 }}>{vote.voterName} صوّت لـ {vote.targetName}</span>
                  <span className="pill-note">{status}</span>
                </div>
              </div>
            );
          })}
          {!caught ? (
            <p className="helper center">إذا تعادل أعلى تصويت أو راح لشخص ثاني، المتخفي ينجو وياخذ +2.</p>
          ) : null}
        </div>
      ) : null}

      {result.voteTally.length > 0 ? (
        <div className="stack" style={{ gap: 8 }}>
          <div className="eyebrow">مجموع الأصوات</div>
          {result.voteTally.map((v) => (
            <div key={v.uid} className="row between" style={{ fontWeight: 800 }}>
              <span>{v.name}</span>
              <span style={{ color: "var(--violet-2)" }}>
                {v.votes} {v.votes === 1 ? "صوت" : "أصوات"}
              </span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function roundLabel(view: ClientView): string {
  return `جولة ${view.room.currentRound} من ${view.room.totalRounds}`;
}
