import type { ClientView } from "../../../shared/types.js";

/**
 * Two deliberately different number systems:
 *  - Match progress («التحدّي 4 من 9») is a continuous segmented rail.
 *  - Impostor stint («دور المتخفي 2 من 3») is a short row of discrete pips.
 * Scoring (+1/+2/+3) never uses either shape.
 */

export interface MatchPosition {
  challenge: { current: number; total: number };
  stint?: { current: number; max: number };
}

/** Settlement increments completedChallenges before RESULT renders, so RESULT keeps the settled challenge. */
export function matchPosition(view: ClientView): MatchPosition {
  const active = view.room.phase === "RESULT"
    ? Math.max(1, view.room.completedChallenges)
    : view.room.completedChallenges + 1;
  const total = view.room.targetChallenges;
  const current = Math.max(1, Math.min(total, active));
  return {
    challenge: { current, total },
    ...(view.challenge ? { stint: { current: view.challenge.index, max: view.challenge.max } } : {}),
  };
}

export function ChallengeLabel({ current, total }: { current: number; total: number }) {
  return <span className="mp-label">التحدّي <b className="num-ltr">{current}</b> من {total}</span>;
}

export function StintLabel({ current, max }: { current: number; max: number }) {
  return <span className="mp-label">دور المتخفي <b className="num-ltr">{current}</b> من {max}</span>;
}

function ChallengeRail({ current, total }: { current: number; total: number }) {
  return (
    <span className="mp-rail" aria-hidden="true">
      {Array.from({ length: total }, (_, index) => (
        <i key={index} className={index + 1 < current ? "done" : index + 1 === current ? "now" : undefined} />
      ))}
    </span>
  );
}

function StintPips({ current, max }: { current: number; max: number }) {
  return (
    <span className="mp-pips" aria-hidden="true">
      {Array.from({ length: max }, (_, index) => (
        <i key={index} className={index + 1 < current ? "done" : index + 1 === current ? "now" : undefined} />
      ))}
    </span>
  );
}

export function MatchProgress({ position, variant = "hud" }: { position: MatchPosition; variant?: "hud" | "tv" }) {
  const { challenge, stint } = position;
  return (
    <div className={`match-progress match-progress-${variant}`}>
      <div className="mp-item mp-challenge">
        <ChallengeLabel current={challenge.current} total={challenge.total} />
        <ChallengeRail current={challenge.current} total={challenge.total} />
      </div>
      {stint ? (
        <div className="mp-item mp-stint">
          <StintLabel current={stint.current} max={stint.max} />
          <StintPips current={stint.current} max={stint.max} />
        </div>
      ) : null}
    </div>
  );
}

/** Anonymous fill slots for readiness and ballot turnout: counts only, never names. */
export function SlotMeter({ filled, total, size = "md" }: { filled: number; total: number; size?: "md" | "lg" }) {
  return (
    <span className={`slot-meter slot-meter-${size}`} aria-hidden="true">
      {Array.from({ length: total }, (_, index) => (
        <i key={index} className={index < filled ? "filled" : undefined}>
          {index < filled ? (
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
          ) : null}
        </i>
      ))}
    </span>
  );
}
