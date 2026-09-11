import { useState } from "react";
import type { ClientView } from "../../../shared/types.js";
import { Qr } from "./Qr.js";

export function OwnerDisplayControl({ view }: { view: ClientView }) {
  const [open, setOpen] = useState(false);
  const [displayUrl, setDisplayUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const prepareDisplay = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(view.room.code)}/display-link`, {
        method: "GET",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      const body = await response.json() as { ok?: boolean; path?: string };
      if (!response.ok || !body.path) throw new Error("display link unavailable");
      setDisplayUrl(new URL(body.path, location.origin).href);
      setMessage("رابط شاشة العرض جاهز.");
    } catch {
      setMessage("ما قدرنا نجهّز رابط العرض. تأكد من الاتصال وحاول مرة ثانية.");
    } finally {
      setBusy(false);
    }
  };

  const copyDisplay = async () => {
    if (!displayUrl) return;
    try {
      await navigator.clipboard.writeText(displayUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setMessage("المتصفح ما سمح بنسخ الرابط. افتحه وشاركه من المتصفح.");
    }
  };

  const revokeDisplay = async () => {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/rooms/${encodeURIComponent(view.room.code)}/display-link`, {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json" },
      });
      if (!response.ok) throw new Error("display revoke unavailable");
      setDisplayUrl(null);
      setCopied(false);
      setMessage("تم إيقاف أي شاشة عرض مرتبطة وإبطال الرابط القديم.");
    } catch {
      setMessage("ما قدرنا نوقف شاشة العرض. تأكد من الاتصال وحاول مرة ثانية.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button
        type="button"
        className="btn btn-ghost btn-sm"
        data-testid="owner-display-control"
        onClick={() => setOpen(true)}
        style={{
          position: "fixed",
          top: "max(16px, env(safe-area-inset-top))",
          insetInlineStart: 18,
          zIndex: 40,
        }}
      >
        📺 شاشة العرض
      </button>

      {open ? (
        <div className="overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false); }}>
          <div
            className="card stack"
            role="dialog"
            aria-modal="true"
            aria-label="إدارة شاشة العرض"
            data-testid="owner-display-panel"
            style={{ width: "min(92vw, 480px)", maxHeight: "88vh", overflowY: "auto" }}
          >
            <div className="row between">
              <div>
                <strong>📺 شاشة العرض</strong>
                <div className="helper">اختيارية · ما تنحسب لاعب وما تتحكم بالغرفة</div>
              </div>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>إغلاق</button>
            </div>

            <p className="helper" style={{ margin: 0 }}>
              تقدر تربط شاشة جديدة حتى بعد بدء اللعبة. إذا انتقلت ملكية الغرفة، المالك الجديد يولّد رابطًا جديدًا من هنا.
            </p>

            {!displayUrl ? (
              <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void prepareDisplay()}>
                {busy ? "جاري تجهيز الرابط…" : "جهّز رابط شاشة العرض"}
              </button>
            ) : (
              <div className="stack" style={{ gap: 12 }}>
                <div className="center"><Qr url={displayUrl} /></div>
                <div className="row" style={{ flexWrap: "wrap" }}>
                  <a className="btn btn-primary" href={displayUrl} target="_blank" rel="noopener noreferrer" data-testid="active-display-link">فتح شاشة العرض</a>
                  <button type="button" className="btn btn-ghost" onClick={() => void copyDisplay()}>{copied ? "تم النسخ ✓" : "نسخ الرابط"}</button>
                </div>
              </div>
            )}

            <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => void revokeDisplay()}>
              {busy ? "جاري الإيقاف…" : "إيقاف أي شاشة عرض وإبطال الرابط"}
            </button>

            {message ? <p className="helper" role="status" style={{ margin: 0 }}>{message}</p> : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
