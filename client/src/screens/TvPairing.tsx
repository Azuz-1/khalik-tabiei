import { useCallback, useEffect, useRef, useState } from "react";
import "../tv-pairing.css";

interface PairingSession {
  id: string;
  code: string;
  secret: string;
  expiresAt: number;
}

interface PairingHistoryState extends Record<string, unknown> {
  tvPairing?: PairingSession;
}

type TvStatus = "loading" | "pending" | "expired" | "rate-limited" | "restarting" | "offline";

function validSession(value: unknown): value is PairingSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return typeof candidate.id === "string"
    && candidate.id.length > 0
    && candidate.id.length <= 128
    && typeof candidate.code === "string"
    && /^[0-9]{6}$/u.test(candidate.code)
    && typeof candidate.secret === "string"
    && candidate.secret.length >= 16
    && candidate.secret.length <= 256
    && typeof candidate.expiresAt === "number"
    && Number.isFinite(candidate.expiresAt);
}

function historyPairing(): PairingSession | null {
  const state = history.state as PairingHistoryState | null;
  return validSession(state?.tvPairing) ? state.tvPairing : null;
}

function replacePairingState(pairing?: PairingSession): void {
  const previous = history.state && typeof history.state === "object"
    ? history.state as Record<string, unknown>
    : {};
  const { tvPairing: _discarded, ...rest } = previous;
  history.replaceState(pairing ? { ...rest, tvPairing: pairing } : rest, "", "/tv");
}

function handOffToDisplay(roomCode: string, displayToken: string): void {
  const previous = history.state && typeof history.state === "object"
    ? history.state as Record<string, unknown>
    : {};
  const { tvPairing: _discarded, displayClientId: _oldClientId, ...rest } = previous;
  history.replaceState({ ...rest, displayToken }, "", `/display/${roomCode}`);
  location.reload();
}

function formatCode(code: string): string {
  return `${code.slice(0, 3)} ${code.slice(3)}`;
}

function formatRemaining(milliseconds: number): string {
  const seconds = Math.max(0, Math.ceil(milliseconds / 1_000));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

export function TvPairing() {
  const [pairing, setPairing] = useState<PairingSession | null>(() => historyPairing());
  const [status, setStatus] = useState<TvStatus>(() => {
    const existing = historyPairing();
    return existing && existing.expiresAt <= Date.now() ? "expired" : existing ? "pending" : "loading";
  });
  const [now, setNow] = useState(Date.now());
  const creatingRef = useRef(false);

  const createPairing = useCallback(async () => {
    if (creatingRef.current) return;
    creatingRef.current = true;
    setStatus("loading");
    try {
      const response = await fetch("/api/display-pairings", {
        method: "POST",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const body = await response.json().catch(() => null) as Record<string, unknown> | null;
      if (response.status === 429) {
        setStatus("rate-limited");
        return;
      }
      if (response.status === 503) {
        setStatus("restarting");
        return;
      }
      const candidate = body && body.ok === true ? {
        id: body.id,
        code: body.code,
        secret: body.secret,
        expiresAt: body.expiresAt,
      } : null;
      if (!response.ok || !validSession(candidate)) {
        setStatus("offline");
        return;
      }
      replacePairingState(candidate);
      setPairing(candidate);
      setNow(Date.now());
      setStatus("pending");
    } catch {
      setStatus("offline");
    } finally {
      creatingRef.current = false;
    }
  }, []);

  useEffect(() => {
    if (pairing) return;
    void createPairing();
  }, [createPairing, pairing]);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!pairing || status === "expired") return;
    if (pairing.expiresAt <= Date.now()) {
      setStatus("expired");
      return;
    }

    let cancelled = false;
    let timer: number | undefined;
    let controller: AbortController | undefined;

    const schedule = (delay = 1_750) => {
      if (!cancelled) timer = window.setTimeout(() => void poll(), delay);
    };

    const poll = async () => {
      if (cancelled) return;
      if (Date.now() >= pairing.expiresAt) {
        setStatus("expired");
        return;
      }
      controller = new AbortController();
      try {
        const response = await fetch(`/api/display-pairings/${encodeURIComponent(pairing.id)}`, {
          method: "GET",
          cache: "no-store",
          signal: controller.signal,
          headers: {
            Accept: "application/json",
            Authorization: `Bearer ${pairing.secret}`,
          },
        });
        const body = await response.json().catch(() => null) as Record<string, unknown> | null;
        if (cancelled) return;
        if (response.status === 404) {
          setStatus("expired");
          return;
        }
        if (response.status === 429) {
          setStatus("rate-limited");
          schedule(3_000);
          return;
        }
        if (response.status === 503) {
          setStatus("restarting");
          schedule(3_000);
          return;
        }
        if (!response.ok || !body) {
          setStatus("offline");
          schedule(3_000);
          return;
        }
        if (body.status === "claimed" && typeof body.roomCode === "string" && typeof body.displayToken === "string") {
          replacePairingState(undefined);
          handOffToDisplay(body.roomCode, body.displayToken);
          return;
        }
        if (body.status === "pending") setStatus("pending");
        schedule();
      } catch (error) {
        if (cancelled || (error instanceof DOMException && error.name === "AbortError")) return;
        setStatus("offline");
        schedule(3_000);
      }
    };

    void poll();
    return () => {
      cancelled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      controller?.abort();
    };
  }, [pairing, status === "expired"]);

  useEffect(() => {
    if (pairing && status !== "expired" && now >= pairing.expiresAt) setStatus("expired");
  }, [now, pairing, status]);

  const newCode = () => {
    replacePairingState(undefined);
    setPairing(null);
    setStatus("loading");
  };

  const remaining = pairing ? Math.max(0, pairing.expiresAt - now) : 0;
  const statusText = status === "pending"
    ? "بانتظار الربط من جوال المضيف…"
    : status === "rate-limited"
      ? "محاولات كثيرة. حاول مرة ثانية بعد لحظات."
      : status === "restarting"
        ? "الخادم يعيد التشغيل. حاول إنشاء رمز مرة ثانية بعد لحظات."
        : status === "offline"
          ? "تعذر الاتصال بالخادم. تأكد من الشبكة وحاول مرة ثانية."
          : "جاري إنشاء رمز الربط…";

  return (
    <main className="tv-pairing" dir="rtl">
      <section className="tv-pairing-stage" aria-labelledby="tv-pairing-title">
        <div className="tv-pairing-brand">خلك طبيعي</div>
        <h1 id="tv-pairing-title">اربط التلفزيون</h1>

        {status === "expired" ? (
          <div className="tv-pairing-expired" role="status">
            <strong>انتهت صلاحية رمز الربط.</strong>
            <p>أنشئ رمز جديد وكمل الربط من جوال المضيف.</p>
            <button type="button" className="btn btn-primary tv-pairing-button" onClick={newCode}>
              إنشاء رمز جديد
            </button>
          </div>
        ) : pairing ? (
          <>
            <p className="tv-pairing-instruction">
              افتح اللعبة من جوال المضيف واضغط <strong>«العب على التلفزيون»</strong>، ثم أدخل:
            </p>
            <div className="tv-pairing-code" dir="ltr" aria-label={`رمز الربط ${pairing.code.split("").join(" ")}`}>
              {formatCode(pairing.code)}
            </div>
            <div className="tv-pairing-timer" dir="rtl">
              الرمز صالح لمدة <span dir="ltr" className="num-ltr">{formatRemaining(remaining)}</span>
            </div>
            <div className="tv-pairing-status" role="status" aria-live="polite">
              <span className="tv-pairing-dot" aria-hidden="true" />
              {statusText}
            </div>
          </>
        ) : (
          <div className="tv-pairing-expired" role="status" aria-live="polite">
            <strong>{statusText}</strong>
            {status !== "loading" ? (
              <button type="button" className="btn btn-primary tv-pairing-button" onClick={() => void createPairing()}>
                إنشاء رمز جديد
              </button>
            ) : null}
          </div>
        )}
      </section>
    </main>
  );
}
