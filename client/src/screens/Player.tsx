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
    case "HOLD": return <PlayerHold view={view} />;
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
    <div className="screen player-stage-screen">
      <main className="player-stage-main">
        <div className="player-stage-round">{roundLabel(view)}</div>
        <div className="player-stage-mode">{modeTitle(view)}</div>
        {view.isImpostor ? (
          <>
            <div className="player-stage-kicker">دورك</div>
            <h1 className="player-stage-prompt player-stage-impostor">أنت المتخفي</h1>
            <p className="player-stage-copy">ما تعرف المطلوب.</p>
            <p className="player-stage-copy player-stage-copy-strong">{mode?.impostorInstruction ?? "راقب الباقين وخلك طبيعي."}</p>
          </>
        ) : (
          <>
            <div className="player-stage-kicker">المطلوب</div>
            <h1 className="player-stage-prompt">{view.myPrompt?.text ?? "…"}</h1>
            {mode?.normalInstruction ? <p className="player-stage-copy">{mode.normalInstruction}</p> : null}
          </>
        )}
      </main>
      <div className="player-stage-dock">
        <button className="btn btn-primary" onClick={() => actions.markReady()}>جاهز</button>
      </div>
    </div>
  );
}

function PlayerReadyWaiting() {
  return (
    <div className="screen center stack player-stage-screen player-stage-waiting">
      <main className="player-stage-main">
        <div className="ok-badge">جاهز ✓</div>
        <h1 className="player-stage-prompt player-stage-prompt-small">ننتظر الباقين</h1>
        <p className="player-stage-copy">إذا بدأ العد، بيظهر هنا مباشرة.</p>
      </main>
    </div>
  );
}

function PlayerWaitNext() {
  return (
    <div className="screen center stack player-stage-screen player-stage-waiting">
      <main className="player-stage-main">
        <h1 className="player-stage-prompt player-stage-prompt-small">انتظر الدور الجاي</h1>
        <p className="player-stage-copy">أنت مو مشارك في دور المتخفي الحالي. مكانك محفوظ وبتدخل مع الدور الجاي.</p>
      </main>
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

function PlayerHold({ view }: { view: ClientView }) {
  return (
    <div className="screen center stack player-cue-screen">
      <div className="eyebrow">خذوا نظرة 👀</div>
      <h1 className="title player-action-title">طالعوا بعض</h1>
      <p className="subtitle">خلكم على وضعكم لين يطلع المطلوب.</p>
      <PhaseCountdown endsAt={view.room.phaseEndsAt} />
    </div>
  );
}

function PlayerWatchScreen() {
  return (
    <div className="screen center stack player-stage-screen player-stage-waiting">
      <main className="player-stage-main">
        <h1 className="player-stage-prompt player-stage-prompt-small">انتظر شوي…</h1>
        <p className="player-stage-copy">بتتحدث حالتك هنا تلقائيًا.</p>
      </main>
    </div>
  );
}

function PlayerPromptReveal({ view }: { view: ClientView }) {
  return (
    <div className="screen player-stage-screen">
      <main className="player-stage-main">
        <div className="player-stage-kicker">المطلوب كان…</div>
        <h1 className="player-stage-prompt">{view.publicPrompt?.text ?? "…"}</h1>
      </main>
    </div>
  );
}

function PlayerDiscussion({ view }: { view: ClientView }) {
  return (
    <div className="screen player-stage-screen player-discussion-screen">
      <main className="player-stage-main">
        <div className="player-stage-round">{roundLabel(view)}</div>
        <div className="player-stage-kicker">المطلوب كان</div>
        <div className="player-stage-prompt player-stage-prompt-compact">{view.publicPrompt?.text ?? "…"}</div>
        <h1 className="player-discussion-question">مين تصرفه مو طبيعي؟</h1>
        <PhaseCountdown endsAt={view.room.phaseEndsAt} warningAtSeconds={10} warningText="استعدوا للتصويت" />
        <p className="player-stage-copy">تناقشوا، والتصويت يفتح تلقائيًا بعد انتهاء الوقت.</p>
      </main>
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
      <div className="screen player-stage-screen player-vote-waiting">
        <main className="player-stage-main">
          <div className="vote-waiting-check" aria-hidden="true">✓</div>
          <h1 className="player-stage-prompt player-stage-prompt-small">تم تسجيل صوتك</h1>
          <div className="vote-waiting-progress"><span className="num-ltr">{progress.submitted} من {progress.total}</span> صوّتوا</div>
          <PhaseCountdown endsAt={view.room.phaseEndsAt} />
          <p className="player-stage-copy">بانتظار الباقين…</p>
        </main>
      </div>
    );
  }

  return (
    <div className="screen player-vote-screen player-stage-screen">
      <main className="player-vote-main">
        <div className="player-stage-round">{roundLabel(view)}</div>
        <h1 className="player-vote-title">مين تحس إنه المتخفي؟</h1>
        <PhaseCountdown endsAt={view.room.phaseEndsAt} />
        <div className="vote-list stage-vote-grid" role="radiogroup" aria-label="اختر الشخص اللي تحس إنه المتخفي">
          {targets.map((target) => {
            const selected = picked === target.uid;
            return (
              <button
                key={target.uid}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`vote-opt stage-vote-option${selected ? " picked" : ""}`}
                onClick={() => setPicked(target.uid)}
              >
                <span className="stage-vote-name" dir="auto">{target.name}</span>
                {selected ? <span className="stage-vote-check" aria-hidden="true">✓</span> : null}
              </button>
            );
          })}
        </div>
      </main>
      <div className="vote-confirm-bar stage-vote-dock">
        <div className="stage-vote-selection">
          {pickedName ? <>اختيارك: <strong dir="auto">{pickedName}</strong></> : "اختر لاعب أول"}
        </div>
        <button className="btn btn-primary" disabled={!picked} onClick={() => picked && actions.submitVote(picked)}>{pickedName ? `أكّد التصويت على ${pickedName}` : "تأكيد التصويت"}</button>
        <p className="helper">أثناء التصويت يظهر فقط كم شخص صوّت. ما يظهر مين صوّت لمين، وما تقدر تغيّر صوتك بعد التأكيد.</p>
      </div>
    </div>
  );
}

function PlayerResult({ view }: { view: ClientView }) {
  const fullReveal = view.result?.roundComplete === true;
  return (
    <div className="screen">
      <div className="spacer" />
      {view.result ? <div className="card"><ResultBody result={view.result} /></div> : null}
      {fullReveal && view.scoreboard ? <PlayerScoreboard rows={view.scoreboard} selfUid={view.self.uid} round /> : null}
      <div className="center stack" style={{ gap: 8 }}>
        <div className="pill-note">بانتظار المضيف…</div>
        <p className="subtitle center" style={{ margin: 0 }}>خذوا وقتكم مع النتيجة. المضيف ينقلكم للمرحلة الجاية.</p>
      </div>
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
        <p className="subtitle center">ننتظر مالك الغرفة يبدأ لعبة جديدة أو يقفل الغرفة</p>
      </div>
      <div className="spacer" />
    </div>
  );
}
