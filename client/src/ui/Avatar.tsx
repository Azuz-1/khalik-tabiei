import type { CSSProperties } from "react";

const SEAT_COLORS = 10;

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

/** Colour is supplementary identity only; the name always stays visible. */
export function seatColor(seatNumber: number | undefined): string {
  const seat = seatNumber && seatNumber > 0 ? ((seatNumber - 1) % SEAT_COLORS) + 1 : 1;
  return `var(--seat-${seat})`;
}

export function Avatar({
  name,
  seat,
  size = "md",
  offline = false,
  className = "",
}: {
  name: string;
  seat?: number;
  size?: "sm" | "md" | "lg" | "xl";
  offline?: boolean;
  className?: string;
}) {
  return (
    <span
      className={`avatar avatar-${size}${offline ? " is-offline" : ""}${className ? ` ${className}` : ""}`}
      style={{ "--seat-color": seatColor(seat) } as CSSProperties}
      aria-hidden="true"
    >
      <span className="avatar-glyph">{monogram(name)}</span>
    </span>
  );
}

/**
 * Colour slot for each player: their position in the server's player list.
 * Phones and the TV receive players in the same order (phones see a hashed
 * seat number, the TV a local 1…n), so position is the one value that keeps a
 * person's colour identical on every screen and unique for up to ten players.
 */
export function seatLookup(players: Array<{ uid: string }>): (uid: string) => number | undefined {
  const slots = new Map(players.map((player, index) => [player.uid, index + 1]));
  return (uid: string) => slots.get(uid);
}
