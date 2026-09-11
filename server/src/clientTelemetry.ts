import { createHash } from "node:crypto";
import type { AnalyticsEvent } from "../../shared/types.js";
import { sanitizeAnalyticsProps, track, type AnalyticsProps, type AnalyticsTracker } from "./analytics.js";
import { FixedWindowLimiter } from "./security/rateLimit.js";

export type ClientTelemetryEvent = Extract<
  AnalyticsEvent,
  "client_started" | "client_performance" | "client_vital" | "client_session_summary" | "client_error"
>;

interface TelemetryEnvelope {
  event: ClientTelemetryEvent;
  props: AnalyticsProps;
}

const CLIENT_EVENTS = new Set<ClientTelemetryEvent>([
  "client_started",
  "client_performance",
  "client_vital",
  "client_session_summary",
  "client_error",
]);

const MAX_EVENTS_PER_BATCH = 20;
const MAX_KEYS_PER_EVENT = 24;

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function telemetryScalar(value: unknown): string | number | boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) && Math.abs(value) <= 1_000_000 ? value : undefined;
  if (typeof value === "string") {
    const cleaned = value
      .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, "")
      .trim();
    return cleaned && cleaned.length <= 80 ? cleaned : undefined;
  }
  return undefined;
}

/**
 * Analytics identity is deliberately separate from the gameplay/session uid.
 * The input uid is already a server-derived pseudonym from a random HttpOnly
 * session token; domain-separated hashing prevents the analytics store from
 * containing the gameplay uid itself while remaining stable for that session.
 */
export function analyticsPlayerId(identity: string): string {
  return `ap_${createHash("sha256").update("khalik-tabiei:analytics-player:v1\0").update(identity).digest("hex").slice(0, 32)}`;
}

export function parseClientTelemetryBatch(value: unknown): TelemetryEnvelope[] | null {
  if (!isObject(value) || Object.keys(value).some((key) => key !== "events") || !Array.isArray(value.events)) return null;
  if (value.events.length < 1 || value.events.length > MAX_EVENTS_PER_BATCH) return null;

  const parsed: TelemetryEnvelope[] = [];
  for (const raw of value.events) {
    if (!isObject(raw) || Object.keys(raw).some((key) => key !== "event" && key !== "props")) return null;
    if (typeof raw.event !== "string" || !CLIENT_EVENTS.has(raw.event as ClientTelemetryEvent)) return null;
    if (!isObject(raw.props) || Object.keys(raw.props).length > MAX_KEYS_PER_EVENT) return null;

    const props: AnalyticsProps = {};
    for (const [key, rawValue] of Object.entries(raw.props)) {
      if (!/^[A-Za-z][A-Za-z0-9]{0,39}$/.test(key)) return null;
      const scalar = telemetryScalar(rawValue);
      if (scalar === undefined) return null;
      props[key] = scalar;
    }
    const event = raw.event as ClientTelemetryEvent;
    parsed.push({ event, props: sanitizeAnalyticsProps(event, props) });
  }
  return parsed;
}

export class ClientTelemetryIngestor {
  private readonly requests = new FixedWindowLimiter(30, 60_000, 10_000);

  constructor(private readonly analytics: AnalyticsTracker = track) {}

  ingest(identity: string, body: unknown): { ok: true; count: number } | { ok: false; code: "BAD_REQUEST" | "RATE_LIMITED" } {
    if (!this.requests.allow(identity)) return { ok: false, code: "RATE_LIMITED" };
    const events = parseClientTelemetryBatch(body);
    if (!events) return { ok: false, code: "BAD_REQUEST" };

    const pseudonymousPlayerId = analyticsPlayerId(identity);
    for (const event of events) {
      try {
        const props = event.event === "client_started" || event.event === "client_session_summary"
          ? { ...event.props, analyticsPlayerId: pseudonymousPlayerId }
          : event.props;
        this.analytics(event.event, props);
      } catch { /* telemetry never affects gameplay */ }
    }
    return { ok: true, count: events.length };
  }
}
