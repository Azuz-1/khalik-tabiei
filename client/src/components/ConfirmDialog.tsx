import { useEffect, useId, useRef } from "react";

export interface ConfirmDialogState {
  title: string;
  description: string;
  confirmLabel: string;
  pending: boolean;
  error?: string;
}

export function ConfirmDialog({
  state,
  onConfirm,
  onCancel,
}: {
  state: ConfirmDialogState | null;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const titleId = useId();
  const descriptionId = useId();
  const errorId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!state) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = document.querySelector<HTMLElement>("[data-app-content]");
    background?.setAttribute("inert", "");
    background?.setAttribute("aria-hidden", "true");
    const focusTimer = window.setTimeout(() => cancelRef.current?.focus(), 0);

    return () => {
      window.clearTimeout(focusTimer);
      background?.removeAttribute("inert");
      background?.removeAttribute("aria-hidden");
      if (previous?.isConnected) {
        previous.focus();
        return;
      }
      const fallback =
        document.querySelector<HTMLElement>(".player-manager-panel button:not([disabled])") ??
        document.querySelector<HTMLElement>('button:not([disabled]), [href], input:not([disabled]), [tabindex]:not([tabindex="-1"])');
      fallback?.focus();
    };
  }, [state ? `${state.title}:${state.description}` : null]);

  if (!state) return null;

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !state.pending) {
      event.preventDefault();
      onCancel();
      return;
    }
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    if (!panel) return;
    const focusable = [...panel.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )];
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
    <div className="confirm-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !state.pending) onCancel();
    }}>
      <div
        ref={panelRef}
        className="card confirm-dialog stack"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={`${descriptionId}${state.error ? ` ${errorId}` : ""}`}
        aria-busy={state.pending}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className="title">{state.title}</h2>
        <p id={descriptionId} className="subtitle">{state.description}</p>
        {state.error ? <p id={errorId} className="confirm-error" role="status">{state.error}</p> : null}
        <div className="confirm-actions">
          <button ref={cancelRef} type="button" className="btn btn-ghost" disabled={state.pending} onClick={onCancel}>إلغاء</button>
          <button type="button" className="btn btn-danger" disabled={state.pending} onClick={onConfirm}>
            {state.pending ? "جارٍ التنفيذ…" : state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
