import test from "node:test";
import assert from "node:assert/strict";
import {
  analyticsQueueStateForTests,
  flushAnalyticsForTests,
  setAnalyticsSinkForTests,
  track,
  type AnalyticsRecord,
} from "../src/analytics.js";

test("transient analytics failure retries the same logical event id", async () => {
  const attempts: AnalyticsRecord[][] = [];
  let calls = 0;

  setAnalyticsSinkForTests(async (records) => {
    attempts.push(records.map((record) => ({ ...record, props: { ...record.props } })));
    calls += 1;
    if (calls === 1) throw new Error("transient");
  });

  const before = analyticsQueueStateForTests().dropped;
  track("room_created", { roomSessionId: "room-test" });
  await flushAnalyticsForTests();

  assert.equal(calls, 2);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0]?.[0]?.eventId, attempts[1]?.[0]?.eventId);
  assert.match(String(attempts[0]?.[0]?.eventId), /^[0-9a-f-]{36}$/i);
  assert.equal(attempts[0]?.[0]?.schemaVersion, 2);
  assert.equal(attempts[0]?.[0]?.environment, "development");
  assert.equal(analyticsQueueStateForTests().dropped, before);
});
