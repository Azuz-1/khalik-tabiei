/**
 * Privacy-conscious server-side gameplay analytics.
 *
 * Contract:
 * - event properties are allowlisted per event, never copied wholesale;
 * - no room code, display name, vote mapping, prompt text, raw client message,
 *   raw error text, raw IP address, or device fingerprint;
 * - roomSessionId/matchId are random lifecycle-scoped analytics IDs, never derived from a player or room code;
 * - analyticsPlayerId is a server-derived pseudonymous identifier stable for the signed anonymous browser-session cookie lifetime;
 * - client/device telemetry is deliberately coarse and low-cardinality;
 * - delivery is queued, bounded, async, and never allowed to block gameplay.
 */
import { randomUUID } from "node:crypto";
import type { AnalyticsEvent } from "../../shared/types.js";
import { createConfiguredAnalyticsSink } from "./analyticsSink.js";
import { analyticsPlayerId } from "./analyticsIdentity.js";

export { analyticsPlayerId };

export type AnalyticsValue = string | number | boolean;
export type AnalyticsProps = Record<string, AnalyticsValue | undefined>;
export type AnalyticsTracker = (event: AnalyticsEvent, props?: AnalyticsProps) => void;
export type AnalyticsEnvironment = "production" | "staging" | "development" | "test";

export interface AnalyticsRecord {
  eventId: string;
  schemaVersion: number;
  environment: AnalyticsEnvironment;
  event: AnalyticsEvent;
  occurredAt: string;
  props: AnalyticsProps;
}
export type AnalyticsSink = (records: readonly AnalyticsRecord[]) => void | Promise<void>;

/** Catch threshold changed to a strict majority of ballots actually cast. */
export const ANALYTICS_RULES_VERSION = "competitive-cast-vote-majority-v3";
export const ANALYTICS_CONTENT_VERSION = "imitation-900-novelty-v1";

export const ANALYTICS_SCHEMA_VERSION = 2;

const ENABLED = process.env.ANALYTICS !== "off";
const MAX_QUEUE = 512;
const FLUSH_BATCH = 64;
const MAX_STRING_LENGTH = 80;

const ALLOWED_KEYS: Record<AnalyticsEvent, readonly string[]> = {
  room_created: ["roomSessionId"],
  settings_changed: ["roomSessionId", "targetChallenges", "modeCount", "modeSet"],
  player_joined: ["roomSessionId", "playerCount"],
  room_participant_joined: ["roomSessionId", "analyticsPlayerId", "isOwner", "playerCount"],
  player_kicked: ["roomSessionId", "matchId", "matchOrdinal", "phase", "duringMatch", "playerCountAfter", "analyticsPlayerId"],
  host_disconnected: ["roomSessionId", "matchId", "matchOrdinal", "phase", "duringMatch", "analyticsPlayerId"],
  host_reconnected: ["roomSessionId", "matchId", "matchOrdinal", "phase", "duringMatch", "analyticsPlayerId"],
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
  match_participant: [
    "roomSessionId",
    "matchId",
    "matchOrdinal",
    "analyticsPlayerId",
    "isOwner",
    "startingPlayerCount",
    "targetChallenges",
  ],
  challenge_completed: [
    "roomSessionId",
    "matchId",
    "matchOrdinal",
    "targetChallenges",
    "challengeOrdinal",
    "challengeWithinStint",
    "challengeIndex",
    "stintOrdinal",
    "stintMaxChallenges",
    "participantCount",
    "votesCast",
    "abstentionCount",
    "timedOut",
    "maxVotesOnOneTarget",
    "mode",
    "promptId",
    "caught",
    "stintComplete",
    "impostorVotes",
    "impostorVoted",
    "singleVoteCatch",
    "requiredVotes",
    "topNormalVotes",
    "distinctTargets",
    "voteMargin",
    "allNormalsVotedImpostor",
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
  player_left: ["roomSessionId", "matchId", "matchOrdinal", "phase", "duringMatch", "analyticsPlayerId"],
  player_disconnected: ["roomSessionId", "matchId", "matchOrdinal", "phase", "duringMatch", "analyticsPlayerId"],
  player_reconnected: ["roomSessionId", "matchId", "matchOrdinal", "phase", "duringMatch", "analyticsPlayerId"],
  room_closed: ["roomSessionId", "matchId", "reason", "matchOrdinal", "duringMatch"],
  room_ended_unknown: ["roomSessionId", "matchId", "reason", "matchOrdinal", "phase"],
  game_error: ["roomSessionId", "matchId", "code", "action", "phase", "duringMatch", "analyticsPlayerId"],
  suggestion_submitted: ["category", "lengthBucket"],
  client_started: [
    "analyticsPlayerId",
    "clientSessionId",
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
    "clientSessionId",
    "navigationType",
    "domContentLoadedMs",
    "loadMs",
    "fcpMs",
    "ttfbMs",
    "resourceCount",
    "transferKb",
    "routeBucket",
  ],
  client_vital: ["clientSessionId", "metric", "value", "rating", "routeBucket"],
  client_session_summary: [
    "analyticsPlayerId",
    "clientSessionId",
    "summaryKind",
    "playedMatch",
    "phase",
    "isOwner",
    "playerCount",
    "targetChallenges",
    "modeCount",
    "lifetimeSeconds",
    "foregroundSeconds",
    "backgroundTransitions",
    "offlineTransitions",
    "onlineTransitions",
    "resizeEvents",
    "orientationChanges",
    "routeBucket",
  ],
  client_error: ["clientSessionId", "kind", "routeBucket", "online"],
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

export function analyticsEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): AnalyticsEnvironment {
  const explicit = env.ANALYTICS_ENVIRONMENT;
  if (
    explicit === "production" ||
    explicit === "staging" ||
    explicit === "development" ||
    explicit === "test"
  ) return explicit;
  if (env.NODE_ENV === "test") return "test";
  if (env.NODE_ENV === "production") return "production";
  return "development";
}

const RETRY_DELAYS_MS = [150, 600] as const;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function deliverWithRetry(batch: readonly AnalyticsRecord[]): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      await deliverWithRetry(batch);
      return;
    } catch (error) {
      lastError = error;
      const delay = RETRY_DELAYS_MS[attempt];
      if (delay === undefined) break;
      await sleep(delay);
    }
  }
  throw lastError;
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
      console.warn("[analytics] dropped batch", JSON.stringify({
        count: batch.length,
        firstEventId: batch[0]?.eventId,
      }));
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
      eventId: randomUUID(),
      schemaVersion: ANALYTICS_SCHEMA_VERSION,
      environment: analyticsEnvironment(),
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

/** Test-only hook to deterministically await queued delivery. */
export async function flushAnalyticsForTests(): Promise<void> {
  while (queue.length || flushInProgress) {
    await flush();
    if (flushInProgress) await new Promise((resolve) => setImmediate(resolve));
  }
}
