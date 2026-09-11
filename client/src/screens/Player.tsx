import { useEffect, useState } from "react";
import type { ClientView, GameModeInfo, ScoreEntry } from "../../../shared/types.js";
import { visibleCountdownSecond } from "../audio/hostAudioEvents.js";
import { estimatedServerNow } from "../net/clock.js";
import { actions } from "../net/socket.js";
import { PhaseCountdown, ResultBody, roundLabel } from "../components/Bits.js";
import { Players } from "../components/Players.js";
import { roundDeltaText, scoreReasonText } from "../i18n/score.js";

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
    <div className="card stack score-explain-board" style={{ width: "100%" }}>
      <div className="code-label">{round ? "النقاط بعد دور المتخفي" : "الترتيب النهائي"}</div>
      {rows.map((row) => (
        <div key={row.uid} className={`score-explain-row${row.uid === selfUid ? " self" : ""}`}>
          <div className="row between" style={{ fontWeight: row.uid === selfUid ? 900 : 700 }}>
            <span>#{row.rank} {row.name}{row.uid === selfUid ? " — أنت" : ""}</span>
            <strong>{row.score} نقطة</strong>
          </div>
          {round ? <div className="score-reason">{scoreReasonText(row.roundReason)} · {roundDeltaText(row.roundDelta)}</div> : null}
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
        <p className="subtitle">{view.room.targetChallenges} تحدّيات بالضبط. كل متخفي حدّه 3 تحدّيات، وأغلبية الأصوات اللي انرسلت هي اللي تمسكه.</p>
        <div className="players">{selectedModes.map((mode) => <span className="chip" key={mode.id}>{mode.icon} {mode.label}</span>)}</div>
      </div>
      <div className="card stack quick-points-card">
        <strong>كيف تجمع نقاط؟</strong>
        <p className="helper" style={{ margin: 0 }}><strong>إذا أنت طبيعي:</strong> آخر 1 / 2 / 3 تصويتات صحيحة ورا بعض = +1 / +2 / +3. التصويت الغلط أو عدم التصويت يقطع السلسلة.</p>
        <p className="helper" style={{ margin: 0 }}><strong>إذا أنت المتخفي:</strong> +1 عن كل تحدّي تنجو منه، حتى +3.</p>
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
      <PhaseCountdown endsAt={view.room.phaseEndsAt} warningAtSeconds={10} warningText="استعدوا للتصويت" />
      <p className="subtitle center">تناقشوا، والتصويت يفتح تلقائيًا بعد انتهاء الوقت.</p>
      <div className="spacer" />
    </div>
  );
}

function PlayerVote({ view }: { view: ClientView }) {
  const [picked, setPicked] = useState<string | null>(null);
  const targets = view.voteTargets ?? [];
  const progress = view.votesProgress ?? { submitted: 0, total: 0 };
  const pickedName = targets.find((target) => target.uid === picked)?.name;

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
          <PhaseCountdown endsAt={view.room.phaseEndsAt} />
          <p className="subtitle">ننتظر الباقين… <span className="num-ltr">{progress.submitted}/{progress.total}</span></p>
          <p className="helper center">نقاطك وتوزيع الأصوات ما تنكشف إلا بعد نهاية دور المتخفي.</p>
        </div>
        <div className="spacer" />
      </div>
    );
  }

  return (
    <div className="screen player-vote-screen">
      <div className="center stack">
        <div className="eyebrow">{roundLabel(view)}</div>
        <h1 className="title">مين تحس إنه المتخفي؟</h1>
        <PhaseCountdown endsAt={view.room.phaseEndsAt} />
        <p className="helper">أغلبية الأصوات اللي تنرسل خلال الوقت تمسك المتخفي. عدم التصويت ما يدخل في مقام الأغلبية، لكنه يقطع سلسلة تصويتك الصحيحة.</p>
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
      <div className="vote-confirm-bar">
        <button className="btn btn-primary" disabled={!picked} onClick={() => picked && actions.submitVote(picked)}>{pickedName ? `أكّد التصويت على ${pickedName}` : "اختر شخص"}</button>
        <p className="helper">أثناء التصويت يظهر فقط كم شخص صوّت. ما يظهر مين صوّت لمين، وما تقدر تغيّر صوتك بعد التأكيد.</p>
      </div>
      <div className="spacer" />
    </div>
  );
}

function PlayerResult({ view }: { view: ClientView }) {
  const matchFinished = view.room.completedChallenges >= view.room.targetChallenges;
  const fullReveal = view.result?.roundComplete === true;
  return (
    <div className="screen">
      <div className="spacer" />
      {view.result ? <div className="card"><ResultBody result={view.result} /></div> : null}
      {fullReveal && view.scoreboard ? <PlayerScoreboard rows={view.scoreboard} selfUid={view.self.uid} round /> : null}
      <PhaseCountdown endsAt={view.room.phaseEndsAt} />
      <p className="subtitle center">
        {matchFinished
          ? "بعد الكشف نروح تلقائيًا للترتيب النهائي."
          : fullReveal
            ? "بعد الكشف يبدأ دور المتخفي الجاي تلقائيًا."
            : "المتخفي نجا 👀 نكمل تلقائيًا بالتحدّي الجاي."}
      </p>
      <div className="spacer" />
    </div>
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
            <p className="subtitle">لعبتوا {gameOver.completedChallenges} تحدّيات · مسكتوا المتخفي في {gameOver.caughtRounds} من {gameOver.totalRounds} أدوار متخفي</p>
            <div className="card stack" style={{ width: "100%" }}>
              <div className="row between" style={{ fontWeight: 900 }}><span>انمسك</span><span>{gameOver.caughtRounds}</span></div>
              <div className="row between" style={{ fontWeight: 900 }}><span>نجا من 3 تحدّيات</span><span>{gameOver.completedEscapeRounds ?? gameOver.escapedRounds}</span></div>
              {(gameOver.matchEndedUncaughtRounds ?? 0) > 0 ? <div className="row between" style={{ fontWeight: 900 }}><span>انتهت المباراة وهو ما انمسك</span><span>{gameOver.matchEndedUncaughtRounds}</span></div> : null}
            </div>
          </>
        ) : null}
        {view.scoreboard ? <PlayerScoreboard rows={view.scoreboard} selfUid={view.self.uid} /> : null}
        <p className="subtitle center">ننتظر المضيف يبدأ لعبة جديدة أو يقفل الغرفة</p>
      </div>
      <div className="spacer" />
    </div>
  );
}
