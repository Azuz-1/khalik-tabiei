import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { ClientView } from "../../../shared/types.js";
import "../tv-pairing.css";
import { Icon } from "../ui/Icon.js";
import { useModalFocus } from "../ui/useModalFocus.js";
import { Qr } from "./Qr.js";

export function normalizePairingInput(value: string): string {
  return value.replace(/\D/gu, "").slice(0, 6);
}

export function formatPairingCode(value: string): string {
  return value.length <= 3 ? value : `${value.slice(0, 3)} ${value.slice(3)}`;
}

export function OwnerDisplayControl({ view }: { view: ClientView }) {
  const [open, setOpen] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [pairingBusy, setPairingBusy] = useState(false);
  const [pairingMessage, setPairingMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [directBusy, setDirectBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [directMessage, setDirectMessage] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useModalFocus(panelRef, open, { initialFocus: inputRef });

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [open]);

  if (view.self.isOwner !== true || view.room.phase === "CLOSED") return null;

  const roomCode = view.room.code;
  const tvAddress = `${location.origin}/tv`;

  const claimPairing = async (event: React.FormEvent) => {
    event.preventDefault();
    if (pairingBusy || pairingCode.length !== 6) return;
    setPairingBusy(true);
    setPairingMessage(null);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/display-pairings/claim`, {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ pairingCode }),
      });
      const body = await response.json().catch(() => null) as { code?: string } | null;
      if (response.ok) {
        setPairingMessage({ text: "تم ربط التلفزيون ✓ التلفزيون راح يفتح شاشة اللعبة تلقائيًا." });
        setPairingCode("");
        return;
      }
      if (response.status === 429) {
        setPairingMessage({ text: "محاولات كثيرة. انتظر شوي وحاول مرة ثانية.", error: true });
      } else if (response.status === 409 || body?.code === "DISPLAY_IN_USE") {
        setPairingMessage({ text: "فيه شاشة عرض مرتبطة بالغرفة حاليًا. أوقفها أولًا إذا تبي تربط تلفزيون ثاني.", error: true });
      } else if (response.status === 503) {
        setPairingMessage({ text: "الخادم يعيد التشغيل. حاول الربط مرة ثانية بعد لحظات.", error: true });
      } else {
        setPairingMessage({ text: "الرمز غير صحيح أو انتهت صلاحيته. تأكد من الرقم الظاهر على التلفزيون وحاول مرة ثانية.", error: true });
      }
    } catch {
      setPairingMessage({ text: "تعذر الاتصال بالخادم. تأكد من الشبكة وحاول مرة ثانية.", error: true });
    } finally {
      setPairingBusy(false);
    }
  };

  const prepareDisplay = async () => {
    if (directBusy) return;
    setDirectBusy(true);
    setDirectMessage(null);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/display-link`, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const body = await response.json() as { ok?: boolean; path?: string };
      if (!response.ok || !body.path) throw new Error("display link unavailable");
      setDisplayUrl(new URL(body.path, location.origin).href);
      setDirectMessage("رابط شاشة العرض جاهز.");
    } catch {
      setDirectMessage("ما قدرنا نجهّز رابط العرض. تأكد من الاتصال وحاول مرة ثانية.");
    } finally {
      setDirectBusy(false);
    }
  };

  const copyDisplay = async () => {
    if (!displayUrl) return;
    try {
      await navigator.clipboard.writeText(displayUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setDirectMessage("المتصفح ما سمح بنسخ الرابط. افتحه وشاركه من المتصفح.");
    }
  };

  const revokeDisplay = async () => {
    if (directBusy) return;
    setDirectBusy(true);
    setPairingMessage(null);
    setDirectMessage(null);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}/display-link`, {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("display revoke unavailable");
      setDisplayUrl(null);
      setCopied(false);
      setDirectMessage("تم إيقاف شاشة العرض الحالية وإبطال صلاحيتها.");
    } catch {
      setDirectMessage("ما قدرنا نوقف شاشة العرض. تأكد من الاتصال وحاول مرة ثانية.");
    } finally {
      setDirectBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-secondary btn-sm utility-tv"
        data-testid="owner-display-control"
        onClick={() => setOpen(true)}
      >
        📺 العب على التلفزيون
      </button>

      {open ? createPortal(
        <div className="sheet-backdrop owner-display-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div
            ref={panelRef}
            className="sheet-panel owner-display-panel"
            role="dialog"
            aria-modal="true"
            aria-label="إدارة شاشة العرض"
            data-testid="owner-display-panel"
            tabIndex={-1}
          >
            <div className="sheet-handle" aria-hidden="true" />
            <div className="sheet-header">
              <div>
                <h2>📺 اربط التلفزيون</h2>
                <p className="helper">اختياري · التلفزيون ما ينحسب لاعب وما يتحكم بالغرفة</p>
              </div>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setOpen(false)}>إغلاق</button>
            </div>

            <ol className="pairing-steps">
              <li>افتح <span dir="ltr" className="num-ltr">{tvAddress}</span> على التلفزيون.</li>
              <li>اكتب الرقم الظاهر على التلفزيون.</li>
            </ol>

            <form className="owner-tv-pairing-form" onSubmit={(event) => void claimPairing(event)}>
              <label htmlFor="tv-pairing-code" className="setting-label">رمز التلفزيون</label>
              <input
                ref={inputRef}
                id="tv-pairing-code"
                className="owner-tv-pairing-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
                maxLength={7}
                value={formatPairingCode(pairingCode)}
                onChange={(event) => {
                  setPairingCode(normalizePairingInput(event.currentTarget.value));
                  setPairingMessage(null);
                }}
                aria-describedby="tv-pairing-help tv-pairing-message"
                placeholder="482 731"
              />
              <div id="tv-pairing-help" className="helper">ستة أرقام. تقدر تلصق الرمز بمسافة أو شرطة.</div>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={pairingCode.length !== 6 || pairingBusy}
              >
                {pairingBusy ? "جاري ربط التلفزيون…" : "ربط التلفزيون"}
              </button>
            </form>

            <div id="tv-pairing-message" role="status" aria-live="polite">
              {pairingMessage ? (
                <p className={`pairing-message${pairingMessage.error ? " is-error" : " is-success"}`}>
                  {pairingMessage.text}
                </p>
              ) : null}
            </div>

            <button type="button" className="btn btn-danger-quiet btn-md" disabled={directBusy} onClick={() => void revokeDisplay()}>
              {directBusy ? "جاري الإيقاف…" : "إيقاف شاشة العرض الحالية"}
            </button>

            <details className="owner-display-advanced">
              <summary>خيارات أخرى</summary>
              <div className="stack" style={{ marginTop: 12 }}>
                <div>
                  <strong>جهاز آخر</strong>
                  <p className="helper" style={{ marginBlock: 4 }}>استخدم الرابط المباشر إذا بتفتح شاشة العرض على لابتوب أو تابلت أو جهاز إضافي.</p>
                </div>
                {!displayUrl ? (
                  <button type="button" className="btn btn-secondary btn-md" disabled={directBusy} onClick={() => void prepareDisplay()}>
                    {directBusy ? "جاري تجهيز الرابط…" : "جهّز رابط شاشة العرض"}
                  </button>
                ) : (
                  <div className="stack" style={{ gap: 12 }}>
                    <div className="center owner-display-qr"><Qr url={displayUrl} /></div>
                    <div className="row" style={{ flexWrap: "wrap" }}>
                      <a className="btn btn-secondary btn-md" href={displayUrl} target="_blank" rel="noopener noreferrer" data-testid="active-display-link"><Icon name="tv" /> فتح شاشة العرض</a>
                      <button type="button" className="btn btn-secondary btn-md" onClick={() => void copyDisplay()}>{copied ? "تم النسخ ✓" : "نسخ الرابط"}</button>
                    </div>
                  </div>
                )}
                {directMessage ? <p className="helper" role="status" style={{ margin: 0 }}>{directMessage}</p> : null}
              </div>
            </details>
          </div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
