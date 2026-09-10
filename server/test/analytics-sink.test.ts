import test from "node:test";
import assert from "node:assert/strict";
import { createConfiguredAnalyticsSink, createSupabaseAnalyticsSink } from "../src/analyticsSink.js";
import type { AnalyticsRecord, AnalyticsSink } from "../src/analytics.js";

const record: AnalyticsRecord = {
  event: "challenge_completed",
  occurredAt: "2026-09-10T07:30:00.000Z",
  props: {
    promptId: "H017",
    participantCount: 3,
    caught: true,
  },
};

test("Supabase sink batches rows with apikey-only server authentication", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(null, { status: 201 });
  }) as typeof fetch;

  const sink = createSupabaseAnalyticsSink({
    url: "https://example.supabase.co/",
    secretKey: "sb_secret_test_value",
    deploymentSha: "abc123",
    fetchImpl: fakeFetch,
  });

  await sink([record]);

  assert.equal(requestUrl, "https://example.supabase.co/rest/v1/analytics_events");
  const headers = new Headers(requestInit?.headers);
  assert.equal(headers.get("apikey"), "sb_secret_test_value");
  assert.equal(headers.get("authorization"), null, "new Supabase secret keys must not be sent as bearer JWTs");
  assert.equal(headers.get("prefer"), "return=minimal");

  const rows = JSON.parse(String(requestInit?.body));
  assert.deepEqual(rows, [{
    occurred_at: record.occurredAt,
    event_type: "challenge_completed",
    properties: record.props,
    deployment_sha: "abc123",
  }]);
});

test("Supabase sink failure exposes only status, never provider response text", async () => {
  const fakeFetch = (async () => new Response("secret echoed by proxy", { status: 500 })) as typeof fetch;
  const sink = createSupabaseAnalyticsSink({
    url: "https://example.supabase.co",
    secretKey: "sb_secret_never-log-me",
    fetchImpl: fakeFetch,
  });

  await assert.rejects(async () => {
    await sink([record]);
  }, (error: unknown) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /HTTP 500/);
    assert.equal(error.message.includes("secret echoed"), false);
    assert.equal(error.message.includes("never-log-me"), false);
    return true;
  });
});

test("configured sink falls back safely when database settings are absent or invalid", async () => {
  let fallbackCalls = 0;
  const fallback: AnalyticsSink = () => { fallbackCalls += 1; };

  await createConfiguredAnalyticsSink({}, fallback)([record]);
  await createConfiguredAnalyticsSink({ SUPABASE_URL: "not a url", SUPABASE_SECRET_KEY: "x" }, fallback)([record]);

  assert.equal(fallbackCalls, 2);
});
