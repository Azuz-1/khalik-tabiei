/**
 * Privacy-safe server-side gameplay analytics.
 *
 * Contract:
 * - event properties are allowlisted per event, never copied wholesale;
 * - no room code, player/session UID, display name, vote mapping, prompt text,
 *   raw client message, raw error text, IP address, or persistent device fingerprint;
 * - roomSessionId/matchId are random lifecycle-scoped analytics IDs, never derived from a player or room code;
 * - client/device telemetry is deliberately coarse and low-cardinality;
 * - delivery is queued, bounded, async, and never allowed to block gameplay.
 */
import type { AnalyticsEvent } from "../../shared/types.js";
import { createConfiguredAnalyticsSink } from "./analyticsSink.js";

export type AnalyticsValue = string | number | boolean;
export type AnalyticsProps = Record<string, AnalyticsValue | undefined>;
export type AnalyticsTracker = (event: AnalyticsEvent, props?: AnalyticsProps) => void;
export interface AnalyticsRecord {
  event: AnalyticsEvent;
  occurredAt: string;
  props: AnalyticsProps;
}
export type AnalyticsSink = (records: readonly AnalyticsRecord[]) => void | Promise<void>;

export const ANALYTICS_RULES_VERSION = "competitive-exact-challenges-v2";
export const ANALYTICS_CONTENT_VERSION = "imitation-330-quality-v1";

const ENABLED = process.env.ANALYTICS !== "off";
const MAX_QUEUE = 512;
const FLUSH_BATCH = 64;
const MAX_STRING_LENGTH = 80;

const ALLOWED_KEYS: Record<AnalyticsEvent, readonly string[]> = {
  room_created: ["roomSessionId"],
  settings_changed: ["roomSessionId", "targetChallenges", "modeCount", "modeSet"],
  player_joined: ["roomSessionId", "playerCount"],
  player_kicked: ["roomSessionId", "matchId", "matchOrdinal", "phase", "duringMatch", "playerCountAfter"],
  host_disconnected: ["roomSessionId", "matchId", "matchOrdinal", "phase", "duringMatch"],
  host_reconnected: ["roomSessionId", "matchId", "matchOrdinal", "phase", "duringMatch"],
  game_started: [
    "roomSessionId",
    "matchId",
    "matchOrdinal",
    "isFirstMatch",
    "targetChallenges",
    "startingPlayerCount",
    "modeCount",
    "modeSet",
    "rulesVersion",
    "contentVersion",
  ],
  challenge_completed: [
    "roomSessionId",
    "matchId",
    "matchOrdinal",
    "targetChallenges",
    "challengeOrdinal",
    "challengeWithinStint",
    "stintOrdinal",
    "stintMaxChallenges",
    "participantCount",
    "mode",
    "promptId",
    "caught",
    "stintComplete",
    "impostorVotes",
    "requiredVotes",
    "topNormalVotes",
    "distinctTargets",
    "voteMargin",
    "unanimousForImpostor",
    "readySeconds",
    "discussionSeconds",
    "votingSeconds",
    "challengeSeconds",
    "rulesVersion",
    "contentVersion",
  ],
  game_completed: [
    "roomSessionId",
    "matchId",
    "matchOrdinal",
    "isFirstMatch",
    "targetChallenges",
    "completedChallenges",
    "startingPlayerCount",
    "endingPlayerCount",
    "durationSeconds",
    "impostorStints",
    "caughtStints",
    "topScore",
    "averageScore",
    "scoreSpread",
    "rulesVersion",
    "contentVersion",
  ],
  game_abandoned: [
    "roomSessionId",
    "matchId",
    "matchOrdinal",
    "targetChallenges",
    "completedChallenges",
    "startingPlayerCount",
    "reason",
    "phase",
  ],
  rematch_requested: ["roomSessionId", "matchId", "matchOrdinal", "targetChallenges", "startingPlayerCount"],
  rematch_started: ["roomSessionId", "previousMatchId", "matchId", "previousMatchOrdinal", "matchOrdinal", "targetChallenges", "startingPlayerCount"],
  player_left: ["roomSessionId", "matchId", "matchOrdinal", "phase", "duringMatch"],
  player_disconnected: ["roomSessionId", "matchId", "matchOrdinal", "phase", "duringMatch"],
  player_reconnected: ["roomSessionId", "matchId", "matchOrdinal", "phase", "duringMatch"],
  room_closed: ["roomSessionId", "matchId", "reason", "matchOrdinal", "duringMatch"],
  room_ended_unknown: ["roomSessionId", "matchId", "reason", "matchOrdinal", "phase"],
  game_error: ["roomSessionId", "matchId", "code", "action", "phase", "duringMatch"],
  suggestion_submitted: ["category", "lengthBucket"],
  client_started: [
    "deviceClass",
    "viewportBucket",
    "browserFamily",
    "osFamily",
    "displayMode",
    "languageGroup",
    "touch",
    "connectionType",
    "saveData",
    "reducedMotion",
    "hardwareConcurrencyBucket",
    "deviceMemoryBucket",
    "pixelRatioBucket",
    "orientation",
    "audioContext",
    "vibration",
    "share",
    "intlSegmenter",
    "visualViewport",
    "networkInfo",
    "routeBucket",
  ],
  client_performance: [
    "navigationType",
    "domContentLoadedMs",
    "loadMs",
    "fcpMs",
    "ttfbMs",
    "resourceCount",
    "transferKb",
    "routeBucket",
  ],
  client_vital: ["metric", "value", "rating", "routeBucket"],
  client_session_summary: [
    "lifetimeSeconds",
    "foregroundSeconds",
    "backgroundTransitions",
    "offlineTransitions",
    "onlineTransitions",
    "resizeEvents",
    "orientationChanges",
    "routeBucket",
  ],
  client_error: ["kind", "routeBucket", "online"],
};

const queue: AnalyticsRecord[] = [];
let flushScheduled = false;
let flushInProgress = false;
let dropped = 0;

const consoleSink: AnalyticsSink = (records) => {
  for (const record of records) {
    // eslint-disable-next-line no-console
    console.log(`[analytics] ${record.event}`, JSON.stringify(record.props));
  }
};

let sink: AnalyticsSink = createConfiguredAnalyticsSink(process.env, consoleSink);

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
  if (flushScheduled || flushInProgress) return;
  flushScheduled = true;
  setImmediate(() => { void flush(); });
}

async function flush(): Promise<void> {
  if (flushInProgress) return;
  flushScheduled = false;
  if (!queue.length) return;
  flushInProgress = true;
  const batch = queue.splice(0, FLUSH_BATCH);

  try {
    await sink(batch);
  } catch {
    // Telemetry is best-effort. Failed batches are dropped rather than retried
    // indefinitely in memory, and no failure can escape into gameplay.
    dropped += batch.length;
    try {
      // eslint-disable-next-line no-console
      console.warn("[analytics] dropped batch", JSON.stringify({ count: batch.length }));
    } catch { /* analytics failures stay isolated */ }
  } finally {
    flushInProgress = false;
    if (queue.length) scheduleFlush();
  }
}

export const track: AnalyticsTracker = (event, props = {}) => {
  if (!ENABLED) return;
  try {
    const record: AnalyticsRecord = {
      event,
      occurredAt: new Date().toISOString(),
      props: sanitizeAnalyticsProps(event, props),
    };
    if (queue.length >= MAX_QUEUE) {
      dropped += 1;
      return;
    }
    queue.push(record);
    scheduleFlush();
  } catch {
    dropped += 1;
  }
};

export function analyticsQueueStateForTests(): { queued: number; dropped: number; flushing: boolean } {
  return { queued: queue.length, dropped, flushing: flushInProgress };
}

/** Test-only hook; production configuration is fixed at module initialization. */
export function setAnalyticsSinkForTests(next: AnalyticsSink): void {
  sink = next;
}
