import type { CSSProperties } from "react";

const PERSON_COLORS = 10;

function firstGrapheme(value: string): string {
  if (typeof Intl !== "undefined" && "Segmenter" in Intl) {
    const segments = new Intl.Segmenter("ar", { granularity: "grapheme" }).segment(value)[Symbol.iterator]();
    return segments.next().value?.segment ?? "";
  }
  return [...value][0] ?? "";
}

/**
 * Monogram for a display name. The Arabic definite article is skipped so
 * «المالك» reads as «م» instead of every «ال…» name becoming «ا».
 */
export function monogram(name: string): string {
  const trimmed = name.trim();
  const base = /^ال\S{2,}/u.test(trimmed) ? trimmed.slice(2) : trimmed;
  const glyph = firstGrapheme(base) || firstGrapheme(trimmed) || "؟";
  return glyph.toLocaleUpperCase("en");
}

/** CSS colour for a 1-based colour slot. Colour is supplementary; the name is always shown. */
export function colorSlotVar(colorSlot: number | undefined): string {
  const slot = colorSlot && colorSlot > 0 ? ((colorSlot - 1) % PERSON_COLORS) + 1 : 1;
  return `var(--person-${slot})`;
}

export function Avatar({
  name,
  colorSlot,
  size = "md",
  offline = false,
  className = "",
}: {
  name: string;
  colorSlot?: number;
  size?: "sm" | "md" | "lg" | "xl";
  offline?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`avatar avatar-${size}${offline ? " is-offline" : ""}${className ? ` ${className}` : ""}`}
      style={{ "--person-color": colorSlotVar(colorSlot) } as CSSProperties}
      aria-hidden="true"
    >
      <span className="avatar-glyph">{monogram(name)}</span>
    </span>
  );
}

/**
 * Colour slot for each player: their 1-based position in the server's current
 * player list (join order).
 *
 * Why position and not `seatNumber`: phones receive an opaque hashed seat
 * number while the TV receives a room-local 1…n, so no seat value is shared by
 * every screen. The list order is identical everywhere, so at any moment a
 * person has the same colour on every phone and the TV, and no two of up to
 * ten players collide.
 *
 * Accepted trade-off: when someone leaves or is removed, the players after
 * them move up one slot and their colour changes. Colour is therefore never
 * the only identifier; every avatar sits next to the player's name. A colour
 * that survives departures would need a stable shared slot from the server.
 */
export function colorSlotLookup(players: Array<{ uid: string }>): (uid: string) => number | undefined {
  const slots = new Map(players.map((player, index) => [player.uid, index + 1]));
  return (uid: string) => slots.get(uid);
}
