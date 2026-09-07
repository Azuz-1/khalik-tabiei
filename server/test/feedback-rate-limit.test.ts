import test from "node:test";
import assert from "node:assert/strict";
import { AbuseGuard } from "../src/security/rateLimit.js";
import { testUid } from "./helpers.js";

test("feedback submissions have a dedicated per-identity abuse limit", () => {
  let now = 0;
  const guard = new AbuseGuard({ now: () => now });
  const uid = testUid(77);

  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal(guard.allowMessage(uid, "SUBMIT_FEEDBACK"), true);
  }
  assert.equal(guard.allowMessage(uid, "SUBMIT_FEEDBACK"), false);

  now = 60_001;
  assert.equal(guard.allowMessage(uid, "SUBMIT_FEEDBACK"), true);
  guard.dispose();
});