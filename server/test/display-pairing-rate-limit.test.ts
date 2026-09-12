import test from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.js";
import { AbuseGuard, DEFAULT_ABUSE_LIMITS } from "../src/security/rateLimit.js";

const baseEnv = { SESSION_SECRET: "x".repeat(48) } as NodeJS.ProcessEnv;

test("display pairing abuse limits are configurable without weakening shared-NAT defaults", () => {
  const config = readConfig({
    ...baseEnv,
    RATE_LIMIT_DISPLAY_PAIRING_CREATE_IP_LIMIT: "11",
    RATE_LIMIT_DISPLAY_PAIRING_CREATE_IP_WINDOW_MS: "1200",
    RATE_LIMIT_DISPLAY_PAIRING_CLAIM_IP_LIMIT: "12",
    RATE_LIMIT_DISPLAY_PAIRING_CLAIM_IDENTITY_LIMIT: "3",
    RATE_LIMIT_DISPLAY_PAIRING_STATUS_IP_LIMIT: "130",
    RATE_LIMIT_DISPLAY_PAIRING_STATUS_PAIRING_LIMIT: "14",
  });

  assert.deepEqual(config.abuseLimits.displayPairingCreateIp, { limit: 11, windowMs: 1_200 });
  assert.equal(config.abuseLimits.displayPairingClaimIp.limit, 12);
  assert.equal(config.abuseLimits.displayPairingClaimIdentity.limit, 3);
  assert.equal(config.abuseLimits.displayPairingStatusIp.limit, 130);
  assert.equal(config.abuseLimits.displayPairingStatusPairing.limit, 14);
  assert.equal(
    config.abuseLimits.displayPairingClaimIdentity.windowMs,
    DEFAULT_ABUSE_LIMITS.displayPairingClaimIdentity.windowMs,
  );
});

test("pairing claims are tight per owner identity but roomy for another owner on the same NAT", () => {
  const abuse = new AbuseGuard({
    now: () => 0,
    limits: {
      displayPairingClaimIp: { limit: 10, windowMs: 60_000 },
      displayPairingClaimIdentity: { limit: 2, windowMs: 60_000 },
    },
  });
  try {
    assert.equal(abuse.allowDisplayPairingClaim("203.0.113.50", "owner-a"), true);
    assert.equal(abuse.allowDisplayPairingClaim("203.0.113.50", "owner-a"), true);
    assert.equal(abuse.allowDisplayPairingClaim("203.0.113.50", "owner-a"), false);
    assert.equal(abuse.allowDisplayPairingClaim("203.0.113.50", "owner-b"), true);
  } finally {
    abuse.dispose();
  }
});

test("TV creation and high-entropy status polling have separate bounded quotas", () => {
  const abuse = new AbuseGuard({
    now: () => 0,
    limits: {
      displayPairingCreateIp: { limit: 1, windowMs: 60_000 },
      displayPairingStatusIp: { limit: 10, windowMs: 60_000 },
      displayPairingStatusPairing: { limit: 2, windowMs: 60_000 },
    },
  });
  try {
    assert.equal(abuse.allowDisplayPairingCreate("203.0.113.51"), true);
    assert.equal(abuse.allowDisplayPairingCreate("203.0.113.51"), false);
    assert.equal(abuse.allowDisplayPairingStatus("203.0.113.51", "pairing-a"), true);
    assert.equal(abuse.allowDisplayPairingStatus("203.0.113.51", "pairing-a"), true);
    assert.equal(abuse.allowDisplayPairingStatus("203.0.113.51", "pairing-a"), false);
    assert.equal(abuse.allowDisplayPairingStatus("203.0.113.51", "pairing-b"), true);
  } finally {
    abuse.dispose();
  }
});
