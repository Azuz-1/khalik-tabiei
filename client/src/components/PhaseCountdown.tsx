import { useEffect, useState } from "react";
import { estimatedServerNow } from "../net/clock.js";

export function phaseSecondsRemaining(deadline: number | undefined, now: number): number | null {
  if (deadline == null || !Number.isFinite(deadline)) return null;
  return Math.max(0, Math.ceil((deadline - now) / 1_000));
}

export function PhaseCountdown({
  deadline,
  label,
  warningAtSeconds,
  warningText,
}: {
  deadline: number | undefined;
  label: string;
  warningAtSeconds?: number;
  warningText?: string;
}) {
  const [, tick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => tick((value) => value + 1), 100);
    return () => window.clearInterval(id);
  }, [deadline]);

  const seconds = phaseSecondsRemaining(deadline, estimatedServerNow());
  const warning = seconds != null && seconds > 0 && warningAtSeconds != null && seconds <= warningAtSeconds;

  return (
    <div className={`phase-countdown${warning ? " warning" : ""}`} role="timer" aria-live="polite">
      <span className="phase-countdown-label">{warning && warningText ? warningText : label}</span>
      <strong className="phase-countdown-value">{seconds ?? "—"}</strong>
      <span className="phase-countdown-unit">ثانية</span>
    </div>
  );
}
