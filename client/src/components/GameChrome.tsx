import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useGame } from "../net/socket.js";
import { Avatar, colorSlotLookup } from "../ui/Avatar.js";
import { Icon } from "../ui/Icon.js";
import { MatchProgress } from "../ui/Meters.js";
import { useModalFocus } from "../ui/useModalFocus.js";

/**
 * Gameplay chrome: a quiet top rail with match progress + one menu. Room
 * management lives behind the sheet so it never competes with the moment.
 */
export function GameChrome() {
  const { view, status } = useGame();
  const [menuOpen, setMenuOpen] = useState(false);
  const [showRestored, setShowRestored] = useState(false);
  const hadConnection = useRef(false);
  const wasDisconnected = useRef(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);
  const titleId = useId();

  const activeRoom = view != null && !["LOBBY", "GAME_OVER", "CLOSED"].includes(view.room.phase);
  const canManageRoom = view?.self.isOwner === true || view?.self.role === "host";

  useModalFocus(sheetRef, menuOpen);

  useEffect(() => {
    document.documentElement.classList.toggle("game-hud-active", activeRoom);
    if (!activeRoom) setMenuOpen(false);
    return () => document.documentElement.classList.remove("game-hud-active");
  }, [activeRoom]);

  useEffect(() => {
    document.documentElement.classList.toggle("game-hud-owner", activeRoom && canManageRoom);
    return () => document.documentElement.classList.remove("game-hud-owner");
  }, [activeRoom, canManageRoom]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMenuOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [menuOpen]);

  useEffect(() => {
    if (status === "online") {
      if (wasDisconnected.current && hadConnection.current) {
        setShowRestored(true);
        const timer = window.setTimeout(() => setShowRestored(false), 1_800);
        wasDisconnected.current = false;
        return () => window.clearTimeout(timer);
      }
      hadConnection.current = true;
      wasDisconnected.current = false;
      return;
    }
    if (hadConnection.current) wasDisconnected.current = true;
    setShowRestored(false);
  }, [status]);

  const orderedPlayers = useMemo(
    () => [...(view?.players ?? [])].sort((a, b) => a.seatNumber - b.seatNumber),
    [view?.players],
  );

  if (!view || !activeRoom) return null;
  const slotOf = colorSlotLookup(view.players);

  // Settlement increments completedChallenges before RESULT is rendered, so RESULT
  // must keep showing the challenge that just finished instead of jumping ahead.
  const activeChallengeOrdinal = view.room.phase === "RESULT"
    ? Math.max(1, view.room.completedChallenges)
    : view.room.completedChallenges + 1;
  const challengeNumber = Math.max(1, Math.min(view.room.targetChallenges, activeChallengeOrdinal));
  // Stint numbers are shown only when the server provides them; no client-side cap formula.
  const stint = view.challenge ? { current: view.challenge.index, max: view.challenge.max } : undefined;
  const offlineCount = orderedPlayers.filter((player) => !player.connected).length;
  const summary = `التحدّي ${challengeNumber} من ${view.room.targetChallenges}${stint ? `، دور المتخفي ${stint.current} من ${stint.max}` : ""}`;

  const closeMenu = () => setMenuOpen(false);

  const clickLegacyControl = (selector: string) => {
    setMenuOpen(false);
    window.setTimeout(() => document.querySelector<HTMLButtonElement>(selector)?.click(), 0);
  };

  return (
    <>
      <div className="game-hud-wrap">
        <header className="game-hud" aria-label="حالة اللعبة">
          <div className="game-hud-status" role="group" aria-label={summary}>
            <MatchProgress position={{ challenge: { current: challengeNumber, total: view.room.targetChallenges }, stint }} />
          </div>
          {offlineCount > 0 ? (
            <span className="game-hud-offline" role="status" aria-label={`${offlineCount} غير متصل`}>
              <Icon name="wifi-off" /> <span className="num-ltr">{offlineCount}</span>
            </span>
          ) : null}
          <button
            ref={menuButtonRef}
            type="button"
            className="game-hud-menu icon-btn"
            aria-label="المزيد"
            aria-haspopup="dialog"
            aria-expanded={menuOpen}
            aria-controls="game-options-sheet"
            onClick={() => setMenuOpen(true)}
          >
            <Icon name="more" />
          </button>
        </header>
        {showRestored ? <div className="connection-restored-toast" role="status">رجع الاتصال ✓</div> : null}
      </div>

      {menuOpen ? (
        <div className="sheet-backdrop game-sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeMenu(); }}>
          <section
            ref={sheetRef}
            id="game-options-sheet"
            className="sheet-panel game-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="خيارات اللعبة"
            aria-describedby={titleId}
            tabIndex={-1}
          >
            <div className="sheet-handle" aria-hidden="true" />
            <div className="sheet-header">
              <div>
                <h2>خيارات اللعبة</h2>
                <p id={titleId} className="helper">غرفة <span dir="ltr" className="num-ltr">{view.room.code}</span> · {summary}</p>
              </div>
              <button type="button" className="icon-btn" aria-label="إغلاق" onClick={closeMenu}><Icon name="close" /></button>
            </div>

            <ul className="game-sheet-players" aria-label="اللاعبين">
              {orderedPlayers.map((player) => (
                <li key={player.uid} className="game-sheet-player">
                  <Avatar name={player.name} colorSlot={slotOf(player.uid)} size="sm" offline={!player.connected} />
                  <span className="game-sheet-player-name" dir="auto">{player.name}{player.uid === view.self.uid ? " · أنت" : ""}</span>
                  <span className={`game-sheet-presence ${player.connected ? "online" : "offline"}`}>
                    {player.connected ? "متصل" : "منقطع"}
                  </span>
                </li>
              ))}
            </ul>

            {canManageRoom ? (
              <div className="game-sheet-actions">
                <button type="button" className="btn btn-secondary btn-md" onClick={() => clickLegacyControl(".floating-players")}>
                  <Icon name="users" /> إدارة اللاعبين
                </button>
                <button
                  type="button"
                  className="btn btn-secondary btn-md"
                  disabled={status !== "online"}
                  onClick={() => clickLegacyControl('[data-testid="owner-display-control"]')}
                >
                  📺 العب على التلفزيون
                </button>
              </div>
            ) : null}

            <button
              type="button"
              className="btn btn-danger-quiet btn-md game-sheet-danger"
              disabled={status !== "online"}
              onClick={() => clickLegacyControl(".floating-exit")}
            >
              {canManageRoom ? "إنهاء اللعبة" : "الخروج من الغرفة"}
            </button>
          </section>
        </div>
      ) : null}
    </>
  );
}
