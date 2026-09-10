import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { PublicPlayer } from "../../shared/types.js";
import {
  actions,
  clearNotice,
  clearTransportFeedback,
  resetToHome,
  useGame,
} from "./net/socket.js";
import { estimatedServerNow } from "./net/clock.js";
import { errorText } from "./i18n/errors.js";
import { HostAudioLayer } from "./audio/HostAudioLayer.js";
import { ConfirmDialog, type ConfirmDialogState } from "./components/ConfirmDialog.js";
import { Home } from "./screens/Home.js";
import { Host, type ConfirmActionRequest } from "./screens/Host.js";
import { Player } from "./screens/Player.js";

interface RecoveryConfirmActionRequest {
  title: string;
  description: string;
  confirmLabel: string;
  actionType: "REDEAL_CHALLENGE";
  run: () => string | null;
}

type AppConfirmActionRequest = ConfirmActionRequest | RecoveryConfirmActionRequest;

interface ActiveConfirm extends ConfirmDialogState {
  actionType: AppConfirmActionRequest["actionType"];
  targetUid?: string;
  run: () => string | null;
  roomCode: string;
  errorBaseline: number;
  phaseBaseline: string;
  roundBaseline: number;
  challengeBaseline?: number;
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

  const isOwner = view?.self.isOwner === true;
  const legacyHost = view?.self.role === "host";
  const canManageRoom = isOwner || legacyHost;

  useEffect(() => {
    if (!canManageRoom) setShowHostPlayers(false);
  }, [canManageRoom]);

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
    if ((confirmRequest.actionType === "NEXT_ROUND" || confirmRequest.actionType === "REDEAL_CHALLENGE") && confirmRequest.pending) {
      const progressed = view.room.phase !== confirmRequest.phaseBaseline ||
        view.room.currentRound !== confirmRequest.roundBaseline ||
        view.challenge?.index !== confirmRequest.challengeBaseline ||
        (confirmRequest.actionType === "REDEAL_CHALLENGE" && view.readyRecovery === undefined);
      if (progressed) {
        setConfirmRequest(null);
        return;
      }
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
    if (!confirmRequest.pending || pendingActions.includes(confirmRequest.actionType)) return;
    const h = window.setTimeout(() => {
      setConfirmRequest((current) => {
        if (!current?.pending || pendingActions.includes(current.actionType)) return current;
        return {
          ...current,
          pending: false,
          error: "ما قدرنا نتأكد من تنفيذ الطلب. تأكد إن حالة الغرفة ما تغيّرت وحاول مرة ثانية.",
        };
      });
    }, 350);
    return () => window.clearTimeout(h);
  }, [confirmRequest, error, pendingActions, view]);

  const openConfirm = (request: AppConfirmActionRequest) => {
    if (!view || confirmRequest) return;
    setConfirmRequest({
      ...request,
      pending: false,
      roomCode: view.room.code,
      errorBaseline: error?.id ?? 0,
      phaseBaseline: view.room.phase,
      roundBaseline: view.room.currentRound,
      challengeBaseline: view.challenge?.index,
    });
  };

  const offlinePlayers = view?.players.filter((player) => !player.connected) ?? [];
  const activeRoom = view != null && !["LOBBY", "GAME_OVER", "CLOSED"].includes(view.room.phase);
  const ownerControlSurface = isOwner && ["LOBBY", "RESULT", "GAME_OVER"].includes(view?.room.phase ?? "");
  const managementSurfaceHasClose = canManageRoom && ["LOBBY", "GAME_OVER"].includes(view?.room.phase ?? "");
  const showOwnerDisconnected = view?.self.role === "player" && !isOwner && view.room.hostConnected === false && view.room.phase !== "CLOSED";
  const hostDeadline = view?.room.hostCloseDeadline
    ? new Date(view.room.hostCloseDeadline).toLocaleTimeString("ar-SA", { hour: "numeric", minute: "2-digit" })
    : null;
  const disableGameSurface = view != null && status !== "online";

  const requestPlayerExit = () => {
    if (!view || view.self.role !== "player") return;
    const owner = view.self.isOwner === true;
    const active = !["LOBBY", "GAME_OVER"].includes(view.room.phase);
    openConfirm({
      title: owner ? "الخروج وتسليم الإدارة؟" : "الخروج من الغرفة؟",
      description: owner
        ? active
          ? "بننقل إدارة الغرفة فورًا لأقدم لاعب متصل مؤهل، ثم بتطلع من اللعب. خروجك قد يغيّر الجولة الحالية حسب دورك وعدد اللاعبين."
          : "بننقل إدارة الغرفة فورًا لأقدم لاعب متصل مؤهل، ثم بتطلع من الغرفة وترجع للرئيسية."
        : active
          ? "إذا خروجك يمنع استمرار دور المتخفي الحالي، ممكن ترجع اللعبة لشاشة الانتظار. وإذا الاتصال مقطوع، لازم يرجع قبل ما نقدر نأكد خروجك."
          : "بتطلع من الغرفة وترجع للرئيسية. وإذا الاتصال مقطوع، لازم يرجع قبل ما نقدر نأكد خروجك.",
      confirmLabel: owner ? "اخرج وسلّم الإدارة" : "اخرج",
      actionType: "LEAVE_ROOM",
      run: actions.leaveRoom,
    });
  };

  const renderRoomSurface = () => {
    if (!view) return <Home />;

    if (isOwner) {
      return (
        <HostAudioLayer view={view}>
          {ownerControlSurface
            ? <Host view={view} confirmAction={openConfirm} />
            : <Player view={view} />}
        </HostAudioLayer>
      );
    }

    if (legacyHost) {
      return (
        <HostAudioLayer view={view}>
          <Host view={view} confirmAction={openConfirm} />
        </HostAudioLayer>
      );
    }

    if (view.self.role === "player") return <Player view={view} />;
    return <Spectator />;
  };

  return (
    <div className="app">
      <div data-app-content>
        {showConn ? <div className="conn" role="status">الاتصال انقطع، قاعدين نحاول نرجعك…</div> : null}

        {showOwnerDisconnected ? (
          <div className="card host-disconnect-banner" role="status">
            <strong>مالك الغرفة انقطع… ننتظره يرجع</strong>
            {hostDeadline ? <div className="helper">إذا ما رجع قبل {hostDeadline} بتنقفل الغرفة.</div> : null}
          </div>
        ) : null}

        {isOwner && view?.readyRecovery ? (
          <ReadyRecoveryBanner
            availableAt={view.readyRecovery.availableAt}
            online={status === "online"}
            onRecover={() => openConfirm({
              title: "إعادة توزيع التحدي؟",
              description: "بيبدأ التحدي من جديد باللاعبين المتصلين فقط. إذا كان دور المتخفي الحالي فيه نقاط مؤقتة أو سلسلة تصويت غير مدفوعة، بتنمسح عند إعادة التوزيع. وإذا ما بقي 3 لاعبين متصلين بنرجع لشاشة الانتظار.",
              confirmLabel: "إعادة توزيع التحدي",
              actionType: "REDEAL_CHALLENGE",
              run: actions.redealChallenge,
            })}
          />
        ) : null}

        {canManageRoom && activeRoom && offlinePlayers.length > 0 ? (
          <div className="card offline-player-banner">
            <strong>اتصال {offlinePlayers.map((player) => player.name).join("، ")} منقطع</strong>
            <div className="helper">مكانه محفوظ وما راح نغيّر المتخفي تلقائيًا بسبب نوم الجوال أو انقطاع الشبكة.</div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowHostPlayers(true)}>إدارة اللاعبين</button>
          </div>
        ) : null}

        <fieldset
          data-game-surface
          disabled={disableGameSurface}
          aria-busy={disableGameSurface}
          style={{ border: 0, margin: 0, padding: 0, minWidth: 0 }}
        >
          {renderRoomSurface()}

          {canManageRoom && view?.room.phase !== "CLOSED" ? (
            <button type="button" className="btn btn-ghost btn-sm floating-players" onClick={() => setShowHostPlayers(true)}>اللاعبين</button>
          ) : null}

          {canManageRoom && view && !managementSurfaceHasClose ? (
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

        {view?.self.role === "player" && !isOwner ? (
          <RoomExitButton label="🚪 خروج" ariaLabel="الخروج من الغرفة" onClick={requestPlayerExit} />
        ) : null}

        {canManageRoom && view && showHostPlayers ? (
          <HostPlayerManager
            players={view.players}
            active={activeRoom}
            lobby={view.room.phase === "LOBBY"}
            admissionLocked={view.room.admissionLocked}
            blockedPlayers={view.blockedPlayers ?? []}
            protectUnreadyDisconnects={view.readyRecovery !== undefined}
            onOwnerLeave={isOwner ? () => { setShowHostPlayers(false); requestPlayerExit(); } : undefined}
            onConfirm={openConfirm}
            onClose={() => setShowHostPlayers(false)}
          />
        ) : null}

        {toast ? <div className="toast" role="status">{toast.text}</div> : null}

        {notice ? (
          <div className="overlay" role="dialog" aria-modal="true" aria-label="تنبيه الغرفة">
            <div className="card center stack" style={{ maxWidth: 420 }}>
              <h2 className="title">{notice}</h2>
              <button className="btn btn-primary" onClick={() => { clearNotice(); resetToHome(); }}>الرئيسية</button>
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
            setConfirmRequest((current) => current ? { ...current, error: "الاتصال مو جاهز، لذلك ما أرسلنا الطلب." } : null);
            return;
          }
          setConfirmRequest((current) => current ? { ...current, pending: true, error: undefined } : null);
        }}
      />
    </div>
  );
}

function ReadyRecoveryBanner({
  availableAt,
  online,
  onRecover,
}: {
  availableAt: number;
  online: boolean;
  onRecover: () => void;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 250);
    return () => window.clearInterval(timer);
  }, []);
  const remainingMs = Math.max(0, availableAt - estimatedServerNow());
  const available = remainingMs <= 0;
  const seconds = Math.max(1, Math.ceil(remainingMs / 1_000));
  return (
    <div className="card offline-player-banner" role="status">
      <strong>لاعب انقطع قبل ما يجهز</strong>
      <div className="helper">ننتظر رجوعه بدون أي تغيير تلقائي في دور المتخفي.</div>
      {available ? (
        <button type="button" className="btn btn-ghost btn-sm" disabled={!online} onClick={onRecover}>إعادة توزيع التحدي</button>
      ) : (
        <div className="helper">إعادة التوزيع تتاح بعد {seconds} ث.</div>
      )}
    </div>
  );
}

function HostPlayerManager({
  players,
  active,
  lobby,
  admissionLocked,
  blockedPlayers,
  protectUnreadyDisconnects,
  onOwnerLeave,
  onConfirm,
  onClose,
}: {
  players: PublicPlayer[];
  active: boolean;
  lobby: boolean;
  admissionLocked: boolean;
  blockedPlayers: Array<{ uid: string; name: string }>;
  protectUnreadyDisconnects: boolean;
  onOwnerLeave?: () => void;
  onConfirm: (request: ConfirmActionRequest) => void;
  onClose: () => void;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const orderedPlayers = useMemo(
    () => [...players].sort((a, b) => Number(a.connected) - Number(b.connected) || a.seatNumber - b.seatNumber),
    [players],
  );

  useEffect(() => {
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const surface = document.querySelector<HTMLElement>("[data-game-surface]");
    surface?.setAttribute("inert", "");
    surface?.setAttribute("aria-hidden", "true");
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      surface?.removeAttribute("inert");
      surface?.removeAttribute("aria-hidden");
      if (previous?.isConnected) previous.focus();
    };
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = [...panel.querySelectorAll<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
    if (focusable.length === 0) {
      event.preventDefault();
      panel.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div
        ref={panelRef}
        className="card stack player-manager-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="row between">
          <div>
            <h2 id={titleId} className="title" style={{ marginBottom: 4 }}>اللاعبين</h2>
            <p className="helper">المنقطعين يظهرون أول عشان يسهل التعامل معهم.</p>
          </div>
          <button ref={closeRef} type="button" className="btn btn-ghost btn-sm" onClick={onClose}>إغلاق</button>
        </div>

        {lobby ? (
          <div className="card stack manager-subcard">
            <div className="row between">
              <div><strong>دخول لاعبين جدد</strong><div className="helper">{admissionLocked ? "موقوف مؤقتًا" : "مفتوح"}</div></div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => actions.setAdmission(!admissionLocked)}>{admissionLocked ? "فتح الدخول" : "إيقاف الدخول"}</button>
            </div>
            <p className="helper">إيقاف الدخول يمنع لاعبين جدد. اللي له مكان محفوظ يقدر يرجع.</p>
          </div>
        ) : null}

        {orderedPlayers.map((player) => (
          <div key={player.uid} className="row between card manager-player-row">
            <div>
              <strong>مقعد {player.seatNumber} · {player.name}{player.isHost ? " · مالك الغرفة" : ""}</strong>
              <div className="helper">{player.connected ? "متصل" : "منقطع — مكانه محفوظ"}</div>
            </div>
            {player.isHost ? (
              <span className="pill-note">أنت</span>
            ) : protectUnreadyDisconnects && !player.connected ? (
              <span className="pill-note">ننتظر أو نعيد التوزيع</span>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => onConfirm({
                  title: `إخراج ${player.name}؟`,
                  description: active
                    ? "إذا كان هو المتخفي أو صار العدد أقل من 3، اللعبة بترجع لشاشة الانتظار. غير كذا تكملون بنفس المتخفي والتحدّي."
                    : "بيطلع من الغرفة وما يقدر يرجع بنفس الهوية إلا إذا سمحت له من إدارة اللاعبين.",
                  confirmLabel: "إخراج",
                  actionType: "KICK_PLAYER",
                  targetUid: player.uid,
                  run: () => actions.kick(player.uid),
                })}
              >
                إخراج
              </button>
            )}
          </div>
        ))}

        {players.length === 0 ? <p className="subtitle center">ما فيه لاعبين الحين.</p> : null}

        {onOwnerLeave ? (
          <div className="card stack manager-subcard">
            <strong>مالك الغرفة</strong>
            <p className="helper">إذا بتطلع، نسلّم الإدارة تلقائيًا لأقدم لاعب متصل مؤهل بدل ما نقفل الغرفة على الكل.</p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={onOwnerLeave}>خروج وتسليم الإدارة</button>
          </div>
        ) : null}

        {blockedPlayers.length > 0 ? (
          <div className="card stack manager-subcard">
            <strong>لاعبون ممنوعون من الرجوع</strong>
            {blockedPlayers.map((player) => (
              <div key={player.uid} className="row between">
                <span>{player.name}</span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => actions.unblockPlayer(player.uid)}>السماح له يرجع</button>
              </div>
            ))}
            <p className="helper">هذي القائمة تمنع رجوع نفس هوية اللعبة. مالك الغرفة يقدر يسمح للاعب يرجع من هنا.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function RoomExitButton({ label, ariaLabel, onClick }: { label: string; ariaLabel?: string; onClick: () => void }) {
  return <button type="button" aria-label={ariaLabel} className="btn btn-ghost btn-sm floating-exit" onClick={onClick}>{label}</button>;
}

function Spectator() {
  return (
    <div className="screen center stack">
      <div className="spacer" />
      <h2 className="title">اللعبة شغّالة الحين</h2>
      <p className="subtitle">ما تقدر تدخل لين يخلص دور المتخفي الحالي. انتظر لين يرجعون لشاشة الانتظار.</p>
      <button className="btn btn-ghost" onClick={() => resetToHome()}>الرئيسية</button>
      <div className="spacer" />
    </div>
  );
}
