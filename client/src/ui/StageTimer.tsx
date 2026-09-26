import { useEffect, useState } from "react";
import { estimatedServerNow } from "../net/clock.js";

function remainingMs(endsAt: number | undefined): number | null {
  if (endsAt === undefined) return null;
  return Math.max(0, endsAt - estimatedServerNow());
}

/** Re-renders a few times a second while a server deadline is running. */
export function useRemaining(endsAt: number | undefined, intervalMs = 200): number | null {
  const [remaining, setRemaining] = useState<number | null>(() => remainingMs(endsAt));
  useEffect(() => {
    setRemaining(remainingMs(endsAt));
    if (endsAt === undefined) return;
    const timer = window.setInterval(() => setRemaining(remainingMs(endsAt)), intervalMs);
    return () => window.clearInterval(timer);
  }, [endsAt, intervalMs]);
  return remaining;
}

export type TimerTone = "calm" | "soon" | "final";

export function timerTone(seconds: number, soonAt = 10, finalAt = 5): TimerTone {
  if (seconds <= finalAt) return "final";
  if (seconds <= soonAt) return "soon";
  return "calm";
}

/**
 * The server's `phaseEndsAt` is authoritative; this only renders it.
 * Calm by default, amber inside the warning window, coral for the last few
 * seconds — never flashing. `totalMs` only sizes the ring.
 */
export function StageTimer({
  endsAt,
  totalMs,
  variant = "pill",
  warningAtSeconds,
  warningText,
  urgent = true,
}: {
  endsAt: number | undefined;
  totalMs?: number;
  variant?: "pill" | "ring";
  warningAtSeconds?: number;
  warningText?: string;
  /** Short cue beats (hold) stay calm; only decision windows escalate. */
  urgent?: boolean;
}) {
  const remaining = useRemaining(endsAt);
  if (remaining === null) return null;
  const seconds = Math.ceil(remaining / 1_000);
  // Short windows (voting) only turn amber in their last five seconds.
  const soonAt = warningAtSeconds ?? (totalMs !== undefined && totalMs <= 20_000 ? 5 : 10);
  const tone = urgent ? timerTone(seconds, soonAt, Math.min(5, Math.max(3, soonAt - 5))) : "calm";
  const showWarning = warningAtSeconds !== undefined && warningText !== undefined && seconds > 0 && seconds <= warningAtSeconds;
  const fraction = totalMs ? Math.max(0, Math.min(1, remaining / totalMs)) : 1;

  return (
    <div className={`stage-timer stage-timer-${variant}`} data-tone={tone} data-testid="phase-countdown">
      {variant === "ring" ? (
        <span className="stage-timer-ring">
          <svg viewBox="0 0 100 100" aria-hidden="true">
            <circle className="track" cx="50" cy="50" r="44" pathLength={100} />
            <circle className="fill" cx="50" cy="50" r="44" pathLength={100} strokeDasharray="100" strokeDashoffset={100 - fraction * 100} />
          </svg>
          <span className="stage-timer-value num-ltr" role="timer" aria-label={`${seconds} ثانية`}>{seconds}</span>
        </span>
      ) : (
        <span className="stage-timer-value" role="timer" aria-label={`${seconds} ثانية`}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
            <circle cx="12" cy="13" r="7.5" />
            <path d="M12 9v4l2.5 1.8M9.5 2.5h5" />
          </svg>
          <span className="num-ltr">{seconds}</span> ث
        </span>
      )}
      {showWarning ? <span className="stage-timer-warning" role="status">{warningText}</span> : null}
    </div>
  );
}
