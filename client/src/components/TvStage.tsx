import { useEffect, useState, type ReactNode } from "react";
import type { ClientView, GameModeInfo } from "../../../shared/types.js";
import { TIMERS } from "../../../shared/constants.js";
import { visibleCountdownSecond } from "../audio/hostAudioEvents.js";
import { estimatedServerNow } from "../net/clock.js";
import { stintRuleText } from "../i18n/counts.js";
import { Avatar, colorSlotLookup } from "../ui/Avatar.js";
import { EyesMark } from "../ui/EyesMark.js";
import { Icon } from "../ui/Icon.js";
import { MatchProgress, SlotMeter, matchPosition } from "../ui/Meters.js";
import { useRemaining } from "../ui/StageTimer.js";
import { GameOverStats, PhaseCountdown, ResultBody, Scoreboard, Winners } from "./Bits.js";
import { Qr } from "./Qr.js";

/*
 * The shared screen is a stage, not a page: the current moment owns the
 * composition, progress sits in a quiet rail, and nothing private is ever
 * rendered here. This module never imports the participant socket/actions,
 * so a public display can never perform gameplay or owner commands.
 */

function modeInfo(view: ClientView): GameModeInfo | undefined {
  return view.room.availableModes.find((mode) => mode.id === view.challenge?.mode);
}

function countdownInstruction(mode?: GameModeInfo): { main: string; detail?: string } {
  switch (mode?.id) {
    case "HANDS": return { main: "إذا المطلوب ينطبق عليك، ارفع يدك عند «ارفعوا!»." };
    case "POINT": return { main: "عند «أشروا!»، أشر على شخص واحد." };
    case "NUMBER": return { main: "عند «ارفعوا أصابعكم!»، ارفع أصابعك بالعدد اللي اخترته.", detail: "من 0 إلى 5" };
    default: return { main: "عند انتهاء العد، نفّذ الحركة." };
  }
}

export interface TvStageProps {
  view: ClientView;
  /** Small persistent label in the footer, e.g. the read-only display badge. */
  badge?: string;
  /** Eyebrow above the lobby brand (display only). */
  lobbyEyebrow?: string;
  /** Footer content shown on RESULT / GAME_OVER (who advances the game). */
  waitingNote?: ReactNode;
}

export function TvStage({ view, badge, lobbyEyebrow, waitingNote }: TvStageProps) {
  const phase = view.room.phase;
  const mode = modeInfo(view);
  const inGame = !["LOBBY", "GAME_OVER", "CLOSED"].includes(phase);
  const showNote = (phase === "RESULT" || phase === "GAME_OVER") && waitingNote;

  return (
    <div className="tv" data-phase={phase} data-mode={mode?.id} data-result={resultTone(view)}>
      <div className="tv-backdrop" aria-hidden="true" />
      {phase !== "LOBBY" ? (
        <header className="tv-rail">
          <div className="tv-brand"><EyesMark size={40} glance={false} /><span>خلك طبيعي</span></div>
          {inGame ? <MatchProgress position={matchPosition(view)} variant="tv" /> : null}
        </header>
      ) : null}
      <main className="tv-stage" key={`${phase}:${view.room.completedChallenges}`}>
        <TvMoment view={view} mode={mode} lobbyEyebrow={lobbyEyebrow} />
      </main>
      {showNote || badge ? (
        <footer className="tv-foot">
          {showNote ? <span className="tv-foot-note"><span className="live-dot" aria-hidden="true" />{waitingNote}</span> : <span />}
          {badge ? <span className="tv-badge">{badge}</span> : null}
        </footer>
      ) : null}
    </div>
  );
}

function resultTone(view: ClientView): string | undefined {
  const result = view.result;
  if (view.room.phase !== "RESULT" || !result) return undefined;
  if (!result.roundComplete) return "survived";
  if (result.groupFound) return "caught";
  return result.completionReason === "MATCH_END" ? "match-end" : "escaped";
}

function TvMoment({ view, mode, lobbyEyebrow }: { view: ClientView; mode?: GameModeInfo; lobbyEyebrow?: string }) {
  switch (view.room.phase) {
    case "LOBBY": return <TvLobby view={view} eyebrow={lobbyEyebrow} />;
    case "QUESTION": return <TvReady view={view} mode={mode} />;
    case "COUNTDOWN": return <TvCountdown view={view} mode={mode} />;
    case "ACTION": return <TvAction mode={mode} />;
    case "HOLD": return <TvHold view={view} />;
    case "PROMPT_REVEAL": return <TvPromptReveal view={view} />;
    case "DISCUSSION": return <TvDiscussion view={view} />;
    case "VOTING": return <TvVoting view={view} />;
    case "RESULT": return <TvResult view={view} />;
    case "GAME_OVER": return <TvGameOver view={view} />;
    default: return <h1 className="tv-title">اللعبة شغّالة</h1>;
  }
}

/* ---- lobby ---------------------------------------------------------------- */

function TvLobby({ view, eyebrow }: { view: ClientView; eyebrow?: string }) {
  const active = view.players.filter((player) => player.connected).length;
  const selectedModes = view.room.availableModes.filter((mode) => view.room.selectedModes.includes(mode.id));
  const emptySlots = Math.max(0, view.room.maxPlayers - view.players.length);
  const missing = Math.max(0, view.room.minPlayers - active);
  const slotOf = colorSlotLookup(view.players);
  return (
    <div className="tv-lobby">
      <section className="tv-join" aria-label="الدخول للغرفة">
        {eyebrow ? <div className="pill-note">{eyebrow}</div> : null}
        <div className="tv-lobby-brand">
          <EyesMark size={96} />
          <h1 className="brand">خلك طبيعي</h1>
        </div>
        <p className="tv-lede">امسحوا الرمز وادخلوا من جوالاتكم.</p>
        <div className="tv-join-row">
          <Qr url={view.room.joinUrl} size={360} />
          <div className="tv-code-block">
            <span className="code-label">كود الغرفة</span>
            <span className="code-value" aria-label={`كود الغرفة ${view.room.code.split("").join(" ")}`}>
              {view.room.code.split("").map((char, index) => <span className="code-char" key={index}>{char}</span>)}
            </span>
            <span className="helper">امسح الرمز عشان تدخل كلاعب</span>
          </div>
        </div>
      </section>

      <section className="tv-roster" aria-label="اللاعبين">
        <header className="tv-roster-head">
          <h2>اللاعبين</h2>
          <span className="count-pill">{active} <small>/ {view.room.maxPlayers}</small></span>
        </header>
        <ul className="tv-roster-grid">
          {view.players.map((player) => (
            <li key={player.uid} className={`tv-roster-slot${player.connected ? "" : " is-offline"}`}>
              <span className="tv-roster-avatar">
                <Avatar name={player.name} colorSlot={slotOf(player.uid)} size="lg" offline={!player.connected} />
                {player.isHost ? <span className="tv-roster-crown" aria-label="مالك الغرفة"><Icon name="crown" /></span> : null}
              </span>
              <span className="tv-roster-name" dir="auto">{player.name}</span>
            </li>
          ))}
          {Array.from({ length: emptySlots }, (_, index) => (
            <li key={`empty-${index}`} className="tv-roster-slot is-empty" aria-hidden="true">
              <span className="avatar avatar-lg avatar-empty">+</span>
            </li>
          ))}
        </ul>
        <div className="tv-match-summary">
          <strong>{view.room.targetChallenges} تحدّيات</strong>
          <span>{stintRuleText(view.room.impostorStintMax)}</span>
          <div className="mode-tags">
            {selectedModes.map((mode) => <span className="tag" key={mode.id}><span aria-hidden="true">{mode.icon}</span> {mode.label}</span>)}
          </div>
        </div>
        <p className="tv-foot-note">
          <span className="live-dot" aria-hidden="true" />
          {missing > 0 ? `نحتاج ${missing === 1 ? "لاعب واحد" : missing === 2 ? "لاعبين" : `${missing} لاعبين`} بعد عشان نبدأ` : "ننتظر مالك الغرفة يبدأ اللعبة"}
        </p>
      </section>
    </div>
  );
}

/* ---- challenge flow --------------------------------------------------------- */

function TvReady({ view, mode }: { view: ClientView; mode?: GameModeInfo }) {
  const progress = view.readyProgress ?? { submitted: 0, total: view.players.length };
  return (
    <div className="tv-moment tv-ready">
      {mode ? <div className="tv-mode-mark"><span aria-hidden="true">{mode.icon}</span> {mode.label}</div> : null}
      <h1 className="tv-title">شوفوا جوالاتكم</h1>
      <p className="tv-lede">كل واحد يشوف المطلوب منه بجواله ويضغط جاهز</p>
      <div className="tv-meter" aria-label={`${progress.submitted} من ${progress.total} جاهزين`}>
        <SlotMeter filled={progress.submitted} total={progress.total} size="lg" />
        <span className="tv-meter-caption"><b className="num-ltr">{progress.submitted}</b> من <span className="num-ltr">{progress.total}</span> جاهزين</span>
      </div>
    </div>
  );
}

function TvCountdown({ view, mode }: { view: ClientView; mode?: GameModeInfo }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 100);
    return () => window.clearInterval(timer);
  }, []);
  const now = estimatedServerNow();
  const seconds = visibleCountdownSecond(view.room.phaseEndsAt, now) ?? 1;
  const remaining = view.room.phaseEndsAt ? Math.max(0, view.room.phaseEndsAt - now) : 0;
  const fraction = Math.max(0, Math.min(1, remaining / TIMERS.COUNTDOWN));
  const instruction = countdownInstruction(mode);
  return (
    <div className="tv-moment tv-countdown">
      <div className="tv-eyebrow">استعدوا…</div>
      <div className="tv-countdown-dial">
        <svg viewBox="0 0 100 100" aria-hidden="true">
          <circle className="track" cx="50" cy="50" r="46" pathLength={100} />
          <circle className="fill" cx="50" cy="50" r="46" pathLength={100} strokeDasharray="100" strokeDashoffset={100 - fraction * 100} />
        </svg>
        <span className="host-countdown-number num-ltr" key={seconds}>{seconds}</span>
      </div>
      <div className="host-countdown-instruction">
        <div>{instruction.main}</div>
        {instruction.detail ? <div className="host-countdown-detail">{instruction.detail}</div> : null}
      </div>
    </div>
  );
}

function TvAction({ mode }: { mode?: GameModeInfo }) {
  return (
    <div className="tv-moment tv-action">
      <div className="tv-action-fx" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => <i key={index} style={{ "--i": index } as React.CSSProperties} />)}
      </div>
      <h1 className="host-action-title">{mode?.actionLabel ?? "الحين!"}</h1>
    </div>
  );
}

function TvHold({ view }: { view: ClientView }) {
  const remaining = useRemaining(view.room.phaseEndsAt, 100);
  const fraction = remaining === null ? 1 : Math.max(0, Math.min(1, remaining / TIMERS.HOLD));
  return (
    <div className="tv-moment tv-hold">
      <EyesMark size={200} />
      <h1 className="host-hold-title">طالعوا بعض</h1>
      <p className="tv-lede host-hold-subtitle">خلكم على وضعكم لين يطلع المطلوب.</p>
      <div className="tv-line" aria-hidden="true"><i style={{ transform: `scaleX(${fraction})` }} /></div>
    </div>
  );
}

function TvPromptReveal({ view }: { view: ClientView }) {
  return (
    <div className="tv-moment tv-reveal">
      <div className="tv-eyebrow">المطلوب كان…</div>
      <h1 className="host-prompt host-prompt-reveal">{view.publicPrompt?.text ?? "…"}</h1>
    </div>
  );
}

function TvDiscussion({ view }: { view: ClientView }) {
  return (
    <div className="tv-moment tv-discussion">
      <PhaseCountdown endsAt={view.room.phaseEndsAt} totalMs={TIMERS.DISCUSSION} variant="ring" warningAtSeconds={10} warningText="استعدوا للتصويت" />
      <h1 className="tv-title host-discussion-question">مين تصرفه مو طبيعي؟</h1>
      <figure className="prompt-context tv-prompt-context">
        <figcaption>المطلوب كان</figcaption>
        <blockquote className="host-prompt-discussion">{view.publicPrompt?.text ?? "…"}</blockquote>
      </figure>
      <p className="tv-hint">تناقشوا — التصويت يبدأ تلقائيًا بعد انتهاء الوقت.</p>
    </div>
  );
}

function TvVoting({ view }: { view: ClientView }) {
  // Turnout only: never targets, quorum, or who is still missing.
  const progress = view.votesProgress ?? { submitted: 0, total: view.players.length };
  return (
    <div className="tv-moment tv-voting">
      <PhaseCountdown endsAt={view.room.phaseEndsAt} totalMs={TIMERS.VOTING} variant="ring" />
      <h1 className="tv-title host-voting-title">صوّتوا</h1>
      <p className="tv-lede">من جوالاتكم: مين تحسون إنه المتخفي؟</p>
      <div className="tv-meter" aria-label={`صوّت ${progress.submitted} من ${progress.total}`}>
        <SlotMeter filled={progress.submitted} total={progress.total} size="lg" />
        <span className="tv-meter-caption">صوّت <b className="num-ltr">{progress.submitted}</b> من <span className="num-ltr">{progress.total}</span></span>
      </div>
      <p className="tv-privacy"><Icon name="lock" /> <strong>الأصوات مخفية للحين</strong> · ما يظهر اتجاه التصويت ولا أسماء اللي ما صوّتوا.</p>
    </div>
  );
}

/* ---- results ------------------------------------------------------------ */

function TvResult({ view }: { view: ClientView }) {
  const result = view.result;
  if (!result) return null;
  if (!result.roundComplete) {
    return (
      <div className="tv-moment tv-result tv-result-light">
        <ResultBody result={result} players={view.players} />
      </div>
    );
  }
  return (
    <div className="tv-result tv-result-full">
      <div className="tv-result-hero">
        <ResultBody result={result} players={view.players} showTally={false} />
        {(result.voteTally?.length ?? 0) > 0 ? <TvTally view={view} /> : null}
      </div>
      {view.scoreboard ? (
        <aside className="tv-result-scores">
          <Scoreboard rows={view.scoreboard} players={view.players} round />
        </aside>
      ) : null}
    </div>
  );
}

/** Settled vote aggregate as one glanceable row: who received votes. */
function TvTally({ view }: { view: ClientView }) {
  const all = view.result?.voteTally ?? [];
  const rows = all.filter((row) => row.votes > 0).sort((a, b) => b.votes - a.votes);
  const without = all.length - rows.length;
  const slotOf = colorSlotLookup(view.players);
  return (
    <div className="tv-tally" aria-label="الأصوات">
      <span className="tv-tally-label">الأصوات</span>
      <ul>
        {rows.map((row) => (
          <li key={row.uid} className={row.votes === 0 ? "is-zero" : undefined} data-player-uid={row.uid}>
            <span className="tv-tally-avatar">
              <Avatar name={row.name} colorSlot={slotOf(row.uid)} size="md" />
              <b className="num-ltr">{row.votes}</b>
            </span>
            <span className="tv-tally-name" dir="auto">{row.name}</span>
          </li>
        ))}
      </ul>
      {without > 0 ? <span className="tv-tally-foot">{without === 1 ? "لاعب واحد" : without === 2 ? "لاعبين" : `${without} لاعبين`} ما عليهم أصوات</span> : null}
    </div>
  );
}

function TvGameOver({ view }: { view: ClientView }) {
  return (
    <div className="tv-result tv-gameover">
      <div className="tv-result-hero">
        <h1 className="tv-gameover-title"><span className="brand">خلصت اللعبة</span> 🎉</h1>
        {view.scoreboard ? <Winners rows={view.scoreboard} players={view.players} /> : null}
        {view.gameOver ? <GameOverStats gameOver={view.gameOver} /> : null}
      </div>
      {view.scoreboard ? (
        <aside className="tv-result-scores">
          <Scoreboard rows={view.scoreboard} players={view.players} />
        </aside>
      ) : null}
    </div>
  );
}

