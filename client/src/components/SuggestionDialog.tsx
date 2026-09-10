import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

type SuggestionCategory = "idea" | "content" | "bug" | "other";

export function SuggestionDialog({
  open,
  disabled,
  onClose,
}: {
  open: boolean;
  disabled: boolean;
  onClose: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const [category, setCategory] = useState<SuggestionCategory>("idea");
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [feedback, setFeedback] = useState<{ good: boolean; text: string } | null>(null);
  const length = [...text.trim()].length;
  const canSubmit = !disabled && !submitting && length >= 4 && length <= 600;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = document.querySelector<HTMLElement>("[data-app-content]");
    const previousOverflow = document.body.style.overflow;

    background?.setAttribute("inert", "");
    background?.setAttribute("aria-hidden", "true");
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => closeRef.current?.focus(), 0);

    return () => {
      window.clearTimeout(focusTimer);
      background?.removeAttribute("inert");
      background?.removeAttribute("aria-hidden");
      document.body.style.overflow = previousOverflow;
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);

  if (!open) return null;

  const close = () => {
    if (!submitting) onClose();
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !submitting) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = [...panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )];
    if (!focusable.length) {
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

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setFeedback(null);
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 7_000);

    try {
      const response = await fetch("/api/suggestions", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ category, text }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({})) as { code?: string };
      if (response.ok) {
        setText("");
        setFeedback({ good: true, text: "وصل اقتراحك، يعطيك العافية 🙌" });
      } else if (response.status === 429) {
        setFeedback({ good: false, text: "وصلتنا منك اقتراحات كثيرة. جرّب بعد شوي." });
      } else if (payload.code === "CONTACT_INFO") {
        setFeedback({ good: false, text: "خل الاقتراح بدون رقم جوال أو إيميل، حفاظًا على خصوصيتك." });
      } else if (response.status === 400) {
        setFeedback({ good: false, text: "تأكد إن الاقتراح من 4 إلى 600 حرف وجرّب مرة ثانية." });
      } else {
        setFeedback({ good: false, text: "استقبال الاقتراحات مو جاهز الحين. جرّب لاحقًا." });
      }
    } catch {
      setFeedback({ good: false, text: "ما قدرنا نرسل الاقتراح الحين. جرّب لاحقًا." });
    } finally {
      window.clearTimeout(timeout);
      setSubmitting(false);
    }
  };

  return createPortal(
    <div
      className="suggestion-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        className="card suggestion-dialog stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
        aria-busy={submitting}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <div className="suggestion-dialog-header">
          <div className="stack" style={{ gap: 5 }}>
            <div className="eyebrow">ساعدنا نحسنها</div>
            <h2 className="title" id={titleId}>عندك فكرة أو ملاحظة؟</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="suggestion-dialog-close"
            aria-label="إغلاق الاقتراح"
            disabled={submitting}
            onClick={close}
          >
            ×
          </button>
        </div>

        <p className="subtitle" id={descriptionId} style={{ margin: 0 }}>
          قول لنا وش ودك يتغير في اللعب، التحدّيات، الأسئلة أو التجربة.
        </p>

        <form className="stack" onSubmit={submit} style={{ gap: 10 }}>
          <label className="stack" style={{ gap: 6 }}>
            <span className="helper">نوع الملاحظة</span>
            <select
              className="input"
              value={category}
              disabled={disabled || submitting}
              onChange={(event) => setCategory(event.target.value as SuggestionCategory)}
            >
              <option value="idea">فكرة للعبة</option>
              <option value="content">اقتراح تحدّي أو محتوى</option>
              <option value="bug">مشكلة واجهتني</option>
              <option value="other">شيء ثاني</option>
            </select>
          </label>

          <label className="stack" style={{ gap: 6 }}>
            <span className="helper">اقتراحك</span>
            <textarea
              className="input"
              aria-label="اقتراحك لتحسين اللعبة"
              rows={4}
              maxLength={600}
              value={text}
              disabled={disabled || submitting}
              placeholder="مثال: ودي التحدّيات تكون أكثر تنوع…"
              onChange={(event) => {
                setText(event.target.value);
                if (feedback) setFeedback(null);
              }}
            />
          </label>

          <div className="row between" style={{ alignItems: "flex-start", gap: 12 }}>
            <p className="helper" style={{ margin: 0 }}>
              لا تكتب اسمك أو رقمك أو إيميلك. نستخدم اقتراحك لتحسين اللعبة فقط.
            </p>
            <span className="helper" style={{ direction: "ltr", whiteSpace: "nowrap" }}>{length}/600</span>
          </div>

          <button className="btn btn-primary" type="submit" disabled={!canSubmit}>
            {submitting ? "جاري الإرسال…" : "أرسل الاقتراح"}
          </button>
          {feedback ? (
            <p
              className="helper"
              role="status"
              style={{ margin: 0, color: feedback.good ? "var(--good)" : "var(--bad)" }}
            >
              {feedback.text}
            </p>
          ) : null}
        </form>

        <p className="helper" style={{ margin: 0 }}>
          ونستخدم إحصائيات لعب مجهولة لتحسين توازن التحدّيات والأسئلة — بدون أسماء أو أكواد غرف أو معرفة مين صوّت لمين.
        </p>
      </div>
    </div>,
    document.body,
  );
}
