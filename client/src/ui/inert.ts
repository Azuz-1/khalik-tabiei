/**
 * Make everything outside a modal layer inert and hidden from assistive tech.
 *
 * `[data-app-content]` is only part of the participant root: GameChrome, the
 * privacy link and body-level portals are its siblings. So instead of one
 * selector, walk from the modal up to <body> and lock every sibling at each
 * level. Locks are reference-counted per element so nested modals (a confirm
 * dialog over the player manager) release only what they locked, and an
 * element that was already inert before any modal keeps its original state.
 */

interface LockRecord {
  count: number;
  hadInert: boolean;
  ariaHidden: string | null;
}

const locks = new WeakMap<Element, LockRecord>();

function acquire(element: Element): void {
  const record = locks.get(element);
  if (record) {
    record.count += 1;
    return;
  }
  locks.set(element, {
    count: 1,
    hadInert: element.hasAttribute("inert"),
    ariaHidden: element.getAttribute("aria-hidden"),
  });
  element.setAttribute("inert", "");
  element.setAttribute("aria-hidden", "true");
}

function release(element: Element): void {
  const record = locks.get(element);
  if (!record) return;
  record.count -= 1;
  if (record.count > 0) return;
  locks.delete(element);
  if (!record.hadInert) element.removeAttribute("inert");
  if (record.ariaHidden === null) element.removeAttribute("aria-hidden");
  else element.setAttribute("aria-hidden", record.ariaHidden);
}

/** Locks every element outside `layer`'s ancestor chain. Returns the release function. */
export function inertOutside(layer: Element | null): () => void {
  if (!layer || typeof document === "undefined") return () => {};
  const locked: Element[] = [];
  let current: Element = layer;
  while (current !== document.body && current.parentElement) {
    for (const sibling of current.parentElement.children) {
      if (sibling === current || sibling.tagName === "SCRIPT" || sibling.tagName === "STYLE" || sibling.tagName === "TEMPLATE") continue;
      acquire(sibling);
      locked.push(sibling);
    }
    current = current.parentElement;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    for (const element of locked) release(element);
  };
}
