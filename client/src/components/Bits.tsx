import { useEffect, useState } from "react";
import type { ClientView, RoundResult, VoteTallyEntry } from "../../../shared/types.js";
import { voteCountText } from "../i18n/counts.js";
import { estimatedServerNow } from "../net/clock.js";

function secondsUntil(endsAt: number | undefined): number | null {
  if (endsAt === undefined) return null;
  return Math.max(0, Math.ceil((endsAt - estimatedServerNow()) / 1_000));
}

export function PhaseCountdown({
  endsAt,
  warningAtSeconds,
  warningText,
}: {
  endsAt: number | undefined;
  warningAtSeconds?: number;
  warningText?: string;
}) {
  const [seconds, setSeconds] = useState<number | null>(() => secondsUntil(endsAt));

  useEffect(() => {
    setSeconds(secondsUntil(endsAt));
    if (endsAt === undefined) return;
    const timer = window.setInterval(() => setSeconds(secondsUntil(endsAt)), 200);
    return () => window.clearInterval(timer);
  }, [endsAt]);

  if (seconds === null) return null;
  const showWarning =
    warningAtSeconds !== undefined &&
    warningText !== undefined &&
    seconds > 0 &&
    seconds <= warningAtSeconds;

  return (
    <div className="card center stack" style={{ gap: 8 }} data-testid="phase-countdown">
      <div className="eyebrow">الوقت المتبقي</div>
      <div className="big num-ltr" aria-label={`${seconds} ثانية`}>{seconds} ث</div>
      {showWarning ? <div className="pill-note" role="status"><strong>{warningText}</strong></div> : null}
    </div>
  );
}

export function VoteBoard({ rows, live = false }: { rows: VoteTallyEntry[]; live?: boolean }) {
  return (
    <div className="vote-board result-vote-board" data-count={rows.length} aria-live={live ? "polite" : undefined}>
      {rows.map((row) => (
        <div className="vote-card result-vote-row" key={row.uid} data-player-uid={row.uid}>
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
      <div className="result-stage result-stage-survived center stack">
        <div className="result-icon" aria-hidden="true">👀</div>
        <div className="result-kicker">نتيجة التحدّي</div>
        <div className="result-title escaped">المتخفي نجا</div>
        <p className="result-subtitle">ما انكشف للحين… ركّزوا أكثر في التحدّي الجاي.</p>
      </div>
    );
  }

  const verdict = result.groupFound
    ? "مسكتوا المتخفي!"
    : result.completionReason === "MATCH_END"
      ? "خلصت المباراة وما انمسك"
      : "المتخفي نجا من دوره";
  const detail = result.completionReason === "MATCH_END"
    ? `انتهت المباراة في تحدّيه ${result.challengeIndex} من ${result.maxChallenges}`
    : `انتهى دوره في التحدّي ${result.challengeIndex} من ${result.maxChallenges}`;
  const turnout = result.votesCast !== undefined && result.participantCount !== undefined
    ? `صوّت ${result.votesCast} من ${result.participantCount}`
    : undefined;

  return (
    <div className={`result-stage stack${result.groupFound ? " is-caught" : " is-escaped"}`}>
      <div className="result-hero center stack">
        <div className="result-icon" aria-hidden="true">{result.groupFound ? "🎭" : "👀"}</div>
        <div className="result-kicker">نتيجة دور المتخفي</div>
        <div className={`result-title ${result.groupFound ? "caught" : "escaped"}`}>{verdict}</div>
        <div className="result-impostor-label">المتخفي كان</div>
        <div className="result-impostor-name">{result.impostorName}</div>
        <div className="result-meta" aria-label={detail}>
          <span>{detail}</span>
          {turnout ? <span className="result-meta-dot" aria-hidden="true">•</span> : null}
          {turnout ? <span>{turnout}</span> : null}
        </div>
      </div>

      {(result.voteTally?.length ?? 0) > 0 ? (
        <div className="result-vote-section stack">
          <div className="result-section-head row between">
            <span className="eyebrow">الأصوات</span>
            {turnout ? <span className="result-turnout">{turnout}</span> : null}
          </div>
          <VoteBoard rows={result.voteTally ?? []} />
        </div>
      ) : null}
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
