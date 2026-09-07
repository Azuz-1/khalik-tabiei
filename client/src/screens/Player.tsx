import { useEffect, useState } from "react";
import type {
  ClientView,
  FeedbackIssueReason,
  FeedbackRating,
  GameModeInfo,
  ScoreEntry,
} from "../../../shared/types.js";
import { visibleCountdownSecond } from "../audio/hostAudioEvents.js";
import { estimatedServerNow } from "../net/clock.js";
import { actions } from "../net/socket.js";
import { ResultBody, roundLabel } from "../components/Bits.js";
import { Players } from "../components/Players.js";

export function Player({ view }: { view: ClientView }) {
  switch (view.room.phase) {
    case "LOBBY": return <PlayerLobby view={view} />;
    case "QUESTION": return <PlayerPrompt view={view} />;
    case "COUNTDOWN": return <PlayerCountdown view={view} />;
    case "ACTION": return <PlayerAction view={view} />;
    case "HOLD": return <PlayerHold />;
    case "PROMPT_REVEAL": return <PlayerPromptReveal view={view} />;
    case "DISCUSSION": return <PlayerDiscussion view={view} />;
    case "VOTING": return <PlayerVote view={view} />;
    case "RESULT": return <PlayerResult view={view} />;
    case "GAME_OVER": return <PlayerGameOver view={view} />;
    default: return <PlayerWatchScreen />;
  }
}

function modeInfo(view: ClientView): GameModeInfo | undefined {
  return view.room.availableModes.find((candidate) => candidate.id === view.challenge?.mode);
}

function modeTitle(view: ClientView): string {
  const mode = modeInfo(view);
  return mode ? `${mode.icon} ${mode.label}` : "";
}

function PlayerScoreboard({ rows, selfUid, round }: { rows: ScoreEntry[]; selfUid: string; round?: boolean }) {
  return (
    <div className="card stack" style={{ width: "100%" }}>
      <div className="code-label">{round ? "النقاط بعد دور المتخفي" : "الترتيب النهائي"}</div>
      {rows.map((row) => (
        <div key={row.uid} className="row between" style={{ fontWeight: row.uid === selfUid ? 900 : 700 }}>
          <span>#{row.rank} {row.name}{row.uid === selfUid ? " — أنت" : ""}</span>
          <span>{row.score} نقطة{round && (row.roundDelta ?? 0) > 0 ? ` (+${row.roundDelta})` : ""}</span>
        </div>
      ))}
    </div>
  );
}

function PlayerLobby({ view }: { view: ClientView }) {
  const selectedModes = view.room.availableModes.filter((mode) => view.room.selectedModes.includes(mode.id));
  return (
    <div className="screen">
      <div className="spacer" />
      <div className="center stack">
        <h1 className="title" style={{ fontSize: "clamp(30px,9vw,44px)" }}>أنت داخل 🎉</h1>
        <span className="pill-note" style={{ direction: "ltr", marginInline: "auto" }}>غرفة {view.room.code}</span>
        <span className="chip">🏅 منافسة بالنقاط</span>
        <p className="subtitle">{view.room.targetChallenges} تحديات أساسية، ونكمّل دور آخر متخفي. الأغلبية تمسكه، وكل لاعب يجمع نقاطه بنفسه.</p>
        <div className="players">{selectedModes.map((mode) => <span className="chip" key={mode.id}>{mode.icon} {mode.label}</span>)}</div>
      </div>
      <div className="card">
        <div className="code-label" style={{ marginBottom: 10 }}>اللاعبين ({view.players.length})</div>
        <Players players={view.players} selfUid={view.self.uid} />
      </div>
      <div className="spacer" />
    </div>
  );
}

function PlayerPrompt({ view }: { view: ClientView }) {
  if (view.myReady === undefined) return <PlayerWaitNext />;
  const ready = view.myReady === true;
  const mode = modeInfo(view);
  if (ready) return <PlayerReadyWaiting />;
  return (
    <div className="screen">
      <div className="center"><div className="eyebrow">{roundLabel(view)}</div></div>
      <div className="spacer" />
      <div className="q-card stack">
        <span className="eyebrow">{modeTitle(view)}</span>
        {view.isImpostor ? (
          <>
            <div className="q-text">أنت المتخفي</div>
            <p className="subtitle center" style={{ marginBottom: 0 }}>ما تعرف المطلوب.</p>
            <p className="subtitle center" style={{ marginTop: 0 }}>{mode?.impostorInstruction ?? "راقب الباقين وخلك طبيعي."}</p>
          </>
        ) : (
          <>
            <span className="eyebrow">المطلوب</span>
            <div className="q-text">{view.myPrompt?.text ?? "…"}</div>
            <p className="subtitle center" style={{ marginBottom: 0 }}>{mode?.normalInstruction}</p>
          </>
        )}
      </div>
      <button className="btn btn-primary" onClick={() => actions.markReady()}>جاهز</button>
      <div className="spacer" />
    </div>
  );
}

function PlayerReadyWaiting() {
  return (
    <div className="screen center stack">
      <div className="spacer" />
      <div className="ok-badge">جاهز ✓</div>
      <h1 className="title" style={{ fontSize: "clamp(30px,9vw,44px)" }}>ننتظر الباقين</h1>
      <p className="subtitle">إذا بدأ العد، بيظهر هنا وعلى الشاشة.</p>
      <div className="spacer" />
    </div>
  );
}

function PlayerWaitNext() {
  return (
    <div className="screen center stack">
      <div className="spacer" />
      <h1 className="title" style={{ fontSize: "clamp(30px,9vw,44px)" }}>انتظر الدور الجاي</h1>
      <p className="subtitle">أنت مو مشارك في دور المتخفي الحالي. مكانك محفوظ وبتدخل مع الدور الجاي.</p>
      <div className="spacer" />
    </div>
  );
}

function PlayerCountdown({ view }: { view: ClientView }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((value) => value + 1), 100);
    return () => window.clearInterval(id);
  }, []);
  const seconds = visibleCountdownSecond(view.room.phaseEndsAt, estimatedServerNow()) ?? 1;
  const mode = modeInfo(view);
  return (
    <div className="screen center stack player-cue-screen">
      <div className="eyebrow">استعد…</div>
      <div className="player-countdown-number">{seconds}</div>
      <div className="title center" style={{ fontSize: "clamp(22px,7vw,32px)" }}>{mode?.icon} {mode?.label}</div>
    </div>
  );
}

function PlayerAction({ view }: { view: ClientView }) {
  return (
    <div className="screen center stack player-cue-screen">
      <h1 className="title player-action-title">{modeInfo(view)?.actionLabel ?? "الحين!"}</h1>
    </div>
  );
}

function PlayerHold() {
  return (
    <div className="screen center stack player-cue-screen">
      <h1 className="title player-action-title">ثبّتوا…</h1>
      <p className="subtitle">طالعوا بعض</p>
    </div>
  );
}

function PlayerWatchScreen() {
  return <div className="screen center stack"><div className="spacer" /><h1 className="title" style={{ fontSize: "clamp(38px,11vw,58px)" }}>طالع الشاشة</h1><div className="spacer" /></div>;
}

function PlayerPromptReveal({ view }: { view: ClientView }) {
  return <div className="screen center stack"><div className="spacer" /><div className="eyebrow">المطلوب كان…</div><div className="q-text">{view.publicPrompt?.text ?? "…"}</div><div className="spacer" /></div>;
}

function PlayerDiscussion({ view }: { view: ClientView }) {
  return (
    <div className="screen">
      <div className="center"><div className="eyebrow">{roundLabel(view)}</div></div>
      <div className="spacer" />
      <div className="q-card stack"><span className="eyebrow">المطلوب كان</span><div className="q-text" style={{ fontSize: "clamp(22px,6vw,30px)" }}>{view.publicPrompt?.text ?? "…"}</div></div>
      <h2 className="title center" style={{ fontSize: "clamp(28px,8vw,42px)" }}>مين تصرفه مو طبيعي؟</h2>
      <p className="subtitle center">تناقشوا، وبعدها المضيف يفتح التصويت</p>
      <div className="spacer" />
    </div>
  );
}

function PlayerVote({ view }: { view: ClientView }) {
  const [picked, setPicked] = useState<string | null>(null);
  const targets = view.voteTargets ?? [];
  const progress = view.votesProgress ?? { submitted: 0, total: 0, requiredVotes: 0 };

  useEffect(() => {
    if (picked && !targets.some((target) => target.uid === picked)) setPicked(null);
  }, [picked, targets]);

  if (view.voteTargets === undefined && view.myVoteSubmitted === undefined) return <PlayerWatchScreen />;

  if (view.myVoteSubmitted) {
    return (
      <div className="screen">
        <div className="spacer" />
        <div className="center stack">
          <div className="ok-badge">تم تسجيل صوتك</div>
          <p className="subtitle">ننتظر الباقين… <span className="num-ltr">{progress.submitted}/{progress.total}</span></p>
          <p className="helper center">نقاطك وتوزيع الأصوات ما تنكشف إلا بعد نهاية دور المتخفي.</p>
        </div>
        <div className="spacer" />
      </div>
    );
  }

  return (
    <div className="screen">
      <div className="center stack">
        <div className="eyebrow">{roundLabel(view)}</div>
        <h1 className="title">مين تحس إنه المتخفي؟</h1>
        {progress.requiredVotes > 0 ? <p className="helper">يحتاج {progress.requiredVotes} أصوات عشان ينمسك. تصويتك الشخصي يدخل في نقاطك بعد نهاية دوره.</p> : null}
      </div>
      <div className="vote-list" role="radiogroup" aria-label="اختر الشخص اللي تحس إنه المتخفي">
        {targets.map((target) => {
          const selected = picked === target.uid;
          return (
            <button key={target.uid} type="button" role="radio" aria-checked={selected} className={`vote-opt${selected ? " picked" : ""}`} onClick={() => setPicked(target.uid)}>
              <span>{target.name}</span>{selected ? <span aria-hidden="true">✓</span> : null}
            </button>
          );
        })}
      </div>
      <button className="btn btn-primary" disabled={!picked} onClick={() => picked && actions.submitVote(picked)}>{picked ? "أكّد التصويت" : "اختر شخص"}</button>
      <p className="helper">أثناء التصويت يظهر فقط كم شخص صوّت. ما يظهر مين صوّت لمين، وما تقدر تغيّر صوتك بعد التأكيد.</p>
      <div className="spacer" />
    </div>
  );
}

function PlayerResult({ view }: { view: ClientView }) {
  const finalStint = Boolean(view.result?.roundComplete && view.room.completedChallenges >= view.room.targetChallenges);
  return (
    <div className="screen">
      <div className="spacer" />
      {view.result ? <div className="card"><ResultBody result={view.result} /></div> : null}
      {view.result?.roundComplete && view.scoreboard ? <PlayerScoreboard rows={view.scoreboard} selfUid={view.self.uid} round /> : null}
      <p className="subtitle center">
        {view.result?.roundComplete
          ? finalStint ? "انتهى دور المتخفي الأخير… ننتظر الترتيب النهائي" : "ننتظر المضيف يبدأ دور متخفي جديد…"
          : view.room.completedChallenges >= view.room.targetChallenges ? "نفس المتخفي مكمل… نكمّل دوره الأخير" : "نفس المتخفي مكمل… ننتظر التحدّي الجاي"}
      </p>
      <div className="spacer" />
    </div>
  );
}

const FEEDBACK_RATINGS: Array<{ value: FeedbackRating; label: string }> = [
  { value: "EXCELLENT", label: "ممتازة" },
  { value: "GOOD", label: "حلوة" },
  { value: "OK", label: "عادية" },
  { value: "NEEDS_WORK", label: "تحتاج تحسين" },
];

const FEEDBACK_REASONS: Array<{ value: FeedbackIssueReason; label: string }> = [
  { value: "UNCLEAR", label: "مو واضح" },
  { value: "TOO_REVEALING", label: "يكشف المتخفي بسرعة" },
  { value: "TOO_SIMILAR", label: "يشبه تحدّي ثاني" },
  { value: "NOT_SUITABLE", label: "مو مناسب" },
];

function PlayerFeedback({ view }: { view: ClientView }) {
  const feedback = view.feedback;
  const [rating, setRating] = useState<FeedbackRating | null>(null);
  const [challengeOrdinal, setChallengeOrdinal] = useState<number | null>(null);
  const [reason, setReason] = useState<FeedbackIssueReason | null>(null);

  useEffect(() => {
    if (challengeOrdinal !== null && !feedback?.challenges.some((challenge) => challenge.ordinal === challengeOrdinal)) {
      setChallengeOrdinal(null);
      setReason(null);
    }
  }, [challengeOrdinal, feedback]);

  if (!feedback) return null;
  if (feedback.submitted) {
    return <div className="card center"><div className="ok-badge">شكراً، وصلنا تقييمك ✓</div></div>;
  }

  const canSubmit = rating !== null && (challengeOrdinal === null || reason !== null);
  return (
    <section className="card stack" aria-labelledby="feedback-title" style={{ width: "100%" }}>
      <div className="center stack" style={{ gap: 5 }}>
        <h2 className="title" id="feedback-title" style={{ fontSize: "clamp(22px,7vw,30px)", margin: 0 }}>وش رايك باللعبة؟</h2>
        <p className="helper" style={{ margin: 0 }}>اختياري وما يأثر على نقاطك.</p>
      </div>

      <div className="vote-list" role="radiogroup" aria-label="تقييم اللعبة">
        {FEEDBACK_RATINGS.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={rating === option.value}
            className={`vote-opt${rating === option.value ? " picked" : ""}`}
            onClick={() => setRating(option.value)}
          >
            <span>{option.label}</span>{rating === option.value ? <span aria-hidden="true">✓</span> : null}
          </button>
        ))}
      </div>

      <label className="stack" style={{ gap: 6 }}>
        <span className="code-label">في تحدّي ما ضبط؟ (اختياري)</span>
        <select
          className="input"
          aria-label="التحدّي اللي يحتاج تحسين"
          value={challengeOrdinal ?? ""}
          onChange={(event) => {
            const next = event.target.value ? Number(event.target.value) : null;
            setChallengeOrdinal(next);
            setReason(null);
          }}
        >
          <option value="">ما عندي تحدّي محدد</option>
          {feedback.challenges.map((challenge) => (
            <option key={challenge.ordinal} value={challenge.ordinal}>
              التحدّي {challenge.ordinal} · {challenge.prompt}
            </option>
          ))}
        </select>
      </label>

      {challengeOrdinal !== null ? (
        <div className="stack" style={{ gap: 8 }}>
          <span className="code-label">وش المشكلة فيه؟</span>
          <div className="vote-list" role="radiogroup" aria-label="سبب مشكلة التحدّي">
            {FEEDBACK_REASONS.map((option) => (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={reason === option.value}
                className={`vote-opt${reason === option.value ? " picked" : ""}`}
                onClick={() => setReason(option.value)}
              >
                <span>{option.label}</span>{reason === option.value ? <span aria-hidden="true">✓</span> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <button
        className="btn btn-primary"
        disabled={!canSubmit}
        onClick={() => {
          if (!rating || !canSubmit) return;
          actions.submitFeedback(rating, challengeOrdinal ?? undefined, reason ?? undefined);
        }}
      >
        إرسال التقييم
      </button>
    </section>
  );
}

function PlayerGameOver({ view }: { view: ClientView }) {
  const gameOver = view.gameOver;
  return (
    <div className="screen">
      <div className="spacer" />
      <div className="center stack">
        <h1 className="brand" style={{ fontSize: "clamp(34px,11vw,56px)" }}>خلصت اللعبة 🎉</h1>
        {gameOver ? (
          <>
            <p className="subtitle">لعبتوا {gameOver.completedChallenges} تحديات · مسكتوا المتخفي في {gameOver.caughtRounds} من {gameOver.totalRounds} أدوار</p>
            <div className="card stack" style={{ width: "100%" }}>
              <div className="row between" style={{ fontWeight: 900 }}><span>انمسك</span><span>{gameOver.caughtRounds}</span></div>
              <div className="row between" style={{ fontWeight: 900 }}><span>نجا من دوره</span><span>{gameOver.escapedRounds}</span></div>
            </div>
          </>
        ) : null}
        {view.scoreboard ? <PlayerScoreboard rows={view.scoreboard} selfUid={view.self.uid} /> : null}
        <PlayerFeedback view={view} />
        <p className="subtitle center">ننتظر المضيف يبدأ لعبة جديدة أو يقفل الغرفة</p>
      </div>
      <div className="spacer" />
    </div>
  );
}