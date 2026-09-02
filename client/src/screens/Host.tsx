import { useEffect, useState } from "react";
import type { ClientView, GameMode, GameModeInfo } from "../../../shared/types.js";
import { MIN_PLAYERS, ROUND_OPTIONS } from "../../../shared/constants.js";
import { actions } from "../net/socket.js";
import { Qr } from "../components/Qr.js";
import { Players, Progress } from "../components/Players.js";
import { ResultBody, roundLabel } from "../components/Bits.js";

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

function CloseRoom() {
  return (
    <div className="footer-note">
      <button
        className="link-btn"
        onClick={() => confirm("إغلاق الغرفة للجميع؟") && actions.closeRoom()}
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
      ? `مختار: ${view.room.availableModes.find((mode) => modes.has(mode.id))?.label ?? ""} فقط`
      : "كل جولة تاخذ مود واحد بالتناوب المتوازن 🎲";

  return (
    <div className="screen host">
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

        <div className="stack">
          <div className="card">
            <div className="row between" style={{ marginBottom: 12 }}>
              <span className="code-label">اللاعبين</span>
              <span className="count-pill">
                {active} <small>/ {view.room.maxPlayers}</small>
              </span>
            </div>
            {view.players.length === 0 ? (
              <p className="subtitle">امسحوا الكود من جوالكم عشان تدخلون…</p>
            ) : (
              <Players players={view.players} canKick onKick={(uid) => actions.kick(uid)} />
            )}
          </div>

          <div className="card stack">
            <span className="code-label">اختر طرق اللعب</span>
            <div className="cats">
              {view.room.availableModes.map((mode) => (
                <button
                  key={mode.id}
                  className={`cat${modes.has(mode.id) ? " on" : ""}`}
                  onClick={() => toggleMode(mode.id)}
                >
                  <strong>
                    {mode.icon} {mode.label}
                  </strong>
                  <br />
                  <small>{mode.description}</small>
                </button>
              ))}
            </div>
            <p className="helper center">{modeSummary}</p>

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
            {active < MIN_PLAYERS ? `ننتظر ${MIN_PLAYERS - active} لاعبين` : "ابدأ اللعبة"}
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
  const firstChallenge = (view.challenge?.index ?? 1) === 1;

  return (
    <div className="screen host center stack">
      <div className="spacer" />
      <div className="eyebrow">{roundLabel(view)}</div>
      <h1 className="title" style={{ fontSize: "clamp(44px,8vw,88px)" }}>
        {mode ? `${mode.icon} ${mode.label}` : "استعدوا"}
      </h1>

      {mode ? (
        firstChallenge ? (
          <div className="stack" style={{ gap: 8, maxWidth: 720, marginInline: "auto" }}>
            {mode.roundInstructions.map((instruction) => (
              <p key={instruction} className="subtitle" style={{ margin: 0 }}>
                {instruction}
              </p>
            ))}
            <span className="pill-note" style={{ marginInline: "auto" }}>
              هذا المود ثابت طول الجولة
            </span>
          </div>
        ) : (
          <p className="subtitle">نفس المود مستمر — {mode.description}</p>
        )
      ) : null}

      <h2 className="title" style={{ fontSize: "clamp(28px,5vw,48px)", marginTop: 18 }}>
        شوفوا جوالاتكم 👀
      </h2>
      <p className="subtitle">كل واحد يشوف دوره ويضغط جاهز</p>
      <div className="card" style={{ maxWidth: 520, marginInline: "auto", width: "100%" }}>
        <Progress submitted={progress.submitted} total={progress.total} verb="جاهزين" />
      </div>
      <div className="spacer" />
    </div>
  );
}

function HostCountdown({ view }: { view: ClientView }) {
  const [, tick] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => tick((value) => value + 1), 100);
    return () => clearInterval(id);
  }, []);

  const remaining = Math.max(0, (view.room.phaseEndsAt ?? Date.now()) - Date.now());
  const seconds = Math.max(1, Math.min(5, Math.ceil(remaining / 1_000)));

  return (
    <div className="screen host center stack">
      <div className="spacer" />
      <div className="eyebrow">استعدوا…</div>
      <div
        className="title"
        style={{ fontSize: "clamp(140px,34vw,360px)", lineHeight: 0.95, margin: 0 }}
      >
        {seconds}
      </div>
      <div className="spacer" />
    </div>
  );
}

function HostAction({ view }: { view: ClientView }) {
  const mode = modeInfo(view);
  return (
    <div className="screen host center stack">
      <div className="spacer" />
      <h1 className="title" style={{ fontSize: "clamp(72px,16vw,180px)" }}>
        {mode?.actionLabel ?? "الحين! 👀"}
      </h1>
      <div className="spacer" />
    </div>
  );
}

function HostHold() {
  return (
    <div className="screen host center stack">
      <div className="spacer" />
      <h1 className="title" style={{ fontSize: "clamp(64px,13vw,150px)" }}>
        ثبّتوا… 👀
      </h1>
      <p className="subtitle" style={{ fontSize: "clamp(24px,4vw,42px)" }}>
        طالعوا بعض
      </p>
      <div className="spacer" />
    </div>
  );
}

function HostPromptReveal({ view }: { view: ClientView }) {
  return (
    <div className="screen host center stack">
      <div className="spacer" />
      <div className="eyebrow" style={{ fontSize: "clamp(18px,3vw,30px)" }}>
        المطلوب كان…
      </div>
      <h1
        className="title"
        style={{ fontSize: "clamp(42px,8vw,92px)", maxWidth: 980, marginInline: "auto" }}
      >
        {view.publicPrompt?.text ?? "…"}
      </h1>
      <div className="spacer" />
    </div>
  );
}

function HostDiscussion({ view }: { view: ClientView }) {
  return (
    <div className="screen host center stack">
      <div className="spacer" />
      <div className="eyebrow">{roundLabel(view)}</div>
      <div className="eyebrow" style={{ marginTop: 8 }}>
        المطلوب كان
      </div>
      <div
        className="title"
        style={{ fontSize: "clamp(34px,6vw,68px)", maxWidth: 980, marginInline: "auto" }}
      >
        {view.publicPrompt?.text ?? "…"}
      </div>
      <h1 className="title" style={{ fontSize: "clamp(36px,7vw,76px)", marginTop: 18 }}>
        مين تصرفه مو طبيعي؟ 👀
      </h1>
      <button
        className="btn btn-primary"
        style={{ maxWidth: 480 }}
        onClick={() => actions.startVoting()}
      >
        ابدأ التصويت
      </button>
      <div className="spacer" />
      <CloseRoom />
    </div>
  );
}

function HostVoting({ view }: { view: ClientView }) {
  const progress = view.votesProgress ?? { submitted: 0, total: 0, requiredVotes: 0 };

  return (
    <div className="screen host center stack">
      <div className="spacer" />
      <div className="eyebrow">{roundLabel(view)}</div>
      <h1 className="title">صوّتوا من جوالكم 🤫</h1>
      <div className="card" style={{ maxWidth: 520, marginInline: "auto", width: "100%" }}>
        <Progress submitted={progress.submitted} total={progress.total} verb="صوّتوا" />
      </div>
      <p className="subtitle">
        يحتاج المتخفي {progress.requiredVotes} أصوات أو أكثر عشان ينكشف
      </p>
      <div className="spacer" />
    </div>
  );
}

function HostResult({ view }: { view: ClientView }) {
  const result = view.result;
  const next = result?.roundComplete
    ? view.room.currentRound >= view.room.totalRounds
      ? "شوفوا ملخص اللعبة 🎉"
      : "الجولة الجاية"
    : `التحدي ${Math.min((result?.challengeIndex ?? 1) + 1, 3)} 👀`;

  return (
    <div className="screen host center stack">
      <div className="spacer" />
      <div className="card" style={{ maxWidth: 720, width: "100%", marginInline: "auto" }}>
        {result ? <ResultBody result={result} /> : null}
      </div>
      <button
        className="btn btn-primary"
        style={{ maxWidth: 520 }}
        onClick={() => actions.nextRound()}
      >
        {next}
      </button>
      <div className="spacer" />
    </div>
  );
}

function HostGameOver({ view }: { view: ClientView }) {
  const gameOver = view.gameOver;

  return (
    <div className="screen host stack center">
      <div className="spacer" />
      <h1 className="brand">خلصت اللعبة 🎉</h1>
      {gameOver ? (
        <>
          <p className="subtitle" style={{ fontSize: "clamp(24px,4vw,42px)" }}>
            مسكتوا المتخفي في {gameOver.caughtRounds} من {gameOver.totalRounds} جولات 👏
          </p>
          <div className="card stack" style={{ maxWidth: 560, marginInline: "auto", width: "100%" }}>
            <div className="row between" style={{ fontSize: 22, fontWeight: 900 }}>
              <span>✅ انكشف</span>
              <span>{gameOver.caughtRounds}</span>
            </div>
            <div className="row between" style={{ fontSize: 22, fontWeight: 900 }}>
              <span>😈 نجا</span>
              <span>{gameOver.escapedRounds}</span>
            </div>
          </div>
        </>
      ) : null}
      <div className="row" style={{ maxWidth: 560, marginInline: "auto", width: "100%" }}>
        <button className="btn btn-primary" onClick={() => actions.rematch()}>
          العبوا مرة ثانية
        </button>
        <button className="btn btn-ghost" onClick={() => actions.closeRoom()}>
          الرئيسية
        </button>
      </div>
      <div className="spacer" />
    </div>
  );
}
