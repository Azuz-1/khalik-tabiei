import { useEffect, useState, type ReactNode } from "react";
import type { ClientView, GameMode, GameModeInfo, ScoreEntry } from "../../../shared/types.js";
import { MIN_PLAYERS, ROUND_OPTIONS } from "../../../shared/constants.js";
import { visibleCountdownSecond } from "../audio/hostAudioEvents.js";
import { estimatedServerNow } from "../net/clock.js";
import { actions } from "../net/socket.js";
import { Qr } from "../components/Qr.js";
import { Players, Progress } from "../components/Players.js";
import { ResultBody, VoteBoard, roundLabel } from "../components/Bits.js";

export function Host({ view }: { view: ClientView }) {
  switch (view.room.phase) {
    case "LOBBY":
      return <HostLobby view={view} />;
    case "QUESTION":
      return <HostReady view={view} />;
    case "COUNTDOWN":
      return <HostCountdown view={view} />;
    case "ACTION":
      return <HostAction view={view} />;
    case "HOLD":
      return <HostHold />;
    case "PROMPT_REVEAL":
      return <HostPromptReveal view={view} />;
    case "DISCUSSION":
      return <HostDiscussion view={view} />;
    case "VOTING":
      return <HostVoting view={view} />;
    case "RESULT":
      return <HostResult view={view} />;
    case "GAME_OVER":
      return <HostGameOver view={view} />;
    default:
      return <HostReady view={view} />;
  }
}

function modeInfo(view: ClientView): GameModeInfo | undefined {
  return view.room.availableModes.find((mode) => mode.id === view.challenge?.mode);
}

function countdownInstruction(mode?: GameModeInfo): { main: string; detail?: string } {
  switch (mode?.id) {
    case "HANDS":
      return { main: "إذا المطلوب ينطبق عليك، ارفع يدك عند «ارفعوا!»." };
    case "POINT":
      return { main: "عند «أشروا!»، أشر على شخص واحد." };
    case "NUMBER":
      return {
        main: "عند «ارفعوا أصابعكم!»، ارفع أصابعك بالعدد اللي اخترته.",
        detail: "من 0 إلى 5",
      };
    default:
      return { main: "عند انتهاء العد، نفّذ الحركة." };
  }
}

function HostStage({
  children,
  className = "",
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`screen host host-stage ${className}`.trim()}>
      <div className="host-stage-content">{children}</div>
    </div>
  );
}

function CloseRoom() {
  return (
    <div className="footer-note">
      <button
        className="link-btn"
        onClick={() => confirm("تقفل الغرفة على الكل؟") && actions.closeRoom()}
      >
        إغلاق الغرفة
      </button>
    </div>
  );
}

function HostLobby({ view }: { view: ClientView }) {
  const [copied, setCopied] = useState(false);
  const active = view.players.filter((player) => player.connected).length;
  const modes = new Set(view.room.selectedModes);
  const totalRounds = view.room.totalRounds || 5;
  const canStart = active >= MIN_PLAYERS && modes.size > 0;
  const missingPlayers = Math.max(0, MIN_PLAYERS - active);

  const toggleMode = (id: GameMode) => {
    const next = new Set(modes);
    if (next.has(id)) {
      if (next.size === 1) return;
      next.delete(id);
    } else {
      next.add(id);
    }
    actions.setSettings({ selectedModes: [...next] });
  };

  const modeSummary =
    modes.size === 1
      ? `كل التحدّيات بتكون بطريقة ${view.room.availableModes.find((mode) => modes.has(mode.id))?.fullLabel ?? "هذه الطريقة"}.`
      : "طرق اللعب تتغيّر بين التحدّيات حسب اختياراتك.";

  const startLabel =
    missingPlayers === 0
      ? "ابدأ اللعبة"
      : missingPlayers === 1
        ? "ننتظر لاعب واحد"
        : `ننتظر ${missingPlayers} لاعبين`;

  return (
    <div className="screen host host-lobby-screen">
      <div className="center" style={{ marginBottom: 8 }}>
        <h1 className="brand">خلك طبيعي</h1>
      </div>

      <div className="host-grid">
        <div className="card codebox">
          <span className="code-label">كود الغرفة</span>
          <span className="code-value">{view.room.code}</span>
          <button
            className="btn btn-ghost btn-sm"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(view.room.code);
                setCopied(true);
                setTimeout(() => setCopied(false), 1_500);
              } catch {
                // Clipboard access can be unavailable on non-secure local origins.
              }
            }}
          >
            {copied ? "تم النسخ ✓" : "نسخ الكود"}
          </button>
          <div style={{ marginTop: 18 }}>
            <Qr url={view.room.joinUrl} />
          </div>
          <span className="helper" style={{ direction: "ltr" }}>
            {view.room.joinUrl}
          </span>
        </div>

        <div className="stack host-lobby-controls">
          <div className="card">
            <div className="row between" style={{ marginBottom: 12 }}>
              <span className="code-label">اللاعبين</span>
              <span className="count-pill">
                {active} <small>/ {view.room.maxPlayers}</small>
              </span>
            </div>
            {view.players.length === 0 ? (
              <p className="subtitle">امسحوا الرمز بالجوال عشان تدخلون…</p>
            ) : (
              <Players players={view.players} canKick onKick={(uid) => actions.kick(uid)} />
            )}
          </div>

          <div className="card stack">
            <span className="code-label">طريقة احتساب الفوز</span>
            <div className="mode-select-grid">
              <button
                className={`mode-select-card${view.room.playStyle === "TEAM" ? " selected" : ""}`}
                aria-pressed={view.room.playStyle === "TEAM"}
                onClick={() => actions.setSettings({ playStyle: "TEAM" })}
              >
                <span className="mode-select-icon" aria-hidden="true">🤝</span>
                <strong>جماعي</strong>
                <span className="mode-select-description">
                  مثل اللعب الحالي: لازم أكثر من نصف المجموعة تصوّت على المتخفي عشان ينكشف. بدون نقاط فردية.
                </span>
                <span className="mode-select-state">
                  {view.room.playStyle === "TEAM" ? "مختار ✓" : "اضغط للاختيار"}
                </span>
              </button>
              <button
                className={`mode-select-card${view.room.playStyle === "INDIVIDUAL" ? " selected" : ""}`}
                aria-pressed={view.room.playStyle === "INDIVIDUAL"}
                onClick={() => actions.setSettings({ playStyle: "INDIVIDUAL" })}
              >
                <span className="mode-select-icon" aria-hidden="true">🏅</span>
                <strong>فردي بالنقاط</strong>
                <span className="mode-select-description">
                  كل واحد يحسب اختياره لنفسه: التصويت الصحيح +1، والمتخفي إذا نجا من الجولة +2. الأغلبية تظل تحدد نهاية الجولة.
                </span>
                <span className="mode-select-state">
                  {view.room.playStyle === "INDIVIDUAL" ? "مختار ✓" : "اضغط للاختيار"}
                </span>
              </button>
            </div>

            <span className="code-label" style={{ marginTop: 8 }}>اختر طرق اللعب</span>
            <div className="mode-select-grid">
              {view.room.availableModes.map((mode) => {
                const selected = modes.has(mode.id);
                return (
                  <button
                    key={mode.id}
                    className={`mode-select-card${selected ? " selected" : ""}`}
                    aria-pressed={selected}
                    onClick={() => toggleMode(mode.id)}
                  >
                    <span className="mode-select-icon" aria-hidden="true">
                      {mode.icon}
                    </span>
                    <strong>{mode.fullLabel}</strong>
                    <span className="mode-select-description">{mode.description}</span>
                    <span className="mode-select-state">
                      {selected ? "مختار ✓" : "اضغط للاختيار"}
                    </span>
                  </button>
                );
              })}
            </div>
            <p className="helper center mode-summary">{modeSummary}</p>

            <span className="code-label" style={{ marginTop: 8 }}>
              عدد الجولات
            </span>
            <div className="rounds">
              {ROUND_OPTIONS.map((rounds) => (
                <button
                  key={rounds}
                  className={`round-opt${totalRounds === rounds ? " on" : ""}`}
                  onClick={() => actions.setSettings({ totalRounds: rounds })}
                >
                  {rounds}
                </button>
              ))}
            </div>
          </div>

          <button
            className="btn btn-primary"
            disabled={!canStart}
            onClick={() => actions.startGame()}
          >
            {startLabel}
          </button>
        </div>
      </div>

      <CloseRoom />
    </div>
  );
}

function HostReady({ view }: { view: ClientView }) {
  const progress = view.readyProgress ?? {
    submitted: 0,
    total: view.players.length,
  };
  const mode = modeInfo(view);

  return (
    <HostStage>
      <div className="eyebrow">{roundLabel(view)}</div>
      <div className="host-mode-mark">
        {mode ? `${mode.icon} ${mode.label}` : "استعدوا"}
      </div>
      <h1 className="title host-stage-heading">شوفوا جوالاتكم</h1>
      <p className="subtitle">كل واحد يشوف المطلوب منه بجواله ويضغط جاهز</p>
      <div className="card host-progress-card">
        <Progress submitted={progress.submitted} total={progress.total} verb="جاهزين" />
      </div>
    </HostStage>
  );
}

function HostCountdown({ view }: { view: ClientView }) {
  const [, tick] = useState(0);
  const instruction = countdownInstruction(modeInfo(view));

  useEffect(() => {
    const id = window.setInterval(() => tick((value) => value + 1), 100);
    return () => clearInterval(id);
  }, []);

  const seconds = visibleCountdownSecond(view.room.phaseEndsAt, estimatedServerNow()) ?? 1;

  return (
    <HostStage className="host-countdown-stage">
      <div className="eyebrow">استعدوا…</div>
      <div className="host-countdown-number">{seconds}</div>
      <div
        className="host-countdown-instruction"
        style={{
          width: "min(100%, 760px)",
          fontSize: "clamp(22px, 2.8vw, 34px)",
          fontWeight: 800,
          lineHeight: 1.45,
        }}
      >
        <div>{instruction.main}</div>
        {instruction.detail ? (
          <div
            style={{
              marginTop: 4,
              color: "var(--muted)",
              fontSize: "clamp(16px, 1.7vw, 22px)",
              fontWeight: 700,
            }}
          >
            {instruction.detail}
          </div>
        ) : null}
      </div>
    </HostStage>
  );
}

function HostAction({ view }: { view: ClientView }) {
  const mode = modeInfo(view);
  return (
    <HostStage className="host-action-stage">
      <h1 className="host-action-title">{mode?.actionLabel ?? "الحين!"}</h1>
    </HostStage>
  );
}

function HostHold() {
  return (
    <HostStage className="host-hold-stage">
      <h1 className="host-hold-title">ثبّتوا…</h1>
      <p className="subtitle host-hold-subtitle">طالعوا بعض</p>
    </HostStage>
  );
}

function HostPromptReveal({ view }: { view: ClientView }) {
  return (
    <HostStage>
      <div className="eyebrow host-prompt-eyebrow">المطلوب كان…</div>
      <h1 className="host-prompt host-prompt-reveal">{view.publicPrompt?.text ?? "…"}</h1>
    </HostStage>
  );
}

function HostDiscussion({ view }: { view: ClientView }) {
  return (
    <HostStage className="host-discussion-stage">
      <div className="eyebrow">{roundLabel(view)}</div>
      <div className="eyebrow host-prompt-eyebrow">المطلوب كان</div>
      <div className="host-prompt host-prompt-discussion">{view.publicPrompt?.text ?? "…"}</div>
      <h1 className="title host-discussion-question">مين تصرفه مو طبيعي؟</h1>
      <button className="btn btn-primary" onClick={() => actions.startVoting()}>
        ابدأ التصويت
      </button>
      <CloseRoom />
    </HostStage>
  );
}

function HostVoting({ view }: { view: ClientView }) {
  const progress = view.votesProgress ?? { submitted: 0, total: 0, requiredVotes: 0 };
  const liveRows =
    view.liveVoteTally ??
    view.players.map((player) => ({ uid: player.uid, name: player.name, votes: 0 }));
  const percent = progress.total ? (progress.submitted / progress.total) * 100 : 0;

  return (
    <HostStage className="host-voting-stage">
      <div className="eyebrow">{roundLabel(view)}</div>
      <h1 className="title host-voting-title">صوّتوا</h1>

      <div className="vote-progress-summary">
        <strong>
          {progress.submitted} من {progress.total} صوّتوا
        </strong>
        <div className="vote-progress-bar" aria-hidden="true">
          <i style={{ width: `${percent}%` }} />
        </div>
      </div>

      <VoteBoard rows={liveRows} live />

      {progress.requiredVotes > 0 ? (
        <p className="vote-majority-note">
          {view.room.playStyle === "INDIVIDUAL"
            ? `كل تصويت صحيح ينحسب لصاحبه، و${progress.requiredVotes} أصوات تكشف المتخفي جماعيًا`
            : `يحتاج المتخفي ${progress.requiredVotes} أصوات عشان ينكشف`}
        </p>
      ) : null}
    </HostStage>
  );
}

function Scoreboard({ rows, round }: { rows: ScoreEntry[]; round?: boolean }) {
  return (
    <div className="card stack" style={{ width: "min(100%, 680px)" }}>
      <div className="code-label">{round ? "النقاط بعد الجولة" : "الترتيب النهائي"}</div>
      {rows.map((row) => (
        <div key={row.uid} className="row between host-summary-row">
          <span>#{row.rank} {row.name}</span>
          <strong>
            {row.score} نقطة
            {round && (row.roundDelta ?? 0) > 0 ? ` (+${row.roundDelta})` : ""}
          </strong>
        </div>
      ))}
    </div>
  );
}

function HostResult({ view }: { view: ClientView }) {
  const result = view.result;
  const next = result?.roundComplete
    ? view.room.currentRound >= view.room.totalRounds
      ? "شوفوا ملخص اللعبة"
      : "الجولة الجاية"
    : result
      ? `التحدّي ${Math.min(result.challengeIndex + 1, result.maxChallenges)}`
      : "التحدّي الجاي";

  return (
    <HostStage className="host-result-stage">
      <div className="card host-result-panel">{result ? <ResultBody result={result} /> : null}</div>
      {result?.roundComplete && view.scoreboard ? <Scoreboard rows={view.scoreboard} round /> : null}
      <button className="btn btn-primary" onClick={() => actions.nextRound()}>
        {next}
      </button>
    </HostStage>
  );
}

function HostGameOver({ view }: { view: ClientView }) {
  const gameOver = view.gameOver;

  return (
    <HostStage className="host-game-over-stage">
      <h1 className="brand">خلصت اللعبة 🎉</h1>
      {gameOver ? (
        <>
          <p className="subtitle host-game-over-summary">
            مسكتوا المتخفي في {gameOver.caughtRounds} من {gameOver.totalRounds} جولات
          </p>
          <div className="card stack host-game-over-card">
            <div className="row between host-summary-row">
              <span>انكشف</span>
              <span>{gameOver.caughtRounds}</span>
            </div>
            <div className="row between host-summary-row">
              <span>نجا</span>
              <span>{gameOver.escapedRounds}</span>
            </div>
          </div>
        </>
      ) : null}
      {view.scoreboard ? <Scoreboard rows={view.scoreboard} /> : null}
      <div className="row host-game-over-actions">
        <button className="btn btn-primary" onClick={() => actions.rematch()}>
          العبوا مرة ثانية
        </button>
        <button className="btn btn-ghost" onClick={() => actions.closeRoom()}>
          الرئيسية
        </button>
      </div>
    </HostStage>
  );
}
