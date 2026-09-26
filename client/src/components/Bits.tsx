import type { GameOverInfo, PublicPlayer, RoundResult, ScoreEntry, VoteTallyEntry } from "../../../shared/types.js";
import { voteCountText } from "../i18n/counts.js";
import { roundDeltaText, scoreReasonText } from "../i18n/score.js";
import { Avatar, colorSlotLookup } from "../ui/Avatar.js";
import { Icon } from "../ui/Icon.js";
import { StageTimer } from "../ui/StageTimer.js";

/** Authoritative phase deadline, rendered by the shared stage timer. */
export function PhaseCountdown({
  endsAt,
  totalMs,
  variant = "pill",
  warningAtSeconds,
  warningText,
  urgent,
}: {
  endsAt: number | undefined;
  totalMs?: number;
  variant?: "pill" | "ring";
  warningAtSeconds?: number;
  warningText?: string;
  urgent?: boolean;
}) {
  return (
    <StageTimer
      urgent={urgent}
      endsAt={endsAt}
      totalMs={totalMs}
      variant={variant}
      warningAtSeconds={warningAtSeconds}
      warningText={warningText}
    />
  );
}

type SlotOf = (uid: string) => number | undefined;

/** Settled aggregate only (name + count). Never rendered during VOTING. */
export function VoteBoard({ rows, slotOf }: { rows: VoteTallyEntry[]; slotOf?: SlotOf }) {
  const max = Math.max(1, ...rows.map((row) => row.votes));
  const ordered = [...rows].sort((a, b) => b.votes - a.votes);
  return (
    <ul className="vote-board result-vote-board" data-count={rows.length}>
      {ordered.map((row) => (
        <li className={`result-vote-row${row.votes === 0 ? " is-zero" : ""}`} key={row.uid} data-player-uid={row.uid}>
          <Avatar name={row.name} colorSlot={slotOf?.(row.uid)} size="sm" />
          <span className="vote-card-name" dir="auto">{row.name}</span>
          <span className="vote-bar" aria-hidden="true"><i style={{ inlineSize: `${(row.votes / max) * 100}%` }} /></span>
          <span className="vote-card-count">{voteCountText(row.votes)}</span>
        </li>
      ))}
    </ul>
  );
}

function verdictFor(result: RoundResult): { title: string; tone: "caught" | "escaped" | "match-end" } {
  if (result.groupFound) return { title: "مسكتوا المتخفي!", tone: "caught" };
  if (result.completionReason === "MATCH_END") return { title: "خلصت المباراة وما انمسك", tone: "match-end" };
  return { title: "المتخفي نجا من دوره", tone: "escaped" };
}

/**
 * RESULT hero. Intermediate survival never carries identity (the server omits
 * it), so it stays light and anonymous. A completed stint is the payoff.
 */
export function ResultBody({
  result,
  players = [],
  showTally = true,
}: {
  result: RoundResult;
  players?: PublicPlayer[];
  showTally?: boolean;
}) {
  const slotOf = colorSlotLookup(players);

  if (!result.roundComplete) {
    return (
      <section className="result result-survived" aria-labelledby="result-title">
        <div className="result-kicker">نتيجة التحدّي</div>
        <div className="result-survived-mark" aria-hidden="true"><Icon name="eye-off" /></div>
        <h1 id="result-title" className="result-title escaped">المتخفي نجا</h1>
        <p className="result-subtitle">ما انكشف… نكمل التحدّي الجاي بمطلوب جديد.</p>
        <div className="result-stint" aria-label={`دور المتخفي ${result.challengeIndex} من ${result.maxChallenges}`}>
          <span className="mp-pips" aria-hidden="true">
            {Array.from({ length: result.maxChallenges }, (_, index) => (
              <i key={index} className={index < result.challengeIndex ? "done" : undefined} />
            ))}
          </span>
          <span>دور المتخفي {result.challengeIndex} من {result.maxChallenges}</span>
        </div>
      </section>
    );
  }

  const verdict = verdictFor(result);
  const turnout = result.votesCast !== undefined && result.participantCount !== undefined
    ? `صوّت ${result.votesCast} من ${result.participantCount}`
    : undefined;
  const name = result.impostorName ?? "—";

  return (
    <section className={`result result-complete is-${verdict.tone}`} aria-labelledby="result-title">
      <div className="result-kicker">نتيجة دور المتخفي</div>
      <h1 id="result-title" className={`result-title ${verdict.tone === "caught" ? "caught" : "escaped"}`}>{verdict.title}</h1>
      <div className="result-reveal">
        <span className="result-avatar">
          <Avatar name={name} colorSlot={result.impostorUid ? slotOf(result.impostorUid) : undefined} size="xl" />
          <span className="result-avatar-mask" aria-hidden="true"><Icon name="mask" /></span>
        </span>
        <div className="result-impostor-label">المتخفي كان</div>
        <div className="result-impostor-name" dir="auto">{name}</div>
      </div>
      <div className="result-meta">
        <span className="tag">دور المتخفي {result.challengeIndex} من {result.maxChallenges}</span>
        {turnout ? <span className="tag">{turnout}</span> : null}
      </div>
      {showTally && (result.voteTally?.length ?? 0) > 0 ? (
        <div className="result-vote-section">
          <h2 className="section-label">الأصوات</h2>
          <VoteBoard rows={result.voteTally ?? []} slotOf={slotOf} />
        </div>
      ) : null}
    </section>
  );
}

function DeltaChip({ delta }: { delta?: number }) {
  const value = delta ?? 0;
  return <span className={`score-delta${value > 0 ? "" : " is-zero"}`}>{roundDeltaText(value)}</span>;
}

/** Ranked score list. Reasons come only from the server's ScoreReason. */
export function Scoreboard({
  rows,
  players = [],
  selfUid,
  round = false,
  title,
}: {
  rows: ScoreEntry[];
  players?: PublicPlayer[];
  selfUid?: string;
  round?: boolean;
  title?: string;
}) {
  const slotOf = colorSlotLookup(players);
  return (
    <section className="scoreboard score-explain-board" aria-label={title ?? (round ? "النقاط بعد دور المتخفي" : "الترتيب النهائي")}>
      <h2 className="section-label">{title ?? (round ? "النقاط بعد دور المتخفي" : "الترتيب النهائي")}</h2>
      <ol className="score-list">
        {rows.map((row) => {
          const self = row.uid === selfUid;
          return (
            <li key={row.uid} className={`score-row score-explain-row${self ? " self" : ""}${row.rank === 1 ? " is-first" : ""}`}>
              <span className="score-rank num-ltr" aria-label={`المركز ${row.rank}`}>{row.rank}</span>
              <Avatar name={row.name} colorSlot={slotOf(row.uid)} size="sm" />
              <span className="score-who">
                <span className="score-name" dir="auto">{row.name}{self ? <span className="score-self"> · أنت</span> : null}</span>
                {round ? <span className="score-reason">{scoreReasonText(row.roundReason)}</span> : null}
              </span>
              {round ? <DeltaChip delta={row.roundDelta} /> : null}
              <span className="score-total"><b className="num-ltr">{row.score}</b> نقطة</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/** Personal takeaway on the phone: what this stint meant for me. */
export function MyScoreCallout({ rows, selfUid }: { rows: ScoreEntry[]; selfUid: string }) {
  const mine = rows.find((row) => row.uid === selfUid);
  if (!mine) return null;
  const delta = mine.roundDelta ?? 0;
  return (
    <div className={`my-score${delta > 0 ? " is-positive" : ""}`}>
      <span className="my-score-delta num-ltr">{roundDeltaText(delta)}</span>
      <span className="my-score-text">
        <strong>{delta > 0 ? "كسبت نقاط في هالدور" : "ما كسبت نقاط في هالدور"}</strong>
        {mine.roundReason ? <span>{scoreReasonText(mine.roundReason)}</span> : null}
      </span>
      <span className="my-score-total">المجموع <b className="num-ltr">{mine.score}</b></span>
    </div>
  );
}

export function GameOverStats({ gameOver }: { gameOver: GameOverInfo }) {
  return (
    <>
      <p className="gameover-summary">لعبتوا {gameOver.completedChallenges} تحدّيات · مسكتوا المتخفي في {gameOver.caughtRounds} من {gameOver.totalRounds} أدوار متخفي</p>
      <dl className="gameover-stats">
        <div><dt>انمسك</dt><dd className="num-ltr">{gameOver.caughtRounds}</dd></div>
        <div><dt>نجا من دوره كامل</dt><dd className="num-ltr">{gameOver.completedEscapeRounds ?? gameOver.escapedRounds}</dd></div>
        {(gameOver.matchEndedUncaughtRounds ?? 0) > 0 ? (
          <div><dt>خلصت المباراة وهو ما انمسك</dt><dd className="num-ltr">{gameOver.matchEndedUncaughtRounds}</dd></div>
        ) : null}
      </dl>
    </>
  );
}

/** Top rank(s) for the final moment. Ties share the spotlight. */
export function Winners({ rows, players = [] }: { rows: ScoreEntry[]; players?: PublicPlayer[] }) {
  const slotOf = colorSlotLookup(players);
  const top = rows.filter((row) => row.rank === 1);
  if (top.length === 0) return null;
  return (
    <div className="winners">
      <div className="winners-label"><Icon name="crown" /> المركز الأول</div>
      <div className="winners-list">
        {top.map((row) => (
          <div key={row.uid} className="winner">
            <Avatar name={row.name} colorSlot={slotOf(row.uid)} size="lg" />
            <span className="winner-name" dir="auto">{row.name}</span>
            <span className="winner-score"><b className="num-ltr">{row.score}</b> نقطة</span>
          </div>
        ))}
      </div>
    </div>
  );
}
