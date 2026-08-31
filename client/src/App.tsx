import { useEffect, useState } from "react";
import { clearNotice, resetToHome, useGame } from "./net/socket.js";
import { errorText } from "./i18n/errors.js";
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

  return (
    <div className="app">
      {showConn ? <div className="conn">فيه مشكلة بالاتصال، نحاول نرجعك… 🔄</div> : null}

      {view == null ? (
        <Home />
      ) : view.self.role === "host" ? (
        <Host view={view} />
      ) : view.self.role === "player" ? (
        <Player view={view} />
      ) : (
        <Spectator />
      )}

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

function Spectator() {
  return (
    <div className="screen center stack">
      <div className="spacer" />
      <h2 className="title">اللعبة شغّالة الحين</h2>
      <p className="subtitle">ما تقدر تدخل لين تخلص الجولة الحالية. خلّك متابع الشاشة 👀</p>
      <button className="btn btn-ghost" onClick={() => resetToHome()}>الرئيسية</button>
      <div className="spacer" />
    </div>
  );
}
