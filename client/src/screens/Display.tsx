import { useEffect, useMemo, useState } from "react";
import type { ClientMessage, ClientView, ServerMessage } from "../../../shared/types.js";
import { TvStage } from "../components/TvStage.js";
import { EyesMark } from "../ui/EyesMark.js";
import { serverClock } from "../net/clock.js";

interface DisplayRoute {
  code: string;
  token: string;
  clientId: string;
}

interface DisplayHistoryState {
  displayToken?: string;
  displayClientId?: string;
}

function createDisplayClientId(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return `dc_${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function routeFromLocation(): DisplayRoute | null {
  const match = location.pathname.match(/^\/display\/([A-Za-z2-9]{5})\/?$/);
  if (!match) return null;
  const hashParams = new URLSearchParams(location.hash.startsWith("#") ? location.hash.slice(1) : location.hash);
  const fromFragment = hashParams.get("token") ?? "";
  const previousState = (history.state ?? {}) as DisplayHistoryState;
  const token = fromFragment || previousState.displayToken || "";
  if (!token) return null;
  const clientId = previousState.displayClientId ?? createDisplayClientId();
  if (fromFragment || previousState.displayClientId !== clientId) {
    // Keep the capability out of the visible URL while retaining it, together
    // with a device-local reconnect id, only for this history entry. A hard
    // refresh can reclaim the same Display slot without looking like a second TV.
    history.replaceState(
      { ...previousState, displayToken: token, displayClientId: clientId },
      "",
      `${location.pathname}${location.search}`,
    );
  }
  return { code: match[1]!.toUpperCase(), token, clientId };
}

function displaySocketUrl(route: DisplayRoute): string {
  const params = new URLSearchParams({ mode: "display", code: route.code });
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws?${params.toString()}`;
}

function useDisplayFeed(route: DisplayRoute | null) {
  const [view, setView] = useState<ClientView | null>(null);
  const [status, setStatus] = useState<"connecting" | "online" | "offline" | "closed">("connecting");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!route) {
      setStatus("closed");
      setMessage("رابط شاشة العرض غير صالح.");
      return;
    }

    let stopped = false;
    let socket: WebSocket | null = null;
    let retry: number | undefined;
    let retryDelay = 500;
    let sample = 0;
    let sampleTimer: number | undefined;

    const sendClockSample = () => {
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      sample += 1;
      const sampleId = `display-${sample}`;
      const clientMonoMs = serverClock.beginSample(sampleId);
      socket.send(JSON.stringify({ t: "PING", sampleId, clientMonoMs } satisfies ClientMessage));
    };

    const connect = () => {
      if (stopped) return;
      setStatus("connecting");
      const current = new WebSocket(displaySocketUrl(route));
      socket = current;

      current.onopen = () => {
        if (stopped || socket !== current) return;
        current.send(JSON.stringify({
          t: "HELLO",
          protocolVersion: 2,
          displayToken: route.token,
          displayClientId: route.clientId,
        } satisfies ClientMessage));
      };

      current.onmessage = (event) => {
        if (stopped || socket !== current) return;
        let incoming: ServerMessage;
        try { incoming = JSON.parse(event.data as string) as ServerMessage; }
        catch { return; }
        if (incoming.t === "STATE") {
          setView(incoming.view);
          setMessage(null);
          setStatus("online");
          retryDelay = 500;
          if (sampleTimer === undefined) {
            sendClockSample();
            sampleTimer = window.setInterval(sendClockSample, 10_000);
          }
          return;
        }
        if (incoming.t === "PONG" && incoming.sampleId && incoming.serverMs !== undefined) {
          serverClock.acceptSample(incoming.sampleId, incoming.serverMs, performance.now());
          return;
        }
        if (incoming.t === "ROOM_CLOSED") {
          setView(null);
          setStatus("closed");
          setMessage(incoming.reason === "display_revoked" || incoming.reason === "display_access_ended"
            ? "تم إيقاف رابط شاشة العرض من مالك الغرفة."
            : "انتهت الغرفة.");
          stopped = true;
          current.close();
          return;
        }
        if (incoming.t === "ERROR" && incoming.code === "DISPLAY_IN_USE") {
          setView(null);
          setStatus("closed");
          setMessage("فيه شاشة عرض ثانية مربوطة بالغرفة حاليًا. اقفلها ثم حاول مرة ثانية.");
          stopped = true;
          current.close();
          return;
        }
        if (incoming.t === "ERROR" && (incoming.code === "UNAUTHORIZED" || incoming.code === "ROOM_NOT_FOUND")) {
          setView(null);
          setStatus("closed");
          setMessage("رابط شاشة العرض غير صالح أو انتهت صلاحيته.");
          stopped = true;
          current.close();
          return;
        }
        if (incoming.t === "SERVER_RESTARTING") {
          setMessage("الخادم يعيد التشغيل؛ شاشة العرض بتحاول ترجع تلقائيًا.");
        }
      };

      current.onclose = () => {
        if (sampleTimer !== undefined) window.clearInterval(sampleTimer);
        sampleTimer = undefined;
        if (stopped || socket !== current) return;
        socket = null;
        setStatus("offline");
        retry = window.setTimeout(connect, retryDelay);
        retryDelay = Math.min(8_000, Math.round(retryDelay * 1.7));
      };

      current.onerror = () => {
        if (socket === current) current.close();
      };
    };

    connect();
    return () => {
      stopped = true;
      window.clearTimeout(retry);
      if (sampleTimer !== undefined) window.clearInterval(sampleTimer);
      try { socket?.close(1000, "display closed"); } catch { /* close race */ }
    };
  }, [route?.code, route?.token, route?.clientId]);

  return { view, status, message };
}

export function DisplayApp() {
  const route = useMemo(routeFromLocation, []);
  const { view, status, message } = useDisplayFeed(route);

  if (!view) {
    return (
      <div className="tv tv-standby" data-phase="STANDBY">
        <div className="tv-backdrop" aria-hidden="true" />
        <main className="tv-stage">
          <div className="tv-moment">
            <EyesMark size={140} />
            <div className="pill-note">شاشة العرض</div>
            <h1 className="brand tv-standby-title">خلك طبيعي</h1>
            <p className="tv-lede" role="status">{message ?? (status === "offline" ? "انقطع الاتصال، نحاول نرجع شاشة العرض…" : "جاري ربط شاشة العرض…")}</p>
            {status === "closed" ? <a className="btn btn-secondary tv-standby-home" href="/">الرئيسية</a> : null}
          </div>
        </main>
      </div>
    );
  }

  return (
    <>
      {status !== "online" ? <div className="conn" role="status">اتصال شاشة العرض انقطع، نحاول نرجعه…</div> : null}
      <TvStage
        view={view}
        badge="شاشة عرض · بدون تحكم"
        lobbyEyebrow="شاشة العرض الاختيارية"
        waitingNote={view.room.phase === "GAME_OVER"
          ? "التحكم بالمباراة يبقى عند مالك الغرفة على جواله."
          : "بانتظار مالك الغرفة ينقلكم للمرحلة الجاية…"}
      />
    </>
  );
}
