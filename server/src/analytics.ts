/**
 * Lightweight analytics. Keeps an event abstraction so an external provider can
 * be plugged in later, but the default sink just logs a minimal, privacy-safe
 * line. NEVER include secret questions, answers, votes, or names here.
 */
import type { AnalyticsEvent } from "../../shared/types.js";

type Props = Record<string, string | number | boolean | undefined>;

const ENABLED = process.env.ANALYTICS !== "off";

export function track(event: AnalyticsEvent, props: Props = {}): void {
  if (!ENABLED) return;
  // Defer to console for the MVP; swap for a real provider behind this call.
  const safe: Props = {};
  for (const [k, v] of Object.entries(props)) {
    // Guardrail: drop anything that looks free-text/PII-ish by key name.
    if (/name|answer|question|vote|key|uid/i.test(k)) continue;
    safe[k] = v;
  }
  // eslint-disable-next-line no-console
  console.log(`[analytics] ${event}`, JSON.stringify(safe));
}
