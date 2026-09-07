/**
 * Minimal server-side gameplay analytics.
 *
 * Privacy contract:
 * - event properties are allowlisted per event, never copied wholesale;
 * - no room code, player/session UID, display name, vote mapping, prompt text,
 *   raw client message, raw error text, IP address, or device fingerprint;
 * - delivery is queued and bounded so analytics can never sit on the gameplay path.
 */
import type { AnalyticsEvent } from "../../shared/types.js";

export type AnalyticsValue = string | number | boolean;
export type AnalyticsProps = Record<string, AnalyticsValue | undefined>;
export type AnalyticsTracker = (event: AnalyticsEvent, props?: AnalyticsProps) => void;

export const ANALYTICS_RULES_VERSION = "competitive-v1";
export const ANALYTICS_CONTENT_VERSION = "imitation-bank-v1";

const ENABLED = process.env.ANALYTICS !== "off";
const MAX_QUEUE = 512;
const FLUSH_BATCH = 64;
const MAX_STRING_LENGTH = 80;

const ALLOWED_KEYS: Record<AnalyticsEvent, readonly string[]> = {
  room_created: [],
  game_started: [
    "matchOrdinal",
    "isFirstMatch",
    "targetChallenges",
    "startingPlayerCount",
    "modeCount",
    "rulesVersion",
    "contentVersion",
  ],
  challenge_completed: [
    "matchOrdinal",
    "targetChallenges",
    "challengeOrdinal",
    "challengeWithinStint",
    "stintMaxChallenges",
    "participantCount",
    "mode",
    "promptId",
    "caught",
    "stintComplete",
    "rulesVersion",
    "contentVersion",
  ],
  game_completed: [
    "matchOrdinal",
    "isFirstMatch",
    "targetChallenges",
    "completedChallenges",
    "startingPlayerCount",
    "durationSeconds",
    "impostorStints",
    "caughtStints",
    "rulesVersion",
    "contentVersion",
  ],
  rematch_requested: ["matchOrdinal", "targetChallenges", "startingPlayerCount"],
  rematch_started: ["previousMatchOrdinal", "matchOrdinal", "targetChallenges", "startingPlayerCount"],
  player_left: ["matchOrdinal", "phase", "duringMatch"],
  player_disconnected: ["matchOrdinal", "phase", "duringMatch"],
  player_reconnected: ["matchOrdinal", "phase", "duringMatch"],
  room_closed: ["reason", "matchOrdinal", "duringMatch"],
  room_ended_unknown: ["reason", "matchOrdinal", "phase"],
  game_error: ["code", "action", "phase", "duringMatch"],
};

export interface AnalyticsRecord {
  event: AnalyticsEvent;
  props: AnalyticsProps;
}

const queue: AnalyticsRecord[] = [];
let flushScheduled = false;
let dropped = 0;

function cleanValue(value: AnalyticsValue | undefined): AnalyticsValue | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (typeof value === "boolean") return value;
  const cleaned = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
    .slice(0, MAX_STRING_LENGTH);
  return cleaned || undefined;
}

/** Exported for tests and future sinks; callers still cannot expand the allowlist. */
export function sanitizeAnalyticsProps(event: AnalyticsEvent, props: AnalyticsProps = {}): AnalyticsProps {
  const safe: AnalyticsProps = {};
  for (const key of ALLOWED_KEYS[event]) {
    const value = cleanValue(props[key]);
    if (value !== undefined) safe[key] = value;
  }
  return safe;
}

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  setImmediate(flush);
}

function flush(): void {
  flushScheduled = false;
  const batch = queue.splice(0, FLUSH_BATCH);
  for (const record of batch) {
    try {
      // Default MVP sink. A durable sink can replace this module later without
      // changing gameplay transitions or the event privacy contract.
      // eslint-disable-next-line no-console
      console.log(`[analytics] ${record.event}`, JSON.stringify(record.props));
    } catch {
      dropped += 1;
    }
  }

  if (dropped > 0) {
    try {
      // Operational signal only; this is not a gameplay event.
      // eslint-disable-next-line no-console
      console.warn("[analytics] dropped", JSON.stringify({ count: dropped }));
    } catch { /* analytics failures stay isolated */ }
    dropped = 0;
  }

  if (queue.length) scheduleFlush();
}

export const track: AnalyticsTracker = (event, props = {}) => {
  if (!ENABLED) return;
  try {
    const record: AnalyticsRecord = { event, props: sanitizeAnalyticsProps(event, props) };
    if (queue.length >= MAX_QUEUE) {
      dropped += 1;
      scheduleFlush();
      return;
    }
    queue.push(record);
    scheduleFlush();
  } catch {
    // Analytics is deliberately non-critical. Never throw into game logic.
    dropped += 1;
    scheduleFlush();
  }
};

export function analyticsQueueStateForTests(): { queued: number; dropped: number } {
  return { queued: queue.length, dropped };
}
