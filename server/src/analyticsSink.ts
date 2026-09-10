import type { AnalyticsRecord, AnalyticsSink } from "./analytics.js";

type FetchLike = typeof fetch;

export interface SupabaseAnalyticsOptions {
  url: string;
  secretKey: string;
  deploymentSha?: string;
  fetchImpl?: FetchLike;
}

function normalizedBaseUrl(raw: string): string {
  const url = new URL(raw);
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !local) throw new Error("analytics Supabase URL must use https");
  return url.toString().replace(/\/$/, "");
}

/**
 * Server-only Supabase/PostgREST sink. The secret key is sent only in the
 * `apikey` header and is never copied into logs, events, errors, or responses.
 */
export function createSupabaseAnalyticsSink(options: SupabaseAnalyticsOptions): AnalyticsSink {
  const baseUrl = normalizedBaseUrl(options.url);
  const secretKey = options.secretKey.trim();
  if (!secretKey) throw new Error("analytics Supabase secret key is empty");
  const deploymentSha = (options.deploymentSha ?? "unknown").slice(0, 64) || "unknown";
  const fetchImpl = options.fetchImpl ?? fetch;

  return async (records: readonly AnalyticsRecord[]) => {
    if (!records.length) return;
    const body = records.map((record) => ({
      occurred_at: record.occurredAt,
      event_type: record.event,
      properties: record.props,
      deployment_sha: deploymentSha,
    }));

    const response = await fetchImpl(`${baseUrl}/rest/v1/analytics_events`, {
      method: "POST",
      headers: {
        apikey: secretKey,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(5_000),
    });

    if (!response.ok) {
      // Do not include response bodies/headers: a proxy or provider can echo
      // credentials or sensitive operational details in them.
      throw new Error(`analytics sink failed with HTTP ${response.status}`);
    }
  };
}

export function createConfiguredAnalyticsSink(
  env: NodeJS.ProcessEnv = process.env,
  fallback: AnalyticsSink,
): AnalyticsSink {
  const url = env.SUPABASE_URL?.trim();
  const secretKey = (env.SUPABASE_SECRET_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY)?.trim();
  if (!url || !secretKey) return fallback;

  try {
    return createSupabaseAnalyticsSink({
      url,
      secretKey,
      deploymentSha: env.RENDER_GIT_COMMIT ?? env.GITHUB_SHA ?? "unknown",
    });
  } catch {
    // Bad analytics configuration must never make the game fail to boot.
    return fallback;
  }
}
