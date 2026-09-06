import { useEffect, useRef, useState } from "react";
import type { ClientView, PublicPlayer } from "../../shared/types.js";
import { ConfirmDialog } from "./components/ConfirmDialog.js";
import { HostAudioLayer } from "./audio/HostAudioLayer.js";
import { Host, type ConfirmActionRequest } from "./screens/Host.js";
import { Home } from "./screens/Home.js";
import { Player } from "./screens/Player.js";
import {
  actions,
  clearActionFeedback,
  ensureSocket,
  onConnection,
  onError,
  onPendingActions,
  onState,
  resetToHome,
  type ActionType,
  type PendingActions,
  type SocketStatus,
} from "./net/socket.js";

interface UiError {
  id: number;
  code: string;
  message: string;
  actionType?: ActionType;
}

type ConfirmRequest = ConfirmActionRequest & {
  pending: boolean;
  roomCode: string;
  errorBaseline: number;
  phaseBaseline: ClientView["room"]["phase"];
  roundBaseline: number;
  challengeBaseline?: number;
};

export function App() {
  const [view, setView] = useState<ClientView | null>(null);
  const [error, setError] = useState<UiError | null>(null);
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const [showHostPlayers, setShowHostPlayers] = useState(false);
  const [confirmRequest, setConfirmRequest] = useState<ConfirmRequest | null>(null);
  const [pendingActions, setPendingActions] = useState<PendingActions>({});
  const errorSequence = useRef(0);
  const wasOnline = useRef(false);

  useEffect(() => {
    const offState = onState((next) => {
      setView(next);
      if (next.room.phase === "CLOSED") {
        setShowHostPlayers(false);
        setConfirmRequest(null);
      }
    });
    const offError = onError((code, message, meta) => {
      errorSequence.current += 1;
      setError({ id: errorSequence.current, code, message, actionType: meta?.actionType });
    });
    const offConnection = onConnection((next) => {
      setStatus(next);
      if (next === "online") wasOnline.current = true;
    });
    const offPending = onPendingActions(setPendingActions);
    ensureSocket();
    return () => {
      offState();
      offError();
      offConnection();
      offPending();
    };
  }, []);

  useEffect(() => {
    if (!confirmRequest) return;
    if (view == null || view.room.phase === "CLOSED" || view.room.code !== confirmRequest.roomCode) {
      setConfirmRequest(null);
      return;
    }

    const sameContext =
      view.room.currentRound === confirmRequest.roundBaseline &&
      view.challenge?.index === confirmRequest.challengeBaseline;
    const staleSensitive = new Set<ActionType>(["KICK_PLAYER", "LEAVE_ROOM", "NEXT_ROUND"]);
    if (sameContext && staleSensitive.has(confirmRequest.actionType) && view.room.phase !== confirmRequest.phaseBaseline) {
      setConfirmRequest(null);
      return;
    }

    if (confirmRequest.actionType === "KICK_PLAYER" && confirmRequest.targetUid) {
      if (!view.players.some((player) => player.uid === confirmRequest.targetUid)) {
        setConfirmRequest(null);
        return;
      }
    }

    if (confirmRequest.actionType === "CLOSE_ROOM" && view.room.phase === "CLOSED") {
      setConfirmRequest(null);
      return;
    }

    const pending = Boolean(pendingActions[confirmRequest.actionType]);
    const failedAfterOpen =
      error != null &&
      error.id > confirmRequest.errorBaseline &&
      error.actionType === confirmRequest.actionType;

    if (confirmRequest.pending && !pending && !failedAfterOpen) {
      setConfirmRequest(null);
      return;
    }

    if (failedAfterOpen) {
      setConfirmRequest((current) => current ? { ...current, pending: false } : current);
    }
  }, [confirmRequest, error, pendingActions, view]);

  const openConfirm = (request: ConfirmActionRequest) => {
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
  const hostAlreadyHasClose = view?.self.role === "host" && ["LOBBY", "DISCUSSION", "GAME_OVER"].includes(view.room.phase);
  const showHostDisconnected = view?.self.role === "player" && view.room.hostConnected === false && view.room.phase !== "CLOSED";
  const hostDeadline = view?.room.hostCloseDeadline
    ? new Date(view.room.hostCloseDeadline).toLocaleTimeString("ar-SA", { hour: "numeric", minute: "2-digit" })
    : null;
  const disableGameSurface = view != null && status !== "online";
  const showConnectionBanner = status !== "online" && wasOnline.current;

  const requestPlayerExit = () => {
    if (!view || view.self.role !== "player") return;
    const active = !["LOBBY", "GAME_OVER"].includes(view.room.phase);
    openConfirm({
      title: "الخروج من الغرفة؟",
      description: active
        ? "إذا خروجك يمنع استمرار دور المتخفي الحالي، ممكن ترجع اللعبة للّوبي. إذا الاتصال مقطوع ما راح ندّعي أن الخروج تسجّل إلا بعد رجوع الاتصال."
        : "بتطلع من الغرفة وترجع للرئيسية. إذا الاتصال مقطوع نحتاج يرجع قبل ما نأكد الخروج على الخادم.",
      confirmLabel: "اخرج",
      actionType: "LEAVE_ROOM",
      run: actions.leaveRoom,
    });
  };

  return (
    <div className={`app${showConnectionBanner ? " connection-offline" : ""}`}>
      <div data-app-content>
        {showConnectionBanner ? <div className="conn" role="status">الاتصال انقطع، قاعدين نحاول نرجعك…</div> : null}

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
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setShowHostPlayers(true)}>إدارة اللاعبين</button>
          </div>
        ) : null}

        <fieldset
          data-game-surface
          disabled={disableGameSurface}
          aria-busy={disableGameSurface}
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
            <button type="button" className="btn btn-ghost btn-sm floating-players" onClick={() => setShowHostPlayers(true)}>اللاعبين</button>
          ) : null}

          {view?.self.role === "host" && !hostAlreadyHasClose ? (
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

        {view?.self.role === "player" ? (
          <RoomExitButton label="🚪 خروج" ariaLabel="الخروج من الغرفة" onClick={requestPlayerExit} />
        ) : null}

        {view?.self.role === "host" && showHostPlayers ? (
          <HostPlayerManager
            players={view.players}
            blockedPlayers={view.blockedPlayers ?? []}
            onClose={() => setShowHostPlayers(false)}
            onKick={(uid) => {
              const player = view.players.find((candidate) => candidate.uid === uid);
              if (!player) return;
              openConfirm({
                title: `إخراج ${player.name}؟`,
                description: "بيطلع من الغرفة وما يقدر يرجع بنفس الهوية إلا إذا سمحت له من إدارة اللاعبين.",
                confirmLabel: "إخراج",
                actionType: "KICK_PLAYER",
                targetUid: uid,
                run: () => actions.kick(uid),
              });
            }}
            onUnblock={(uid) => actions.unblock(uid)}
          />
        ) : null}
      </div>

      {confirmRequest ? (
        <ConfirmDialog
          title={confirmRequest.title}
          description={confirmRequest.description}
          confirmLabel={confirmRequest.confirmLabel}
          pending={confirmRequest.pending || Boolean(pendingActions[confirmRequest.actionType])}
          error={
            error != null &&
            error.id > confirmRequest.errorBaseline &&
            error.actionType === confirmRequest.actionType
              ? error.message
              : undefined
          }
          onCancel={() => {
            clearActionFeedback(confirmRequest.actionType);
            setConfirmRequest(null);
          }}
          onConfirm={() => {
            clearActionFeedback(confirmRequest.actionType);
            const requestId = confirmRequest.run();
            if (requestId) {
              setConfirmRequest((current) => current ? { ...current, pending: true } : current);
            }
          }}
        />
      ) : null}
    </div>
  );
}

function HostPlayerManager({
  players,
  blockedPlayers,
  onClose,
  onKick,
  onUnblock,
}: {
  players: PublicPlayer[];
  blockedPlayers: Array<{ uid: string; name: string }>;
  onClose: () => void;
  onKick: (uid: string) => void;
  onUnblock: (uid: string) => void;
}) {
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = document.querySelector<HTMLElement>("[data-game-surface]");
    background?.setAttribute("inert", "");
    closeRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusables = panelRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      const ordered = focusables ? [...focusables] : [];
      if (!ordered.length) return;
      const first = ordered[0];
      const last = ordered.at(-1)!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      background?.removeAttribute("inert");
      openerRef.current?.focus();
    };
  }, [onClose]);

  const sorted = [...players].sort(
    (a, b) => Number(a.connected) - Number(b.connected) || a.seatNumber - b.seatNumber,
  );

  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="player-manager-title">
      <div className="card player-manager-panel" ref={panelRef}>
        <div className="row between">
          <div>
            <div className="eyebrow">المضيف</div>
            <h2 id="player-manager-title" className="title">اللاعبين</h2>
          </div>
          <button ref={closeRef} type="button" className="btn btn-ghost btn-sm" onClick={onClose}>إغلاق</button>
        </div>
        <div className="stack" style={{ marginTop: 18 }}>
          {sorted.map((player) => (
            <div key={player.uid} className="manager-player-row card tight row between">
              <div>
                <strong>{player.name}</strong>
                <div className="helper">مقعد {player.seatNumber} · {player.connected ? "متصل" : "منقطع"}</div>
              </div>
              <button type="button" className="btn btn-danger btn-sm" onClick={() => onKick(player.uid)}>إخراج</button>
            </div>
          ))}
        </div>
        {blockedPlayers.length ? (
          <div className="stack" style={{ marginTop: 20 }}>
            <div className="code-label">هويات ممنوعة من الرجوع</div>
            {blockedPlayers.map((player) => (
              <div key={player.uid} className="manager-subcard card tight row between">
                <div>
                  <strong>{player.name}</strong>
                  <div className="helper">محظور من الرجوع بنفس الجلسة</div>
                </div>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => onUnblock(player.uid)}>السماح بالرجوع</button>
              </div>
            ))}
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
      <p className="subtitle">ما تقدر تدخل لين يخلص دور المتخفي الحالي. تابع الشاشة لين يخلص.</p>
      <button className="btn btn-ghost" onClick={() => resetToHome()}>الرئيسية</button>
      <div className="spacer" />
    </div>
  );
}
