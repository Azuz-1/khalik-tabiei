import { useEffect, type RefObject } from "react";
import { inertOutside } from "./inert.js";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Modal focus discipline for sheets/dialogs: move focus in, keep Tab inside,
 * make everything outside the modal inert (see ui/inert.ts), and restore focus
 * to the opener on close.
 */
export function useModalFocus(
  panelRef: RefObject<HTMLElement>,
  open: boolean,
  { initialFocus }: { initialFocus?: RefObject<HTMLElement> } = {},
): void {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const releaseBackground = inertOutside(panelRef.current);
    const focusTimer = window.setTimeout(() => (initialFocus?.current ?? panelRef.current)?.focus(), 0);

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const panel = panelRef.current;
      if (!panel) return;
      const focusable = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      releaseBackground();
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
}
