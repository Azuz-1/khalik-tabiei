import { test } from "node:test";
import assert from "node:assert/strict";
import type { WebSocket } from "ws";
import {
  ensureAnonymousSession,
  newSessionToken,
  readAnonymousSession,
  sessionSecretProblem,
} from "../src/auth/session.js";
import { readConfig } from "../src/config.js";
import { Connection } from "../src/net/connection.js";
import { isAllowedWebSocketOrigin } from "../src/security/origin.js";
import { parseClientMessage, validateClientMessage } from "../src/security/messages.js";
import { AbuseGuard, FixedWindowLimiter } from "../src/security/rateLimit.js";
import { RoomManager } from "../src/game/roomManager.js";
import { FakeSocket, lastMessage, testUid, wait } from "./helpers.js";

const SECRET = "correct-horse-battery-staple-9X!2026-secure";

test("valid anonymous session is stable and invalid sessions are rejected", () => {
  const headers: Record<string, string> = {};
  const response = { setHeader: (name: string, value: string | number | readonly string[]) => {
    headers[name] = String(value);
  } };
  const created = ensureAnonymousSession({ headers: {} }, response, SECRET, true);
  assert.match(created.uid, /^u_[a-f0-9]{24}$/);
  assert.match(headers["Set-Cookie"], /HttpOnly/);
  assert.match(headers["Set-Cookie"], /Secure/);
  assert.match(headers["Set-Cookie"], /SameSite=Lax/);
  const cookie = headers["Set-Cookie"].split(";")[0];
  const restored = readAnonymousSession({ headers: { cookie } }, SECRET);
  assert.equal(restored?.uid, created.uid);
  assert.equal(readAnonymousSession({ headers: { cookie: "kt_session=bad" } }, SECRET), null);
});

test("production session secret fails closed", () => {
  assert.ok(sessionSecretProblem("short"));
  assert.ok(sessionSecretProblem("a".repeat(64)));
  assert.equal(sessionSecretProblem(SECRET), null);
  assert.throws(
    () => readConfig({ NODE_ENV: "production", SESSION_SECRET: "short", PUBLIC_ORIGIN: "https://good.example" }),
    /SESSION_SECRET/,
  );
  assert.throws(
    () => readConfig({ NODE_ENV: "production", SESSION_SECRET: SECRET, PUBLIC_ORIGIN: "http://good.example" }),
    /https/,
  );
  const config = readConfig({
    NODE_ENV: "production",
    SESSION_SECRET: SECRET,
    PUBLIC_ORIGIN: "https://good.example",
  });
  assert.equal(config.publicOrigin, "https://good.example");
});

test("origin allowlist uses exact scheme, host, and port", () => {
  const allowed = new Set(["https://good.example", "http://localhost:5173"]);
  assert.equal(isAllowedWebSocketOrigin("https://good.example", allowed, true), true);
  for (const origin of [
    "https://evil.example",
    "https://sub.good.example",
    "https://good.example.evil.com",
    "http://good.example",
    "https://good.example:444",
    "https://good.example/path",
  ]) assert.equal(isAllowedWebSocketOrigin(origin, allowed, true), false, origin);
  assert.equal(isAllowedWebSocketOrigin(undefined, allowed, true), false);
  assert.equal(isAllowedWebSocketOrigin(undefined, allowed, false), true);
});

test("strict runtime validation accepts every valid ClientMessage shape", () => {
  const uid = testUid(9);
  const messages = [
    { t: "HELLO" },
    { t: "CREATE_ROOM" },
    { t: "JOIN_ROOM", code: "ABCDE", name: "سلمان" },
    { t: "LEAVE_ROOM" },
    { t: "SET_SETTINGS", totalRounds: 5, categories: ["food"] },
    { t: "START_GAME" },
    { t: "SUBMIT_ANSWER", answer: "قهوة" },
    { t: "START_VOTING" },
    { t: "SUBMIT_VOTE", targetUid: uid },
    { t: "NEXT_ROUND" },
    { t: "KICK_PLAYER", uid },
    { t: "CLOSE_ROOM" },
    { t: "REMATCH" },
    { t: "PING" },
  ];
  for (const message of messages) assert.ok(validateClientMessage(message), JSON.stringify(message));
});

test("malformed and prototype-ish client payloads are rejected without mutation", () => {
  const invalid: unknown[] = [
    null,
    [],
    ["PING"],
    {},
    { t: "UNKNOWN" },
    { t: "JOIN_ROOM", code: "ABCDE" },
    { t: "JOIN_ROOM", code: 12345, name: "سلمان" },
    { t: "SET_SETTINGS", totalRounds: 4 },
    { t: "SET_SETTINGS", categories: ["food", "invalid"] },
    { t: "SET_SETTINGS", categories: Array(20).fill("food") },
    { t: "SUBMIT_ANSWER", answer: "x".repeat(41) },
    { t: "SUBMIT_VOTE", targetUid: "not-a-uid" },
    { t: "PING", nested: { giant: "x".repeat(100) } },
    JSON.parse('{"t":"PING","__proto__":{"polluted":true}}'),
  ];
  for (const value of invalid) assert.equal(validateClientMessage(value), null);
  assert.equal(parseClientMessage(Buffer.from("null"), 8192), null);
  assert.equal(parseClientMessage(Buffer.from("x".repeat(8193)), 8192), null);
});

test("rate limiters are bounded, expire, and enforce action limits", () => {
  let now = 0;
  const limiter = new FixedWindowLimiter(2, 100, 3, () => now);
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), true);
  assert.equal(limiter.allow("a"), false);
  now = 101;
  assert.equal(limiter.allow("a"), true);
  for (const key of ["b", "c", "d", "e"]) limiter.allow(key);
  assert.ok(limiter.size <= 3);

  const abuse = new AbuseGuard(() => now);
  assert.equal(abuse.allowMessage(testUid(1), "CREATE_ROOM"), true);
  assert.equal(abuse.allowMessage(testUid(1), "CREATE_ROOM"), true);
  assert.equal(abuse.allowMessage(testUid(1), "CREATE_ROOM"), true);
  assert.equal(abuse.allowMessage(testUid(1), "CREATE_ROOM"), false);
  abuse.dispose();
});

test("a Connection authenticates once, times out, and protects backpressure", async () => {
  const socket = new FakeSocket();
  const conn = new Connection(socket as unknown as WebSocket, "http://localhost:8080", "127.0.0.1", 10);
  assert.equal(conn.authenticate(testUid(1)), true);
  assert.equal(conn.authenticate(testUid(2)), false);
  socket.bufferedAmount = 11;
  assert.equal(conn.send({ t: "PONG" }), false);
  assert.equal(socket.terminated, true);
  assert.equal(conn.markDisconnected(), true);
  assert.equal(conn.markDisconnected(), false);

  const timeoutSocket = new FakeSocket();
  const timeoutConn = new Connection(timeoutSocket as unknown as WebSocket, "http://localhost:8080", "127.0.0.1");
  timeoutConn.startAuthenticationTimeout(5);
  await wait(15);
  assert.equal(timeoutSocket.closeCalls[0]?.code, 1008);
});

test("unauthenticated actions are rejected", () => {
  const manager = new RoomManager();
  const socket = new FakeSocket();
  const conn = new Connection(socket as unknown as WebSocket, "http://localhost:8080", "127.0.0.1");
  manager.handle(conn, { t: "CREATE_ROOM" });
  assert.equal(lastMessage(socket, "ERROR")?.code, "UNAUTHORIZED");
  manager.dispose();
});

test("session tokens have the required cryptographic wire format", () => {
  assert.match(newSessionToken(), /^[A-Za-z0-9_-]{43}$/);
});
