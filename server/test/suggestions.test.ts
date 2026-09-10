import test from "node:test";
import assert from "node:assert/strict";
import {
  cleanSuggestionText,
  createSupabaseSuggestionSink,
  SuggestionService,
  type StoredSuggestion,
} from "../src/suggestions.js";

test("suggestion text accepts useful Arabic feedback and strips unsafe controls", () => {
  const result = cleanSuggestionText("  ودي التحديات تكون أسرع\u202e  ");
  assert.equal(result.code, undefined);
  assert.equal(result.text, "ودي التحديات تكون أسرع");
});

test("suggestions reject contact details and unreasonable lengths", () => {
  for (const value of [
    "راسلني test@example.com",
    "هذا رقمي 0551234567",
    "هذا رقمي ٠٥٥١٢٣٤٥٦٧",
    "abc",
    "x".repeat(601),
  ]) {
    assert.ok(cleanSuggestionText(value).code, value);
  }
});

test("stored suggestions contain no uid ip room or device identity", async () => {
  const stored: StoredSuggestion[] = [];
  const service = new SuggestionService((suggestion) => { stored.push(suggestion); }, "abc123", () => 0);

  const result = await service.submit("203.0.113.4", "u_000000000000000000000123", {
    category: "content",
    text: "اقترح سؤال عن طلعات البر",
  });

  assert.deepEqual(result, { ok: true, category: "content", lengthBucket: "short" });
  assert.equal(stored.length, 1);
  assert.deepEqual(Object.keys(stored[0]!).sort(), ["category", "deploymentSha", "occurredAt", "text"]);
  const serialized = JSON.stringify(stored[0]);
  assert.equal(serialized.includes("203.0.113.4"), false);
  assert.equal(serialized.includes("u_000000000000000000000123"), false);
  assert.equal(serialized.toLowerCase().includes("room"), false);
  assert.equal(serialized.toLowerCase().includes("device"), false);
});

test("one browser cannot flood the suggestion inbox", async () => {
  let stored = 0;
  const service = new SuggestionService(() => { stored += 1; }, "abc123", () => 0);
  const payload = { category: "idea", text: "فكرة مفيدة للعبة" };

  for (let index = 0; index < 4; index += 1) {
    assert.equal((await service.submit("203.0.113.4", "u_000000000000000000000123", payload)).ok, true);
  }
  assert.deepEqual(
    await service.submit("203.0.113.4", "u_000000000000000000000123", payload),
    { ok: false, code: "RATE_LIMITED" },
  );
  assert.equal(stored, 4);
});

test("Supabase suggestion sink uses secret only as apikey and stores anonymous fields", async () => {
  let requestUrl = "";
  let requestInit: RequestInit | undefined;
  const fakeFetch = (async (input: string | URL | Request, init?: RequestInit) => {
    requestUrl = String(input);
    requestInit = init;
    return new Response(null, { status: 201 });
  }) as typeof fetch;

  const sink = createSupabaseSuggestionSink({
    url: "https://example.supabase.co/",
    secretKey: "sb_secret_test_value",
    fetchImpl: fakeFetch,
  });

  await sink({
    occurredAt: "2026-09-10T07:30:00.000Z",
    category: "bug",
    text: "التصويت وقف عندي مرة",
    deploymentSha: "abc123",
  });

  assert.equal(requestUrl, "https://example.supabase.co/rest/v1/suggestions");
  const headers = new Headers(requestInit?.headers);
  assert.equal(headers.get("apikey"), "sb_secret_test_value");
  assert.equal(headers.get("authorization"), null);
  assert.deepEqual(JSON.parse(String(requestInit?.body)), {
    occurred_at: "2026-09-10T07:30:00.000Z",
    category: "bug",
    message: "التصويت وقف عندي مرة",
    deployment_sha: "abc123",
  });
});
