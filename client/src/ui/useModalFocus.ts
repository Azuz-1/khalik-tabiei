import { useEffect, type RefObject } from "react";

const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';

/**
 * Modal focus discipline for sheets/dialogs: move focus in, keep Tab inside,
 * make the page behind inert, and restore focus to the opener on close.
 */
export function useModalFocus(
  panelRef: RefObject<HTMLElement>,
  open: boolean,
  {
    initialFocus,
    inertSelector = "[data-app-content]",
  }: { initialFocus?: RefObject<HTMLElement>; inertSelector?: string } = {},
): void {
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const background = [...document.querySelectorAll<HTMLElement>(inertSelector)]
      .filter((element) => !panelRef.current || !element.contains(panelRef.current));
    for (const element of background) {
      element.setAttribute("inert", "");
      element.setAttribute("aria-hidden", "true");
    }
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
      for (const element of background) {
        element.removeAttribute("inert");
        element.removeAttribute("aria-hidden");
      }
      if (previous?.isConnected) previous.focus();
    };
  }, [open]);
}
