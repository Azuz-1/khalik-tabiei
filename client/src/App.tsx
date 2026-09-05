import { useEffect, useState } from "react";
import type { PublicPlayer } from "../../shared/types.js";
import {
  actions,
  clearNotice,
  clearTransportFeedback,
  resetToHome,
  useGame,
} from "./net/socket.js";
import { errorText } from "./i18n/errors.js";
import { HostAudioLayer } from "./audio/HostAudioLayer.js";
import { Home } from "./screens/Home.js";
import { Host } from "./screens/Host.js";
import { Player } from "./screens/Player.js";

export function App() {
  const { view, status, error, notice, transportFeedback } = useGame();
  const [toast, setToast] = useState<{ text: string; id: string } | null>(null);
  const [showConn, setShowConn] = useState(false);
  const [showHostPlayers, setShowHostPlayers] = useState(false);

  useEffect(() => {
    if (!error) return;
    const id = `e-${error.id}`;
    setToast({ text: errorText(error.code), id });
    const h = setTimeout(() => setToast((current) => current?.id === id ? null : current), 3_200);
    return () => clearTimeout(h);
  }, [error]);

  useEffect(() => {
    if (!transportFeedback) return;
    const id = `t-${transportFeedback.id}`;
    setToast({ text: transportFeedback.text, id });
    const h = setTimeout(() => {
      setToast((current) => current?.id === id ? null : current);
      clearTransportFeedback();
    }, 4_000);
    return () => clearTimeout(h);
  }, [transportFeedback]);

  useEffect(() => {
    if (status === "online") {
      setShowConn(false);
      return;
    }
    const h = setTimeout(() => setShowConn(true), 1_200);
    return () => clearTimeout(h);
  }, [status]);

  useEffect(() => {
    if (view && location.pathname.startsWith("/join/")) {
      try {
        history.replaceState(null, "", "/");
      } catch {
        /* ignore */
      }
    }
  }, [view]);

  useEffect(() => {
    if (view?.self.role !== "host") setShowHostPlayers(false);
  }, [view?.self.role]);

  const offlinePlayers = view?.players.filter((player) => !player.connected) ?? [];
  const activeRoom =
    view != null && !["LOBBY", "GAME_OVER", "CLOSED"].includes(view.room.phase);
  const hostAlreadyHasClose =
    view?.self.role === "host" && ["LOBBY", "DISCUSSION", "GAME_OVER"].includes(view.room.phase);
  const showHostDisconnected =
    view?.self.role === "player" && view.room.hostConnected === false && view.room.phase !== "CLOSED";
  const hostDeadline = view?.room.hostCloseDeadline
    ? new Date(view.room.hostCloseDeadline).toLocaleTimeString("ar-SA", { hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <div className="app">
      {showConn ? <div className="conn" role="status">الاتصال انقطع، قاعدين نحاول نرجعك…</div> : null}

      {showHostDisconnected ? (
        <div
          className="card"
          role="status"
          style={{
            position: "fixed",
            top: showConn ? 58 : 14,
            left: "50%",
            transform: "translateX(-50%)",
            width: "min(calc(100% - 24px), 520px)",
            zIndex: 40,
            padding: "10px 14px",
            textAlign: "center",
          }}
        >
          <strong>المضيف انقطع… ننتظره يرجع</strong>
          {hostDeadline ? <div className="helper">إذا ما رجع قبل {hostDeadline} بتنقفل الغرفة.</div> : null}
        </div>
      ) : null}

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
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            style={{ marginTop: 8 }}
            onClick={() => setShowHostPlayers(true)}
          >
            إدارة اللاعبين
          </button>
        </div>
      ) : null}

      <fieldset
        disabled={status !== "online"}
        aria-busy={status !== "online"}
        style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
      >
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

        {view?.self.role === "host" && view.room.phase !== "CLOSED" ? (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setShowHostPlayers(true)}
            style={{
              position: "fixed",
              right: 14,
              bottom: 14,
              zIndex: 35,
              opacity: 0.9,
            }}
          >
            اللاعبين
          </button>
        ) : null}

        {view?.self.role === "player" ? (
          <RoomExitButton
            label="الخروج من الغرفة"
            onClick={() => {
              const active = !["LOBBY", "GAME_OVER"].includes(view.room.phase);
              const message = active
                ? "تطلع من الغرفة؟ إذا كنت المتخفي أو صار عدد اللاعبين أقل من 3، المجموعة بترجع للّوبي. غير كذا تكمل لعبتهم بنفس المتخفي."
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
      </fieldset>

      {view?.self.role === "host" && showHostPlayers ? (
        <HostPlayerManager
          players={view.players}
          active={activeRoom}
          lobby={view.room.phase === "LOBBY"}
          admissionLocked={view.room.admissionLocked}
          blockedPlayers={view.blockedPlayers ?? []}
          onClose={() => setShowHostPlayers(false)}
        />
      ) : null}

      {toast ? <div className="toast" role="status">{toast.text}</div> : null}

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

function HostPlayerManager({
  players,
  active,
  lobby,
  admissionLocked,
  blockedPlayers,
  onClose,
}: {
  players: PublicPlayer[];
  active: boolean;
  lobby: boolean;
  admissionLocked: boolean;
  blockedPlayers: Array<{ uid: string; name: string }>;
  onClose: () => void;
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <div
        className="card stack"
        style={{ width: "min(calc(100% - 28px), 560px)", maxHeight: "82vh", overflow: "auto" }}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="row between">
          <div>
            <h2 className="title" style={{ marginBottom: 4 }}>اللاعبين</h2>
            <p className="helper">طلع أي شخص مشى أو صار يعطل الجولة.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            إغلاق
          </button>
        </div>

        {lobby ? (
          <div className="card stack" style={{ padding: 12 }}>
            <div className="row between">
              <div>
                <strong>دخول لاعبين جدد</strong>
                <div className="helper">
                  {admissionLocked ? "موقوف مؤقتًا" : "مفتوح"}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => actions.setAdmission(!admissionLocked)}
              >
                {admissionLocked ? "فتح الدخول" : "إيقاف الدخول"}
              </button>
            </div>
            <p className="helper">
              القفل يمنع الهويات الجديدة فقط. اللاعب اللي له مقعد محفوظ يقدر يرجع بنفس هويته.
            </p>
          </div>
        ) : null}

        {players.map((player) => (
          <div key={player.uid} className="row between card" style={{ padding: 12 }}>
            <div>
              <strong>{player.name}</strong>
              <div className="helper">
                {player.connected ? "متصل" : "منقطع — مكانه محفوظ"}
              </div>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => {
                const detail = active
                  ? "إذا كان هو المتخفي أو صار العدد أقل من 3، اللعبة بترجع للّوبي. غير كذا تكملون بنفس المتخفي والتحدّي."
                  : "";
                if (confirm(`تطلع ${player.name} من الغرفة؟${detail ? `\n\n${detail}` : ""}`)) {
                  actions.kick(player.uid);
                }
              }}
            >
              إخراج
            </button>
          </div>
        ))}

        {players.length === 0 ? <p className="subtitle center">ما فيه لاعبين الحين.</p> : null}

        {blockedPlayers.length > 0 ? (
          <div className="card stack" style={{ padding: 12 }}>
            <strong>هويات ممنوعة من الرجوع</strong>
            {blockedPlayers.map((player) => (
              <div key={player.uid} className="row between">
                <span>{player.name}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => actions.unblockPlayer(player.uid)}
                >
                  السماح له يرجع
                </button>
              </div>
            ))}
            <p className="helper">
              المنع مرتبط بالهوية المجهولة الموقّعة في هذا المتصفح، مو بالشخص أو عنوان IP. هوية جديدة تعتبر مستخدمًا مختلفًا.
            </p>
          </div>
        ) : null}
      </div>
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
