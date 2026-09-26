import { useState } from "react";
import type { ClientView, GameMode } from "../../../shared/types.js";
import { CHALLENGE_OPTIONS, MIN_PLAYERS } from "../../../shared/constants.js";
import { actions } from "../net/socket.js";
import { Qr } from "../components/Qr.js";
import { Players } from "../components/Players.js";
import { GameOverStats, ResultBody, Scoreboard, Winners } from "../components/Bits.js";
import { TvStage } from "../components/TvStage.js";
import { stintRuleText, waitForPlayersText } from "../i18n/counts.js";
import { EyesMark } from "../ui/EyesMark.js";
import { Icon } from "../ui/Icon.js";
import { PhoneResultDetails } from "./Player.js";

export interface ConfirmActionRequest {
  title: string;
  description: string;
  confirmLabel: string;
  actionType: "KICK_PLAYER" | "CLOSE_ROOM" | "LEAVE_ROOM" | "NEXT_ROUND";
  targetUid?: string;
  run: () => string | null;
}

type ConfirmAction = (request: ConfirmActionRequest) => void;

/**
 * Management surfaces. A room owner is a player, so LOBBY / RESULT / GAME_OVER
 * here are phone-first. A legacy external host screen reuses the shared TV
 * stage for the challenge flow.
 */
export function Host({ view, confirmAction }: { view: ClientView; confirmAction: ConfirmAction }) {
  switch (view.room.phase) {
    case "LOBBY": return <HostLobby view={view} confirmAction={confirmAction} />;
    case "RESULT": return <HostResult view={view} confirmAction={confirmAction} />;
    case "GAME_OVER": return <HostGameOver view={view} confirmAction={confirmAction} />;
    default: return <TvStage view={view} />;
  }
}

function requestClose(confirmAction: ConfirmAction, description = "بتنقفل الغرفة على الكل وتنتهي اللعبة الحالية.") {
  confirmAction({
    title: "إغلاق الغرفة؟",
    description,
    confirmLabel: "إغلاق الغرفة",
    actionType: "CLOSE_ROOM",
    run: actions.closeRoom,
  });
}

function HostLobby({ view, confirmAction }: { view: ClientView; confirmAction: ConfirmAction }) {
  const [copied, setCopied] = useState<"code" | "link" | null>(null);
  const active = view.players.filter((player) => player.connected).length;
  const modes = new Set(view.room.selectedModes);
  const canStart = active >= MIN_PLAYERS && modes.size > 0;
  const missingPlayers = Math.max(0, MIN_PLAYERS - active);
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const toggleMode = (id: GameMode) => {
    const next = new Set(modes);
    if (next.has(id)) {
      if (next.size === 1) return;
      next.delete(id);
    } else next.add(id);
    actions.setSettings({ selectedModes: [...next] });
  };

  const modeSummary = modes.size === 1
    ? `كل التحدّيات بتكون بطريقة ${view.room.availableModes.find((mode) => modes.has(mode.id))?.fullLabel ?? "هذه الطريقة"}.`
    : "طرق اللعب تتغيّر بين التحدّيات حسب اختياراتك.";
  const startLabel = waitForPlayersText(missingPlayers);

  const copy = async (value: string, kind: "code" | "link") => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(kind);
      window.setTimeout(() => setCopied((current) => current === kind ? null : current), 1_500);
    } catch { /* Clipboard can be unavailable on local non-secure origins. */ }
  };

  const share = async () => {
    try {
      await navigator.share({ title: "خلك طبيعي", text: `ادخل غرفتنا في خلك طبيعي: ${view.room.code}`, url: view.room.joinUrl });
    } catch { /* Share sheet dismissed. */ }
  };

  const confirmKick = (uid: string) => {
    const player = view.players.find((candidate) => candidate.uid === uid);
    if (!player) return;
    confirmAction({
      title: `إخراج ${player.name}؟`,
      description: "بيطلع من الغرفة وما يقدر يرجع بنفس الهوية إلا إذا سمحت له من إدارة اللاعبين.",
      confirmLabel: "إخراج",
      actionType: "KICK_PLAYER",
      targetUid: uid,
      run: () => actions.kick(uid),
    });
  };

  return (
    <div className="screen host host-lobby-screen owner-lobby has-utility-bar">
      <div className="owner-lobby-grid">
        <section className="invite-panel" aria-labelledby="owner-invite-title">
          <div className="invite-head">
            <EyesMark size={40} glance={false} />
            <div>
              <h1 className="invite-title" id="owner-invite-title">خلّ الكل يدخل</h1>
              <p className="invite-lede">يمسحون الرمز، أو يكتبون الكود في اللعبة.</p>
            </div>
          </div>
          <div className="invite-body">
            <Qr url={view.room.joinUrl} size={480} />
            <div className="invite-code">
              <span className="code-label">كود الغرفة</span>
              <span className="code-value" aria-label={`كود الغرفة ${view.room.code.split("").join(" ")}`}>
                {view.room.code.split("").map((char, index) => <span className="code-char" key={index}>{char}</span>)}
              </span>
              <div className="invite-actions">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void copy(view.room.code, "code")}>
                  <Icon name={copied === "code" ? "check" : "copy"} /> {copied === "code" ? "تم النسخ ✓" : "نسخ الكود"}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => canShare ? void share() : void copy(view.room.joinUrl, "link")}
                >
                  <Icon name={canShare ? "share" : copied === "link" ? "check" : "copy"} /> {canShare ? "مشاركة الرابط" : copied === "link" ? "تم النسخ ✓" : "نسخ الرابط"}
                </button>
              </div>
            </div>
          </div>
        </section>

        <div className="owner-lobby-side">
          <section className="lobby-section" aria-labelledby="owner-roster-title">
            <header className="lobby-section-head">
              <h2 className="section-title" id="owner-roster-title">اللاعبين</h2>
              <span className="count-pill">{active} <small>/ {view.room.maxPlayers}</small></span>
            </header>
            {view.players.length === 0
              ? <p className="subtitle">امسحوا الرمز بالجوال عشان تدخلون…</p>
              : <Players players={view.players} selfUid={view.self.uid} canKick onKick={confirmKick} />}
            {missingPlayers > 0 ? <p className="lobby-hint">نحتاج {MIN_PLAYERS} لاعبين على الأقل عشان نبدأ.</p> : null}
          </section>

          <section className="lobby-section settings-panel" aria-labelledby="owner-settings-title">
            <h2 className="section-title" id="owner-settings-title">إعدادات المباراة</h2>

            <div className="setting">
              <div className="setting-head">
                <span className="setting-label" id="owner-challenges-label">عدد التحدّيات</span>
                <strong className="setting-value">🏅 {view.room.targetChallenges} تحدّيات</strong>
              </div>
              <div role="radiogroup" aria-label="عدد التحدّيات" className="segmented">
                {CHALLENGE_OPTIONS.map((count) => {
                  const selected = view.room.targetChallenges === count;
                  return (
                    <button
                      key={count}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      className="segment"
                      onClick={() => actions.setSettings({ totalRounds: count })}
                    >
                      {count}
                    </button>
                  );
                })}
              </div>
              <ul className="setting-notes">
                <li>المباراة تنتهي عند عدد التحدّيات المختار بالضبط.</li>
                <li>{stintRuleText(view.room.impostorStintMax)}</li>
                <li>كل لاعب يجمع نقاطه، وأغلبية الأصوات اللي انرسلت هي اللي تمسك المتخفي.</li>
              </ul>
            </div>

            <div className="setting">
              <span className="setting-label">طرق اللعب</span>
              <div className="mode-switches">
                {view.room.availableModes.map((mode) => {
                  const selected = modes.has(mode.id);
                  const locked = selected && modes.size === 1;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      className="switch-row mode-select-card"
                      aria-pressed={selected}
                      aria-disabled={locked || undefined}
                      onClick={() => toggleMode(mode.id)}
                    >
                      <span className="switch-row-icon" aria-hidden="true">{mode.icon}</span>
                      <span className="switch-row-text">
                        <strong>{mode.fullLabel}</strong>
                        <span>{mode.description}</span>
                      </span>
                      <span className="switch" aria-hidden="true" />
                    </button>
                  );
                })}
              </div>
              <p className="setting-foot mode-summary">{modeSummary}</p>
            </div>
          </section>
        </div>
      </div>

      <div className="owner-dock lobby-dock">
        <button className="btn btn-primary" disabled={!canStart} onClick={() => actions.startGame()}>{startLabel}</button>
        <button type="button" className="link-btn danger" onClick={() => requestClose(confirmAction)}>إغلاق الغرفة</button>
      </div>
    </div>
  );
}

function HostResult({ view, confirmAction }: { view: ClientView; confirmAction: ConfirmAction }) {
  const result = view.result;
  const fullReveal = result?.roundComplete === true;
  const advance = () => {
    if (!view.nextRoundWarning) {
      actions.nextRound();
      return;
    }
    confirmAction({
      title: "الرجوع لشاشة الانتظار؟",
      description: view.nextRoundWarning,
      confirmLabel: "ارجع لشاشة الانتظار",
      actionType: "NEXT_ROUND",
      run: actions.nextRound,
    });
  };
  return (
    <div className={`screen host-result-stage player-result-screen${fullReveal ? " is-full" : " is-light"}`} data-moment="result">
      {result ? <ResultBody result={result} players={view.players} showTally={false} /> : null}
      <PhoneResultDetails view={view} />
      <div className="spacer" />
      <div className="owner-dock">
        <button className="btn btn-primary" onClick={advance}>{fullReveal ? "التالي" : "التحدّي التالي"}</button>
        <p className="helper">النتيجة تبقى قدامكم لين تضغط التالي.</p>
      </div>
    </div>
  );
}

function HostGameOver({ view, confirmAction }: { view: ClientView; confirmAction: ConfirmAction }) {
  const gameOver = view.gameOver;
  return (
    <div className="screen gameover-screen host-game-over-stage has-utility-bar" data-moment="gameover">
      <header className="gameover-hero">
        <h1 className="gameover-title"><span className="brand">خلصت اللعبة</span> 🎉</h1>
        {view.scoreboard ? <Winners rows={view.scoreboard} players={view.players} /> : null}
      </header>
      {gameOver ? <GameOverStats gameOver={gameOver} /> : null}
      {view.scoreboard ? <Scoreboard rows={view.scoreboard} players={view.players} selfUid={view.self.uid} /> : null}
      <div className="spacer" />
      <div className="owner-dock">
        <div className="owner-dock-row">
          <button className="btn btn-primary" onClick={() => actions.rematch()}>العبوا مرة ثانية</button>
          <button className="btn btn-secondary" onClick={() => requestClose(confirmAction, "بتقفل الغرفة الحالية وترجع الكل للرئيسية.")}>إغلاق الغرفة</button>
        </div>
      </div>
    </div>
  );
}
