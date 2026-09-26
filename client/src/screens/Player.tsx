import { useEffect, useState } from "react";
import type { ClientView, GameModeInfo } from "../../../shared/types.js";
import { TIMERS } from "../../../shared/constants.js";
import { visibleCountdownSecond } from "../audio/hostAudioEvents.js";
import { estimatedServerNow } from "../net/clock.js";
import { actions } from "../net/socket.js";
import { GameOverStats, MyScoreCallout, PhaseCountdown, ResultBody, Scoreboard, VoteBoard, Winners } from "../components/Bits.js";
import { Players } from "../components/Players.js";
import { stintRuleText } from "../i18n/counts.js";
import { Avatar, seatLookup } from "../ui/Avatar.js";
import { EyesMark } from "../ui/EyesMark.js";
import { Icon } from "../ui/Icon.js";
import { SlotMeter } from "../ui/Meters.js";

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

function ModeChip({ mode }: { mode?: GameModeInfo }) {
  if (!mode) return null;
  return <span className="mode-chip"><span aria-hidden="true">{mode.icon}</span> {mode.label}</span>;
}

function WaitingNote({ children }: { children: React.ReactNode }) {
  return <p className="waiting-note"><span className="live-dot" aria-hidden="true" />{children}</p>;
}

/* ---- lobby -------------------------------------------------------------- */

function PlayerLobby({ view }: { view: ClientView }) {
  const selectedModes = view.room.availableModes.filter((mode) => view.room.selectedModes.includes(mode.id));
  return (
    <div className="screen lobby-screen player-lobby has-utility-bar">
      <header className="lobby-hero">
        <span className="joined-seal" aria-hidden="true"><Icon name="check" /></span>
        <h1 className="title">أنت داخل 🎉</h1>
        <p className="subtitle">غرفة <span className="num-ltr" dir="ltr">{view.room.code}</span></p>
      </header>

      <section className="lobby-section" aria-labelledby="player-lobby-match">
        <h2 className="section-label" id="player-lobby-match">المباراة</h2>
        <p className="match-line"><strong>{view.room.targetChallenges} تحدّيات بالضبط</strong></p>
        <p className="lobby-rule">{stintRuleText(view.room.impostorStintMax)} وأغلبية الأصوات اللي انرسلت هي اللي تمسكه.</p>
        <div className="mode-tags">
          {selectedModes.map((mode) => <span className="tag" key={mode.id}><span aria-hidden="true">{mode.icon}</span> {mode.label}</span>)}
        </div>
      </section>

      <section className="lobby-section" aria-labelledby="player-lobby-roster">
        <h2 className="section-label" id="player-lobby-roster">اللاعبين ({view.players.length})</h2>
        <Players players={view.players} selfUid={view.self.uid} />
      </section>

      <section className="lobby-section quick-points-card" aria-labelledby="player-lobby-points">
        <h2 className="section-label" id="player-lobby-points">كيف تجمع نقاط؟</h2>
        <div className="points-rows">
          <div className="points-row">
            <span className="points-row-who">إذا أنت طبيعي</span>
            <span className="points-row-what">كل ما صوّتت صح على المتخفي ورا بعض، تكبر نقاطك: <b className="num-ltr">+1</b> ثم <b className="num-ltr">+2</b> ثم <b className="num-ltr">+3</b>. التصويت الغلط أو عدم التصويت يقطع السلسلة.</span>
          </div>
          <div className="points-row">
            <span className="points-row-who is-impostor">إذا أنت المتخفي</span>
            <span className="points-row-what"><b className="num-ltr">+1</b> عن كل تحدّي تنجو منه في دورك.</span>
          </div>
        </div>
      </section>

      <div className="spacer" />
      <WaitingNote>ننتظر مالك الغرفة يبدأ اللعبة</WaitingNote>
    </div>
  );
}

/* ---- private role --------------------------------------------------------- */

/** Challenges already uncovered on this device (survives remounts, not reloads). */
const revealedChallenges = new Set<string>();

function challengeKey(view: ClientView): string {
  return `${view.room.code}:${view.room.currentRound}:${view.room.completedChallenges}:${view.challenge?.index ?? 0}`;
}

/**
 * Presentation-only privacy curtain. It is identical for every role so a
 * glance at a covered phone reveals nothing; the server's per-recipient
 * projection remains the real security boundary.
 */
function PrivacyCurtain({ mode, onReveal }: { mode?: GameModeInfo; onReveal: () => void }) {
  return (
    <div className="screen player-stage-screen privacy-curtain" data-moment="curtain">
      <main className="privacy-curtain-main">
        <EyesMark size={104} />
        <h1 className="player-stage-title">هذي الشاشة لك بس</h1>
        <p className="player-stage-copy">تأكد إن محد يشوف جوالك قبل ما يطلع دورك.</p>
        {mode ? <p className="privacy-curtain-mode">التحدّي الجاي: <ModeChip mode={mode} /></p> : null}
      </main>
      <div className="player-stage-dock">
        <button type="button" className="btn btn-primary" onClick={onReveal}>
          <Icon name="eye" /> اعرض دوري
        </button>
      </div>
    </div>
  );
}

function PlayerPrompt({ view }: { view: ClientView }) {
  const key = challengeKey(view);
  const [revealed, setRevealed] = useState(() => revealedChallenges.has(key));
  useEffect(() => { setRevealed(revealedChallenges.has(key)); }, [key]);

  if (view.myReady === undefined) return <PlayerWaitNext />;
  const ready = view.myReady === true;
  const mode = modeInfo(view);
  if (ready) return <PlayerReadyWaiting view={view} />;

  if (!revealed) {
    return <PrivacyCurtain mode={mode} onReveal={() => { revealedChallenges.add(key); setRevealed(true); }} />;
  }

  const cover = () => { revealedChallenges.delete(key); setRevealed(false); };

  return (
    <div className="screen player-stage-screen" data-moment="prompt">
      <main className="player-stage-main">
        <div className="player-stage-top">
          <ModeChip mode={mode} />
          <button type="button" className="link-btn cover-btn" onClick={cover}>
            <Icon name="eye-off" /> إخفاء
          </button>
        </div>
        {view.isImpostor ? (
          <div className="role-block is-impostor">
            <span className="role-seal" aria-hidden="true"><Icon name="mask" /></span>
            <div className="player-stage-kicker">دورك</div>
            <h1 className="player-stage-prompt player-stage-impostor">أنت <span className="impostor-word">المتخفي</span></h1>
            <p className="player-stage-copy">ما تعرف المطلوب. راقب الباقين وخلك طبيعي.</p>
            <p className="player-stage-copy player-stage-copy-strong">{mode?.impostorInstruction ?? "وقت الحركة، سوّ مثل الباقين."}</p>
          </div>
        ) : (
          <div className="role-block">
            <div className="player-stage-kicker">المطلوب</div>
            <h1 className="player-stage-prompt">{view.myPrompt?.text ?? "…"}</h1>
            {mode?.normalInstruction ? <p className="player-stage-copy">{mode.normalInstruction}</p> : null}
          </div>
        )}
      </main>
      <div className="player-stage-dock">
        <button className="btn btn-primary" onClick={() => actions.markReady()}>جاهز</button>
      </div>
    </div>
  );
}

function PlayerReadyWaiting({ view }: { view: ClientView }) {
  const progress = view.readyProgress;
  return (
    <div className="screen player-stage-screen player-stage-waiting" data-moment="ready">
      <main className="player-stage-main">
        <span className="state-seal is-success" aria-hidden="true"><Icon name="check" /></span>
        <div className="ok-badge">جاهز ✓</div>
        <h1 className="player-stage-title">ننتظر الباقين</h1>
        {progress ? (
          <div className="meter-block">
            <SlotMeter filled={progress.submitted} total={progress.total} />
            <span className="meter-caption"><span className="num-ltr">{progress.submitted}</span> من <span className="num-ltr">{progress.total}</span> جاهزين</span>
          </div>
        ) : null}
        <p className="player-stage-copy">أول ما يجهز الكل يبدأ العد هنا وعلى الشاشة.</p>
      </main>
    </div>
  );
}

function PlayerWaitNext() {
  return (
    <div className="screen player-stage-screen player-stage-waiting">
      <main className="player-stage-main">
        <span className="state-seal" aria-hidden="true"><Icon name="timer" /></span>
        <h1 className="player-stage-title">انتظر الدور الجاي</h1>
        <p className="player-stage-copy">أنت مو مشارك في دور المتخفي الحالي. مكانك محفوظ وبتدخل مع الدور الجاي.</p>
      </main>
    </div>
  );
}

/* ---- synchronized cues ----------------------------------------------------- */

function PlayerCountdown({ view }: { view: ClientView }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((value) => value + 1), 100);
    return () => window.clearInterval(id);
  }, []);
  const seconds = visibleCountdownSecond(view.room.phaseEndsAt, estimatedServerNow()) ?? 1;
  const mode = modeInfo(view);
  return (
    <div className="screen player-stage-screen player-cue-screen" data-moment="countdown">
      <main className="player-stage-main">
        <div className="eyebrow">استعد…</div>
        <div className="player-countdown-number num-ltr" key={seconds} aria-live="off">{seconds}</div>
        {mode ? <p className="cue-next">وبعدها: <strong>«{mode.actionLabel}»</strong></p> : null}
      </main>
    </div>
  );
}

function PlayerAction({ view }: { view: ClientView }) {
  const mode = modeInfo(view);
  return (
    <div className="screen player-stage-screen player-cue-screen" data-moment="action" data-mode={mode?.id}>
      <main className="player-stage-main">
        <span className="action-burst" aria-hidden="true" />
        <h1 className="player-action-title">{modeInfo(view)?.actionLabel ?? "الحين!"}</h1>
      </main>
    </div>
  );
}

function PlayerHold({ view }: { view: ClientView }) {
  return (
    <div className="screen player-stage-screen player-cue-screen" data-moment="hold">
      <main className="player-stage-main">
        <EyesMark size={88} />
        <h1 className="player-action-title player-hold-title">طالعوا بعض</h1>
        <p className="player-stage-copy">خلكم على وضعكم لين يطلع المطلوب.</p>
        <PhaseCountdown endsAt={view.room.phaseEndsAt} totalMs={TIMERS.HOLD} urgent={false} />
      </main>
    </div>
  );
}

function PlayerWatchScreen() {
  return (
    <div className="screen player-stage-screen player-stage-waiting">
      <main className="player-stage-main">
        <span className="state-seal" aria-hidden="true"><Icon name="timer" /></span>
        <h1 className="player-stage-title">انتظر شوي…</h1>
        <p className="player-stage-copy">بتتحدث حالتك هنا تلقائيًا.</p>
      </main>
    </div>
  );
}

function PlayerPromptReveal({ view }: { view: ClientView }) {
  return (
    <div className="screen player-stage-screen" data-moment="reveal">
      <main className="player-stage-main">
        <div className="player-stage-kicker">المطلوب كان…</div>
        <h1 className="player-stage-prompt prompt-reveal">{view.publicPrompt?.text ?? "…"}</h1>
      </main>
    </div>
  );
}

function PlayerDiscussion({ view }: { view: ClientView }) {
  return (
    <div className="screen player-stage-screen player-discussion-screen" data-moment="discussion">
      <main className="player-stage-main">
        <PhaseCountdown
          endsAt={view.room.phaseEndsAt}
          totalMs={TIMERS.DISCUSSION}
          variant="ring"
          warningAtSeconds={10}
          warningText="استعدوا للتصويت"
        />
        <h1 className="player-discussion-question">مين تصرفه مو طبيعي؟</h1>
        <figure className="prompt-context">
          <figcaption>المطلوب كان</figcaption>
          <blockquote>{view.publicPrompt?.text ?? "…"}</blockquote>
        </figure>
        <p className="player-stage-copy">تناقشوا، والتصويت يفتح تلقائيًا بعد انتهاء الوقت.</p>
      </main>
    </div>
  );
}

/* ---- voting --------------------------------------------------------------- */

function PlayerVote({ view }: { view: ClientView }) {
  const [picked, setPicked] = useState<string | null>(null);
  const targets = view.voteTargets ?? [];
  const progress = view.votesProgress ?? { submitted: 0, total: 0 };
  const pickedName = targets.find((target) => target.uid === picked)?.name;
  const seatOf = seatLookup(view.players);

  useEffect(() => {
    if (picked && !targets.some((target) => target.uid === picked)) setPicked(null);
  }, [picked, targets]);

  if (view.voteTargets === undefined && view.myVoteSubmitted === undefined) return <PlayerWatchScreen />;

  if (view.myVoteSubmitted) {
    return (
      <div className="screen player-stage-screen player-vote-waiting" data-moment="voted">
        <main className="player-stage-main">
          <span className="state-seal is-success vote-waiting-check" aria-hidden="true"><Icon name="check" /></span>
          <h1 className="player-stage-title">تم تسجيل صوتك</h1>
          <div className="meter-block">
            <SlotMeter filled={progress.submitted} total={progress.total} />
            <span className="meter-caption vote-waiting-progress">صوّت <span className="num-ltr">{progress.submitted}</span> من <span className="num-ltr">{progress.total}</span></span>
          </div>
          <PhaseCountdown endsAt={view.room.phaseEndsAt} totalMs={TIMERS.VOTING} />
          <p className="player-stage-copy">بانتظار الباقين…</p>
        </main>
      </div>
    );
  }

  return (
    <div className="screen player-vote-screen player-stage-screen" data-moment="vote">
      <main className="player-vote-main">
        <div className="vote-head">
          <h1 className="player-vote-title">مين تحس إنه المتخفي؟</h1>
          <PhaseCountdown endsAt={view.room.phaseEndsAt} totalMs={TIMERS.VOTING} />
        </div>
        <div
          className={`vote-list stage-vote-grid${picked ? " has-pick" : ""}`}
          data-count={targets.length}
          role="radiogroup"
          aria-label="اختر الشخص اللي تحس إنه المتخفي"
        >
          {targets.map((target) => {
            const selected = picked === target.uid;
            return (
              <button
                key={target.uid}
                type="button"
                role="radio"
                aria-checked={selected}
                className={`vote-opt stage-vote-option${selected ? " picked" : ""}`}
                onClick={() => setPicked(selected ? null : target.uid)}
              >
                <span className="stage-vote-avatar">
                  <Avatar name={target.name} seat={seatOf(target.uid)} size="md" />
                  {selected ? <span className="stage-vote-check" aria-hidden="true"><Icon name="check" /></span> : null}
                </span>
                <span className="stage-vote-name" dir="auto">{target.name}</span>
              </button>
            );
          })}
        </div>
      </main>
      <div className={`vote-confirm-bar stage-vote-dock${picked ? " is-armed" : ""}`}>
        <div className="stage-vote-selection" aria-live="polite">
          {pickedName ? <>صوتك لـ <strong dir="auto">{pickedName}</strong></> : "اختر لاعب، وبعدها أكّد."}
        </div>
        <div className="stage-vote-actions">
          <button className="btn btn-primary" disabled={!picked} onClick={() => picked && actions.submitVote(picked)}>{pickedName ? `أكّد التصويت على ${pickedName}` : "تأكيد التصويت"}</button>
          {picked ? <button type="button" className="btn btn-quiet btn-sm stage-vote-undo" onClick={() => setPicked(null)}>تراجع</button> : null}
        </div>
        <p className="helper">أثناء التصويت يظهر فقط كم شخص صوّت. ما يظهر مين صوّت لمين، وما تقدر تغيّر صوتك بعد التأكيد.</p>
      </div>
    </div>
  );
}

/* ---- results ----------------------------------------------------------------- */

export function PhoneResultDetails({ view }: { view: ClientView }) {
  const result = view.result;
  if (!result?.roundComplete || !view.scoreboard) return null;
  const seatOf = seatLookup(view.players);
  return (
    <>
      {view.self.role === "player" ? <MyScoreCallout rows={view.scoreboard} selfUid={view.self.uid} /> : null}
      <Scoreboard rows={view.scoreboard} players={view.players} selfUid={view.self.uid} round />
      {(result.voteTally?.length ?? 0) > 0 ? (
        <section className="result-vote-section" aria-label="الأصوات">
          <h2 className="section-label">الأصوات</h2>
          <VoteBoard rows={result.voteTally ?? []} seatOf={seatOf} />
        </section>
      ) : null}
    </>
  );
}

function PlayerResult({ view }: { view: ClientView }) {
  const fullReveal = view.result?.roundComplete === true;
  return (
    <div className={`screen player-result-screen${fullReveal ? " is-full" : " is-light"}`} data-moment="result">
      {view.result ? <ResultBody result={view.result} players={view.players} showTally={false} /> : null}
      <PhoneResultDetails view={view} />
      <div className="spacer" />
      <WaitingNote>بانتظار مالك الغرفة ينقلكم للمرحلة الجاية</WaitingNote>
    </div>
  );
}

function PlayerGameOver({ view }: { view: ClientView }) {
  const gameOver = view.gameOver;
  return (
    <div className="screen gameover-screen has-utility-bar" data-moment="gameover">
      <header className="gameover-hero">
        <h1 className="gameover-title"><span className="brand">خلصت اللعبة</span> 🎉</h1>
        {view.scoreboard ? <Winners rows={view.scoreboard} players={view.players} /> : null}
      </header>
      {gameOver ? <GameOverStats gameOver={gameOver} /> : null}
      {view.scoreboard ? <Scoreboard rows={view.scoreboard} players={view.players} selfUid={view.self.uid} /> : null}
      <div className="spacer" />
      <WaitingNote>ننتظر مالك الغرفة يبدأ لعبة جديدة أو يقفل الغرفة</WaitingNote>
    </div>
  );
}
