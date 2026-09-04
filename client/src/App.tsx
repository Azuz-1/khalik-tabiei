import { useEffect, useState } from "react";
import { actions, clearNotice, resetToHome, useGame } from "./net/socket.js";
import { errorText } from "./i18n/errors.js";
import { HostAudioLayer } from "./audio/HostAudioLayer.js";
import { Home } from "./screens/Home.js";
import { Host } from "./screens/Host.js";
import { Player } from "./screens/Player.js";

export function App() {
  const { view, status, error, notice } = useGame();
  const [toast, setToast] = useState<{ text: string; id: number } | null>(null);
  const [showConn, setShowConn] = useState(false);

  // Error → transient toast.
  useEffect(() => {
    if (!error) return;
    setToast({ text: errorText(error.code), id: error.id });
    const h = setTimeout(() => setToast((t) => (t && t.id === error.id ? null : t)), 3200);
    return () => clearTimeout(h);
  }, [error]);

  // Only show the "connection lost" banner if we stay offline for a moment.
  useEffect(() => {
    if (status === "online") {
      setShowConn(false);
      return;
    }
    const h = setTimeout(() => setShowConn(true), 1200);
    return () => clearTimeout(h);
  }, [status]);

  // Clean deep-link URL once we're inside a room (so refresh reconnects via
  // the saved identity, not the /join path).
  useEffect(() => {
    if (view && location.pathname.startsWith("/join/")) {
      try {
        history.replaceState(null, "", "/");
      } catch {
        /* ignore */
      }
    }
  }, [view]);

  const offlinePlayers = view?.players.filter((player) => !player.connected) ?? [];
  const activeRoom =
    view != null && !["LOBBY", "GAME_OVER", "CLOSED"].includes(view.room.phase);
  const hostAlreadyHasClose =
    view?.self.role === "host" && ["LOBBY", "DISCUSSION"].includes(view.room.phase);

  return (
    <div className="app">
      {showConn ? <div className="conn">الاتصال انقطع، قاعدين نحاول نرجعك…</div> : null}

      {view?.self.role === "host" && activeRoom && offlinePlayers.length > 0 ? (
        <div
          className="card"
          style={{
            position: "fixed",
            top: showConn ? 58 : 14,
            left: "50%",
            transform: "translateX(-50%)",
            width: "min(calc(100% - 24px), 720px)",
            zIndex: 40,
            padding: "12px 16px",
            textAlign: "center",
          }}
        >
          <strong>
            اتصال {offlinePlayers.map((player) => player.name).join("، ")} منقطع
          </strong>
          <div className="helper" style={{ marginTop: 4 }}>
            مكانه محفوظ وما راح نغيّر المتخفي بسبب نوم الجوال أو انقطاع الشبكة.
          </div>
        </div>
      ) : null}

      {view == null ? (
        <Home />
      ) : view.self.role === "host" ? (
        <HostAudioLayer view={view}>
          <Host view={view} />
        </HostAudioLayer>
      ) : view.self.role === "player" ? (
        <Player view={view} />
      ) : (
        <Spectator />
      )}

      {view?.self.role === "player" ? (
        <RoomExitButton
          label="الخروج من الغرفة"
          onClick={() => {
            const active = !["LOBBY", "GAME_OVER"].includes(view.room.phase);
            const message = active
              ? "تطلع من الغرفة؟ إذا طلعت واللعبة شغّالة، المجموعة بترجع للّوبي عشان ما تتغيّر الأدوار بدون ما تدرون."
              : "تطلع من الغرفة؟";
            if (confirm(message)) actions.leaveRoom();
          }}
        />
      ) : view?.self.role === "host" && !hostAlreadyHasClose ? (
        <RoomExitButton
          label="إنهاء اللعبة"
          onClick={() => {
            if (confirm("تنهي اللعبة وتقفل الغرفة على الكل؟")) actions.closeRoom();
          }}
        />
      ) : null}

      {toast ? <div className="toast">{toast.text}</div> : null}

      {notice ? (
        <div className="overlay">
          <div className="card center stack" style={{ maxWidth: 420 }}>
            <h2 className="title">{notice}</h2>
            <button
              className="btn btn-primary"
              onClick={() => {
                clearNotice();
                resetToHome();
              }}
            >
              الرئيسية
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function RoomExitButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      onClick={onClick}
      style={{
        position: "fixed",
        left: 14,
        bottom: 14,
        zIndex: 35,
        opacity: 0.9,
      }}
    >
      {label}
    </button>
  );
}

function Spectator() {
  return (
    <div className="screen center stack">
      <div className="spacer" />
      <h2 className="title">اللعبة شغّالة الحين</h2>
      <p className="subtitle">ما تقدر تدخل لين تخلص الجولة الحالية. تابع الشاشة لين تخلص.</p>
      <button className="btn btn-ghost" onClick={() => resetToHome()}>الرئيسية</button>
      <div className="spacer" />
    </div>
  );
}
