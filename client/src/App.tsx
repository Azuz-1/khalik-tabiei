import { useEffect, useMemo, useState } from "react";
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
import { ConfirmDialog, type ConfirmDialogState } from "./components/ConfirmDialog.js";
import { Home } from "./screens/Home.js";
import { Host, type ConfirmActionRequest } from "./screens/Host.js";
import { Player } from "./screens/Player.js";

interface ActiveConfirm extends ConfirmDialogState {
  actionType: string;
  roomCode: string;
  targetUid?: string;
  run: () => string | null;
  errorBaseline: number;
}

export function App() {
  const { view, status, error, notice, transportFeedback, pendingActions } = useGame();
  const [toast, setToast] = useState<{ text: string; id: string } | null>(null);
  const [showConn, setShowConn] = useState(false);
  const [showHostPlayers, setShowHostPlayers] = useState(false);
  const [confirmRequest, setConfirmRequest] = useState<ActiveConfirm | null>(null);

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
      try { history.replaceState(null, "", "/"); } catch { /* ignore */ }
    }
  }, [view]);

  useEffect(() => {
    if (view?.self.role !== "host") setShowHostPlayers(false);
  }, [view?.self.role]);

  useEffect(() => {
    if (!confirmRequest) return;
    if (!view || view.room.code !== confirmRequest.roomCode) {
      setConfirmRequest(null);
      return;
    }
    if (confirmRequest.targetUid && !view.players.some((player) => player.uid === confirmRequest.targetUid)) {
      setConfirmRequest(null);
      return;
    }
    if (confirmRequest.pending && error && error.id > confirmRequest.errorBaseline) {
      setConfirmRequest((current) => current ? {
        ...current,
        pending: false,
        error: errorText(error.code),
        errorBaseline: error.id,
      } : null);
      return;
    }
    if (confirmRequest.pending && !pendingActions.includes(confirmRequest.actionType)) {
      setConfirmRequest((current) => current ? {
        ...current,
        pending: false,
        error: "ما قدرنا نتأكد من تنفيذ الطلب. راجع حالة الغرفة وحاول مرة ثانية.",
      } : null);
    }
  }, [confirmRequest, error, pendingActions, view]);

  const openConfirm = (request: ConfirmActionRequest) => {
    if (!view || confirmRequest?.pending) return;
    setConfirmRequest({
      ...request,
      pending: false,
      roomCode: view.room.code,
      errorBaseline: error?.id ?? 0,
    });
  };

  const offlinePlayers = view?.players.filter((player) => !player.connected) ?? [];
  const activeRoom = view != null && !["LOBBY", "GAME_OVER", "CLOSED"].includes(view.room.phase);
  const hostAlreadyHasClose = view?.self.role === "host" && ["LOBBY", "DISCUSSION", "GAME_OVER"].includes(view.room.phase);
  const showHostDisconnected = view?.self.role === "player" && view.room.hostConnected === false && view.room.phase !== "CLOSED";
  const hostDeadline = view?.room.hostCloseDeadline
    ? new Date(view.room.hostCloseDeadline).toLocaleTimeString("ar-SA", { hour: "numeric", minute: "2-digit" })
    : null;

  return (
    <div className="app">
      <div data-app-content>
        {showConn ? <div className="conn" role="status">الاتصال انقطع، قاعدين نحاول نرجعك…</div> : null}

        {showHostDisconnected ? (
          <div className="card host-disconnect-banner" role="status">
            <strong>المضيف انقطع… ننتظره يرجع</strong>
            {hostDeadline ? <div className="helper">إذا ما رجع قبل {hostDeadline} بتنقفل الغرفة.</div> : null}
          </div>
        ) : null}

        {view?.self.role === "host" && activeRoom && offlinePlayers.length > 0 ? (
          <div className="card offline-player-banner">
            <strong>اتصال {offlinePlayers.map((player) => player.name).join("، ")} منقطع</strong>
            <div className="helper">مكانه محفوظ وما راح نغيّر المتخفي بسبب نوم الجوال أو انقطاع الشبكة.</div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowHostPlayers(true)}>
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
              <Host view={view} confirmAction={openConfirm} />
            </HostAudioLayer>
          ) : view.self.role === "player" ? (
            <Player view={view} />
          ) : (
            <Spectator />
          )}

          {view?.self.role === "host" && view.room.phase !== "CLOSED" ? (
            <button type="button" className="btn btn-ghost btn-sm floating-players" onClick={() => setShowHostPlayers(true)}>
              اللاعبين
            </button>
          ) : null}

          {view?.self.role === "player" ? (
            <RoomExitButton
              label="الخروج من الغرفة"
              onClick={() => {
                const active = !["LOBBY", "GAME_OVER"].includes(view.room.phase);
                openConfirm({
                  title: "الخروج من الغرفة؟",
                  description: active
                    ? "إذا كنت المتخفي أو صار عدد اللاعبين أقل من 3، المجموعة بترجع للّوبي. غير كذا تكمل لعبتهم بنفس المتخفي."
                    : "بتطلع من الغرفة وترجع للرئيسية.",
                  confirmLabel: "اخرج",
                  actionType: "LEAVE_ROOM",
                  run: actions.leaveRoom,
                });
              }}
            />
          ) : view?.self.role === "host" && !hostAlreadyHasClose ? (
            <RoomExitButton
              label="إنهاء اللعبة"
              onClick={() => openConfirm({
                title: "إنهاء اللعبة؟",
                description: "بتنقفل الغرفة على الكل وتنتهي اللعبة الحالية.",
                confirmLabel: "إنهاء اللعبة",
                actionType: "CLOSE_ROOM",
                run: actions.closeRoom,
              })}
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
            onConfirm={openConfirm}
            onClose={() => setShowHostPlayers(false)}
          />
        ) : null}

        {toast ? <div className="toast" role="status">{toast.text}</div> : null}

        {notice ? (
          <div className="overlay">
            <div className="card center stack" style={{ maxWidth: 420 }}>
              <h2 className="title">{notice}</h2>
              <button className="btn btn-primary" onClick={() => { clearNotice(); resetToHome(); }}>
                الرئيسية
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <ConfirmDialog
        state={confirmRequest}
        onCancel={() => {
          if (!confirmRequest?.pending) setConfirmRequest(null);
        }}
        onConfirm={() => {
          if (!confirmRequest || confirmRequest.pending) return;
          const rid = confirmRequest.run();
          if (!rid) {
            setConfirmRequest((current) => current ? {
              ...current,
              error: "الاتصال مو جاهز، لذلك ما أرسلنا الطلب.",
            } : null);
            return;
          }
          setConfirmRequest((current) => current ? { ...current, pending: true, error: undefined } : null);
        }}
      />
    </div>
  );
}

function HostPlayerManager({
  players,
  active,
  lobby,
  admissionLocked,
  blockedPlayers,
  onConfirm,
  onClose,
}: {
  players: PublicPlayer[];
  active: boolean;
  lobby: boolean;
  admissionLocked: boolean;
  blockedPlayers: Array<{ uid: string; name: string }>;
  onConfirm: (request: ConfirmActionRequest) => void;
  onClose: () => void;
}) {
  const orderedPlayers = useMemo(
    () => players
      .map((player, index) => ({ player, index }))
      .sort((a, b) => Number(a.player.connected) - Number(b.player.connected) || a.index - b.index)
      .map(({ player }) => player),
    [players],
  );

  return (
    <div className="overlay" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div className="card stack player-manager-panel">
        <div className="row between">
          <div>
            <h2 className="title" style={{ marginBottom: 4 }}>اللاعبين</h2>
            <p className="helper">المنقطعين يظهرون أول عشان يسهل التعامل معهم.</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>إغلاق</button>
        </div>

        {lobby ? (
          <div className="card stack manager-subcard">
            <div className="row between">
              <div>
                <strong>دخول لاعبين جدد</strong>
                <div className="helper">{admissionLocked ? "موقوف مؤقتًا" : "مفتوح"}</div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => actions.setAdmission(!admissionLocked)}>
                {admissionLocked ? "فتح الدخول" : "إيقاف الدخول"}
              </button>
            </div>
            <p className="helper">القفل يمنع الهويات الجديدة فقط. اللاعب اللي له مقعد محفوظ يقدر يرجع بنفس هويته.</p>
          </div>
        ) : null}

        {orderedPlayers.map((player) => (
          <div key={player.uid} className="row between card manager-player-row">
            <div>
              <strong>مقعد {player.seatNumber} · {player.name}</strong>
              <div className="helper">{player.connected ? "متصل" : "منقطع — مكانه محفوظ"}</div>
            </div>
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => onConfirm({
                title: `إخراج ${player.name}؟`,
                description: active
                  ? "إذا كان هو المتخفي أو صار العدد أقل من 3، اللعبة بترجع للّوبي. غير كذا تكملون بنفس المتخفي والتحدّي."
                  : "بيطلع من الغرفة وما يقدر يرجع بنفس الهوية إلا إذا سمحت له من إدارة اللاعبين.",
                confirmLabel: "إخراج",
                actionType: "KICK_PLAYER",
                targetUid: player.uid,
                run: () => actions.kick(player.uid),
              })}
            >
              إخراج
            </button>
          </div>
        ))}

        {players.length === 0 ? <p className="subtitle center">ما فيه لاعبين الحين.</p> : null}

        {blockedPlayers.length > 0 ? (
          <div className="card stack manager-subcard">
            <strong>هويات ممنوعة من الرجوع</strong>
            {blockedPlayers.map((player) => (
              <div key={player.uid} className="row between">
                <span>{player.name}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => actions.unblockPlayer(player.uid)}>
                  السماح له يرجع
                </button>
              </div>
            ))}
            <p className="helper">المنع مرتبط بالهوية المجهولة الموقّعة في هذا المتصفح، مو بالشخص أو عنوان IP. هوية جديدة تعتبر مستخدمًا مختلفًا.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RoomExitButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button type="button" className="btn btn-ghost btn-sm floating-exit" onClick={onClick}>
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
