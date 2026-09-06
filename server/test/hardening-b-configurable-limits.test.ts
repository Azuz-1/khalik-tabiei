import { test } from "node:test";
import assert from "node:assert/strict";
import { readConfig } from "../src/config.js";
import {
  AbuseGuard,
  DEFAULT_ABUSE_LIMITS,
  type AbuseGuardLimits,
} from "../src/security/rateLimit.js";
import { RoomManager } from "../src/game/roomManager.js";
import { createRoom, testUid } from "./helpers.js";

const baseEnv = { SESSION_SECRET: "x".repeat(48) } as NodeJS.ProcessEnv;

function guard(limits: Partial<AbuseGuardLimits>, now: () => number): AbuseGuard {
  return new AbuseGuard({ now, limits });
}

// --- configuration surface ---------------------------------------------------

test("operational limits default to the shipped shared-NAT-safe values", () => {
  const config = readConfig({ ...baseEnv });
  assert.deepEqual(config.abuseLimits, DEFAULT_ABUSE_LIMITS);
  assert.equal(config.requestRetentionMs, 5 * 60 * 1_000);
  assert.equal(config.maxRequestsPerUid, 128);
});

test("every new operational limit is overridable from the environment", () => {
  const config = readConfig({
    ...baseEnv,
    RATE_LIMIT_CONNECTION_IP_LIMIT: "7",
    RATE_LIMIT_CONNECTION_IP_WINDOW_MS: "1000",
    RATE_LIMIT_CONNECTION_IDENTITY_LIMIT: "6",
    RATE_LIMIT_SESSION_IP_LIMIT: "5",
    RATE_LIMIT_SESSION_IDENTITY_LIMIT: "4",
    RATE_LIMIT_ROOM_CREATION_IP_LIMIT: "3",
    RATE_LIMIT_ROOM_CREATION_IDENTITY_LIMIT: "2",
    RATE_LIMIT_MAX_TRACKED_KEYS: "50",
    RATE_LIMIT_CLEANUP_INTERVAL_MS: "1234",
    REQUEST_RETENTION_MS: "9000",
    MAX_REQUESTS_PER_UID: "9",
  });

  assert.deepEqual(config.abuseLimits.connectionIp, { limit: 7, windowMs: 1_000 });
  assert.equal(config.abuseLimits.connectionIdentity.limit, 6);
  assert.equal(config.abuseLimits.sessionIp.limit, 5);
  assert.equal(config.abuseLimits.sessionIdentity.limit, 4);
  assert.equal(config.abuseLimits.roomCreationIp.limit, 3);
  assert.equal(config.abuseLimits.roomCreationIdentity.limit, 2);
  assert.equal(config.abuseLimits.maxTrackedKeys, 50);
  assert.equal(config.abuseLimits.cleanupIntervalMs, 1_234);
  assert.equal(config.requestRetentionMs, 9_000);
  assert.equal(config.maxRequestsPerUid, 9);

  // Windows left unset keep their defaults rather than collapsing to zero.
  assert.equal(config.abuseLimits.sessionIp.windowMs, DEFAULT_ABUSE_LIMITS.sessionIp.windowMs);
});

test("invalid or hostile limit values fall back to defaults instead of disabling the shield", () => {
  const config = readConfig({
    ...baseEnv,
    RATE_LIMIT_CONNECTION_IP_LIMIT: "0",
    RATE_LIMIT_SESSION_IP_LIMIT: "-5",
    RATE_LIMIT_SESSION_IDENTITY_LIMIT: "not-a-number",
    MAX_REQUESTS_PER_UID: "1e999",
  });
  assert.equal(config.abuseLimits.connectionIp.limit, DEFAULT_ABUSE_LIMITS.connectionIp.limit);
  assert.equal(config.abuseLimits.sessionIp.limit, DEFAULT_ABUSE_LIMITS.sessionIp.limit);
  assert.equal(config.abuseLimits.sessionIdentity.limit, DEFAULT_ABUSE_LIMITS.sessionIdentity.limit);
  assert.equal(config.maxRequestsPerUid, 128);
});

// --- injected tiny limits prove the mechanism --------------------------------

test("tiny injected limits enforce their threshold and reset on the next window", () => {
  let now = 0;
  const abuse = guard({ sessionIp: { limit: 2, windowMs: 1_000 } }, () => now);
  try {
    assert.equal(abuse.allowSession("203.0.113.10"), true);
    assert.equal(abuse.allowSession("203.0.113.10"), true);
    assert.equal(abuse.allowSession("203.0.113.10"), false, "third call exceeds the threshold");

    now = 1_001;
    assert.equal(abuse.allowSession("203.0.113.10"), true, "the window resets");
  } finally {
    abuse.dispose();
  }
});

test("identity and IP limits are enforced separately", () => {
  const abuse = guard(
    {
      connectionIp: { limit: 10, windowMs: 60_000 },
      connectionIdentity: { limit: 1, windowMs: 60_000 },
    },
    () => 0,
  );
  try {
    // One identity burns its own tiny quota without touching the roomy IP quota.
    assert.equal(abuse.allowConnection("203.0.113.11", testUid(1)), true);
    assert.equal(abuse.allowConnection("203.0.113.11", testUid(1)), false, "identity quota");
    // A different identity on the SAME IP is unaffected.
    assert.equal(abuse.allowConnection("203.0.113.11", testUid(2)), true, "identity is separate");
  } finally {
    abuse.dispose();
  }

  const ipBound = guard(
    {
      connectionIp: { limit: 1, windowMs: 60_000 },
      connectionIdentity: { limit: 10, windowMs: 60_000 },
    },
    () => 0,
  );
  try {
    assert.equal(ipBound.allowConnection("203.0.113.12", testUid(1)), true);
    // A fresh identity cannot escape an exhausted IP quota.
    assert.equal(ipBound.allowConnection("203.0.113.12", testUid(2)), false, "IP quota still binds");
    // A different IP is unaffected.
    assert.equal(ipBound.allowConnection("198.51.100.9", testUid(3)), true);
  } finally {
    ipBound.dispose();
  }
});

test("room-creation limits are configurable and remain identity-aware", () => {
  const abuse = guard(
    {
      roomCreationIp: { limit: 4, windowMs: 60_000 },
      roomCreationIdentity: { limit: 1, windowMs: 60_000 },
    },
    () => 0,
  );
  try {
    assert.equal(abuse.allowRoomCreation("203.0.113.13", testUid(1)), true);
    assert.equal(abuse.allowRoomCreation("203.0.113.13", testUid(1)), false, "identity quota");
    assert.equal(abuse.allowRoomCreation("203.0.113.13", testUid(2)), true, "next identity is fine");
  } finally {
    abuse.dispose();
  }
});

test("effectiveLimits reports the merged configuration for operational assertions", () => {
  const abuse = guard({ sessionIp: { limit: 11, windowMs: 2_000 } }, () => 0);
  try {
    assert.deepEqual(abuse.effectiveLimits().sessionIp, { limit: 11, windowMs: 2_000 });
    assert.deepEqual(
      abuse.effectiveLimits().connectionIdentity,
      DEFAULT_ABUSE_LIMITS.connectionIdentity,
      "unspecified limits keep their defaults",
    );
  } finally {
    abuse.dispose();
  }
});

// --- the defaults must still fit a real party --------------------------------

test("Host plus ten players on one shared NAT stay allowed under the defaults", () => {
  let now = 0;
  const abuse = new AbuseGuard({ now: () => now, limits: readConfig({ ...baseEnv }).abuseLimits });
  try {
    const ip = "203.0.113.20";
    // Each of the eleven devices fetches a session, opens a socket, then does a
    // reconnect round — the browser overlap a real party actually produces.
    for (let device = 1; device <= 11; device += 1) {
      const uid = testUid(device);
      for (let attempt = 0; attempt < 3; attempt += 1) {
        assert.equal(abuse.allowSession(ip, uid), true, `session device ${device}`);
        assert.equal(abuse.allowConnection(ip, uid), true, `socket device ${device}`);
      }
    }
    // Only the Host creates a room.
    assert.equal(abuse.allowRoomCreation(ip, testUid(1)), true);
  } finally {
    abuse.dispose();
  }
});

// --- request idempotency cache bounds ----------------------------------------

test("the request cache stays bounded by the configured per-uid ceiling", () => {
  const manager = new RoomManager({ now: () => 1_000, maxRequestsPerUid: 8 });
  try {
    const host = createRoom(manager, testUid(1));
    for (let index = 0; index < 50; index += 1) {
      manager.handle(host.conn, { t: "SET_SETTINGS", totalRounds: 3, rid: `r-${index}` });
    }
    assert.equal(
      manager.requestCacheSizeForTests(testUid(1)),
      8,
      "the cache never grows past maxRequestsPerUid",
    );
  } finally {
    manager.dispose();
  }
});

test("expired request ids are reclaimed and a reused id is treated as fresh", () => {
  let now = 1_000;
  const manager = new RoomManager({
    now: () => now,
    requestRetentionMs: 5_000,
    maxRequestsPerUid: 128,
  });
  try {
    const host = createRoom(manager, testUid(1));
    manager.handle(host.conn, { t: "SET_SETTINGS", totalRounds: 3, rid: "r-reuse" });
    assert.equal(manager.requestCacheSizeForTests(testUid(1)), 1);

    // Inside the retention window the id is remembered and replayed from cache.
    const beforeReplay = host.socket.messages.length;
    manager.handle(host.conn, { t: "SET_SETTINGS", totalRounds: 3, rid: "r-reuse" });
    assert.equal(manager.requestCacheSizeForTests(testUid(1)), 1, "no new entry for a replay");
    assert.ok(host.socket.messages.length > beforeReplay, "the cached ACK is re-sent");

    // Past retention the entry is reclaimed by the sweeper.
    now = 6_002;
    manager.runGcForTests();
    assert.equal(manager.requestCacheSizeForTests(testUid(1)), 0, "expired ids are reclaimed");

    // And the same id can then be used again as a genuinely new request.
    manager.handle(host.conn, { t: "SET_SETTINGS", totalRounds: 3, rid: "r-reuse" });
    assert.equal(manager.requestCacheSizeForTests(testUid(1)), 1);
  } finally {
    manager.dispose();
  }
});
