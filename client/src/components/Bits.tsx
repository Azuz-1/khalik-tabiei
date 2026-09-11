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
          <div className="big escaped">المتخفي نجا 👀</div>
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
        <div className="subtitle center">صوّت {result.votesCast} من {result.participantCount}</div>
        <VoteBoard rows={result.voteTally ?? []} />
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
