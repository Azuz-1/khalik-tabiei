import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { ClientMessage, ClientView, GameModeInfo, ScoreEntry, ServerMessage } from "../../../shared/types.js";
import { PhaseCountdown, ResultBody, roundLabel } from "../components/Bits.js";
import { Players, Progress } from "../components/Players.js";
import { Qr } from "../components/Qr.js";
import { visibleCountdownSecond } from "../audio/hostAudioEvents.js";
import { estimatedServerNow, serverClock } from "../net/clock.js";

interface DisplayRoute {
  code: string;
  token: string;
}

interface DisplayHistoryState {
  displayToken?: string;
}

function routeFromLocation(): DisplayRoute | null {
  const match = location.pathname.match(/^\/display\/([A-Za-z2-9]{5})\/?$/);
  if (!match) return null;
  const hashParams = new URLSearchParams(location.hash.startsWith("#") ? location.hash.slice(1) : location.hash);
  const fromFragment = hashParams.get("token") ?? "";
  const previousState = (history.state ?? {}) as DisplayHistoryState;
  const token = fromFragment || previousState.displayToken || "";
  if (!token) return null;
  if (fromFragment) {
    // Keep the capability out of the visible URL while retaining it only for
    // this history entry so a TV/tablet hard refresh can reconnect safely.
    history.replaceState({ ...previousState, displayToken: token }, "", `${location.pathname}${location.search}`);
  }
  return { code: match[1]!.toUpperCase(), token };
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
        current.send(JSON.stringify({ t: "HELLO", protocolVersion: 2, displayToken: route.token } satisfies ClientMessage));
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
  }, [route?.code, route?.token]);

  return { view, status, message };
}

function DisplayStage({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`screen host host-stage display-stage ${className}`.trim()}>
      <div className="host-stage-content">{children}</div>
      <div className="pill-note" style={{ position: "fixed", insetInlineEnd: 16, bottom: 16 }}>شاشة عرض · بدون تحكم</div>
    </div>
  );
}

function modeInfo(view: ClientView): GameModeInfo | undefined {
  return view.room.availableModes.find((mode) => mode.id === view.challenge?.mode);
}

function countdownInstruction(mode?: GameModeInfo): string {
  switch (mode?.id) {
    case "HANDS": return "إذا المطلوب ينطبق عليك، ارفع يدك عند «ارفعوا!».");
    case "POINT": return "عند «أشروا!»، أشر على شخص واحد.";
    case "NUMBER": return "عند «ارفعوا أصابعكم!»، ارفع من 0 إلى 5 أصابع.";
    default: return "عند انتهاء العد، نفّذ الحركة.";
  }
}

function DisplayScoreboard({ rows, title }: { rows: ScoreEntry[]; title: string }) {
  return (
    <div className="card stack score-explain-board" style={{ width: "min(100%, 760px)" }}>
      <div className="code-label">{title}</div>
      {rows.map((row) => (
        <div key={row.uid} className="row between host-summary-row">
          <span>#{row.rank} {row.name}</span>
          <strong>{row.score} نقطة</strong>
        </div>
      ))}
    </div>
  );
}

function DisplayLobby({ view }: { view: ClientView }) {
  const active = view.players.filter((player) => player.connected).length;
  return (
    <div className="screen host host-lobby-screen display-lobby">
      <div className="center stack">
        <div className="pill-note">شاشة العرض الاختيارية</div>
        <h1 className="brand">خلك طبيعي</h1>
        <p className="subtitle">كل لاعب يستخدم جواله. هذي الشاشة للعرض العام فقط.</p>
      </div>
      <div className="host-grid">
        <div className="card codebox">
          <span className="code-label">كود الغرفة</span>
          <span className="code-value">{view.room.code}</span>
          <div style={{ marginTop: 18 }}><Qr url={view.room.joinUrl} /></div>
          <span className="helper">امسح الرمز عشان تدخل كلاعب</span>
        </div>
        <div className="card stack">
          <div className="row between">
            <span className="code-label">اللاعبين</span>
            <span className="count-pill">{active} <small>/ {view.room.maxPlayers}</small></span>
          </div>
          <Players players={view.players} />
        </div>
      </div>
    </div>
  );
}

function DisplayCountdown({ view }: { view: ClientView }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => tick((value) => value + 1), 100);
    return () => window.clearInterval(timer);
  }, []);
  const seconds = visibleCountdownSecond(view.room.phaseEndsAt, estimatedServerNow()) ?? 1;
  return (
    <DisplayStage className="host-countdown-stage">
      <div className="eyebrow">استعدوا…</div>
      <div className="host-countdown-number">{seconds}</div>
      <div className="host-countdown-instruction">{countdownInstruction(modeInfo(view))}</div>
    </DisplayStage>
  );
}

function DisplayRoom({ view }: { view: ClientView }) {
  const mode = modeInfo(view);
  switch (view.room.phase) {
    case "LOBBY":
      return <DisplayLobby view={view} />;
    case "QUESTION": {
      const progress = view.readyProgress ?? { submitted: 0, total: view.players.length };
      return (
        <DisplayStage>
          <div className="eyebrow">{roundLabel(view)}</div>
          <div className="host-mode-mark">{mode ? `${mode.icon} ${mode.label}` : "استعدوا"}</div>
          <h1 className="title host-stage-heading">شوفوا جوالاتكم</h1>
          <p className="subtitle">كل واحد يشوف دوره سرًا ويضغط جاهز</p>
          <div className="card host-progress-card"><Progress submitted={progress.submitted} total={progress.total} verb="جاهزين" /></div>
        </DisplayStage>
      );
    }
    case "COUNTDOWN":
      return <DisplayCountdown view={view} />;
    case "ACTION":
      return <DisplayStage className="host-action-stage"><h1 className="host-action-title">{mode?.actionLabel ?? "الحين!"}</h1></DisplayStage>;
    case "HOLD":
      return <DisplayStage className="host-hold-stage"><h1 className="host-hold-title">ثبّتوا…</h1><p className="subtitle host-hold-subtitle">طالعوا بعض</p></DisplayStage>;
    case "PROMPT_REVEAL":
      return <DisplayStage><div className="eyebrow host-prompt-eyebrow">المطلوب كان…</div><h1 className="host-prompt host-prompt-reveal">{view.publicPrompt?.text ?? "…"}</h1></DisplayStage>;
    case "DISCUSSION":
      return (
        <DisplayStage className="host-discussion-stage">
          <div className="eyebrow">{roundLabel(view)}</div>
          <div className="eyebrow host-prompt-eyebrow">المطلوب كان</div>
          <div className="host-prompt host-prompt-discussion">{view.publicPrompt?.text ?? "…"}</div>
          <h1 className="title host-discussion-question">مين تصرفه مو طبيعي؟</h1>
          <PhaseCountdown endsAt={view.room.phaseEndsAt} warningAtSeconds={10} warningText="استعدوا للتصويت" />
        </DisplayStage>
      );
    case "VOTING": {
      const progress = view.votesProgress ?? { submitted: 0, total: view.players.length };
      return (
        <DisplayStage className="host-voting-stage">
          <div className="eyebrow">{roundLabel(view)}</div>
          <h1 className="title host-voting-title">صوّتوا من جوالاتكم</h1>
          <PhaseCountdown endsAt={view.room.phaseEndsAt} />
          <div className="card center stack">
            <strong>صوّت {progress.submitted} من {progress.total}</strong>
            <span className="helper">اتجاه الأصوات مخفي لين تنتهي النتيجة.</span>
          </div>
        </DisplayStage>
      );
    }
    case "RESULT": {
      const fullReveal = view.result?.roundComplete === true;
      return (
        <DisplayStage className="host-result-stage">
          <div className="card host-result-panel">{view.result ? <ResultBody result={view.result} /> : null}</div>
          {fullReveal && view.scoreboard ? <DisplayScoreboard rows={view.scoreboard} title="النقاط بعد دور المتخفي" /> : null}
          <PhaseCountdown endsAt={view.room.phaseEndsAt} />
          <p className="subtitle">نكمل تلقائيًا.</p>
        </DisplayStage>
      );
    }
    case "GAME_OVER":
      return (
        <DisplayStage className="host-game-over-stage">
          <h1 className="brand">خلصت اللعبة 🎉</h1>
          {view.gameOver ? <p className="subtitle">لعبتوا {view.gameOver.completedChallenges} تحدّيات · انمسك المتخفي في {view.gameOver.caughtRounds} من {view.gameOver.totalRounds} أدوار</p> : null}
          {view.scoreboard ? <DisplayScoreboard rows={view.scoreboard} title="الترتيب النهائي" /> : null}
          <p className="helper">التحكم بالمباراة يبقى عند مالك الغرفة على جواله.</p>
        </DisplayStage>
      );
    default:
      return <DisplayStage><h1 className="title">اللعبة شغّالة</h1></DisplayStage>;
  }
}

export function DisplayApp() {
  const route = useMemo(routeFromLocation, []);
  const { view, status, message } = useDisplayFeed(route);

  if (!view) {
    return (
      <div className="screen center stack">
        <div className="spacer" />
        <div className="pill-note">شاشة العرض</div>
        <h1 className="brand">خلك طبيعي</h1>
        <p className="subtitle">{message ?? (status === "offline" ? "انقطع الاتصال، نحاول نرجع شاشة العرض…" : "جاري ربط شاشة العرض…")}</p>
        {status === "closed" ? <a className="btn btn-ghost" href="/">الرئيسية</a> : null}
        <div className="spacer" />
      </div>
    );
  }

  return (
    <>
      {status !== "online" ? <div className="conn" role="status">اتصال شاشة العرض انقطع، نحاول نرجعه…</div> : null}
      <DisplayRoom view={view} />
    </>
  );
}
