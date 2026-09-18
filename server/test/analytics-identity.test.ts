import test from "node:test";
import assert from "node:assert/strict";
import {
  analyticsPlayerId,
  analyticsSecretProblem,
} from "../src/analyticsIdentity.js";

const secretA = "analytics-secret-a-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const secretB = "analytics-secret-b-0123456789-ABCDEFGHIJKLMNOPQRSTUVWXYZ";

test("analytics identity v2 is stable only within the same secret domain", () => {
  const uid = "u_peer_visible_example";

  const first = analyticsPlayerId(uid, secretA);
  const second = analyticsPlayerId(uid, secretA);
  const rotated = analyticsPlayerId(uid, secretB);
  const other = analyticsPlayerId("u_other", secretA);

  assert.equal(first, second);
  assert.notEqual(first, rotated);
  assert.notEqual(first, other);
  assert.match(first, /^ap2_[0-9a-f]{32}$/);
  assert.equal(first.includes(uid), false);
});

test("analytics secret validation rejects weak configuration", () => {
  assert.match(String(analyticsSecretProblem(undefined)), /32 bytes/);
  assert.match(String(analyticsSecretProblem("short")), /32 bytes/);
  assert.match(String(analyticsSecretProblem("a".repeat(64))), /diversity/);
  assert.equal(analyticsSecretProblem(secretA), null);
});
