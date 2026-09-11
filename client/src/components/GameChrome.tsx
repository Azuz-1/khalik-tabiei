import { useEffect, useMemo, useRef, useState } from "react";
import { useGame } from "../net/socket.js";

export function GameChrome() {
  const { view, status } = useGame();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetMessage, setSheetMessage] = useState<string | null>(null);
  const [showRestored, setShowRestored] = useState(false);
  const hadConnection = useRef(false);
  const wasDisconnected = useRef(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const sheetRef = useRef<HTMLElement>(null);

  const activeRoom = view != null && !["LOBBY", "GAME_OVER", "CLOSED"].includes(view.room.phase);
  const canManageRoom = view?.self.isOwner === true || view?.self.role === "host";

  useEffect(() => {
    document.documentElement.classList.toggle("game-hud-active", activeRoom);
    if (!activeRoom) setMenuOpen(false);
    return () => document.documentElement.classList.remove("game-hud-active");
  }, [activeRoom]);

  useEffect(() => {
    if (!menuOpen) return;
    sheetRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setMenuOpen(false);
      window.requestAnimationFrame(() => menuButtonRef.current?.focus());
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

  // Settlement increments completedChallenges before RESULT is rendered, so RESULT
  // must keep showing the challenge that just finished instead of jumping ahead.
  const activeChallengeOrdinal = view.room.phase === "RESULT"
    ? Math.max(1, view.room.completedChallenges)
    : view.room.completedChallenges + 1;
  const challengeNumber = Math.min(view.room.targetChallenges, activeChallengeOrdinal);
  const stintNumber = view.challenge?.index ?? 1;
  const stintMax = view.challenge?.max ?? 3;
  const offlineCount = orderedPlayers.filter((player) => !player.connected).length;

  const closeMenu = () => {
    setMenuOpen(false);
    window.requestAnimationFrame(() => menuButtonRef.current?.focus());
  };

  const clickLegacyControl = (selector: string) => {
    setMenuOpen(false);
    window.setTimeout(() => document.querySelector<HTMLButtonElement>(selector)?.click(), 0);
  };

  const copyDisplayLink = async () => {
    setSheetMessage(null);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(view.room.code)}/display-link`, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const body = await response.json() as { path?: string };
      if (!response.ok || !body.path) throw new Error("display link unavailable");
      const url = new URL(body.path, location.origin).href;
      await navigator.clipboard.writeText(url);
      setSheetMessage("تم نسخ رابط شاشة العرض ✓");
    } catch {
      setSheetMessage("ما قدرنا ننسخ رابط العرض. جرّب مرة ثانية.");
    }
  };

  return (
    <>
      <div className="game-hud-wrap">
        <header className="game-hud" aria-label="حالة اللعبة">
          <div className="game-hud-status" dir="rtl">
            <span>التحدّي {challengeNumber}/{view.room.targetChallenges}</span>
            <span className="game-hud-separator" aria-hidden="true">•</span>
            <span>دور المتخفي {stintNumber}/{stintMax}</span>
            {offlineCount > 0 ? <span className="game-hud-offline" aria-label={`${offlineCount} غير متصل`}>◌ {offlineCount}</span> : null}
          </div>
          <button
            ref={menuButtonRef}
            type="button"
            className="game-hud-menu"
            aria-label="المزيد"
            aria-expanded={menuOpen}
            aria-controls="game-options-sheet"
            onClick={() => { setSheetMessage(null); setMenuOpen(true); }}
          >
            ⋯
          </button>
        </header>
        {showRestored ? <div className="connection-restored-toast" role="status">رجع الاتصال ✓</div> : null}
      </div>

      {menuOpen ? (
        <div className="game-sheet-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) closeMenu(); }}>
          <section
            ref={sheetRef}
            id="game-options-sheet"
            className="game-sheet"
            role="dialog"
            aria-modal="true"
            aria-label="خيارات اللعبة"
            tabIndex={-1}
          >
            <div className="game-sheet-handle" aria-hidden="true" />
            <div className="row between game-sheet-heading">
              <div>
                <strong>خيارات اللعبة</strong>
                <div className="helper">غرفة <span dir="ltr">{view.room.code}</span></div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={closeMenu}>إغلاق</button>
            </div>

            <div className="game-sheet-players" aria-label="اللاعبين">
              {orderedPlayers.map((player) => (
                <div key={player.uid} className="game-sheet-player">
                  <span className="game-sheet-player-name" dir="auto">{player.name}{player.uid === view.self.uid ? " · أنت" : ""}</span>
                  <span className={`game-sheet-presence ${player.connected ? "online" : "offline"}`}>
                    {player.connected ? "متصل" : "منقطع"}
                  </span>
                </div>
              ))}
            </div>

            {canManageRoom ? (
              <div className="game-sheet-actions">
                <button type="button" className="btn btn-ghost" onClick={() => clickLegacyControl(".floating-players")}>إدارة اللاعبين</button>
                <button type="button" className="btn btn-ghost" disabled={status !== "online"} onClick={copyDisplayLink}>📺 نسخ رابط شاشة العرض</button>
              </div>
            ) : null}

            {sheetMessage ? <div className="game-sheet-message" role="status">{sheetMessage}</div> : null}

            <button
              type="button"
              className="btn btn-ghost game-sheet-danger"
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
