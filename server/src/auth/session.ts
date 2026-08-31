/**
 * Anonymous session identity — no accounts, no email, no password.
 *
 * Each browser persists a random secret `clientKey` in localStorage. The
 * server derives a stable, unguessable `uid = HMAC(secret, clientKey)`. The
 * client never sends a uid, so it cannot claim to be someone else: identity is
 * proven by possession of the secret key (a bearer credential), the same
 * principle as a session token. Refresh/reconnect reuses the same key and thus
 * resolves to the same uid, restoring the player's seat.
 *
 * This is the moral equivalent of Firebase Anonymous Auth for a self-contained
 * server: the server, not the client, decides the identity behind a request.
 */
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** Server secret. Set SESSION_SECRET in production; ephemeral otherwise. */
const SECRET =
  process.env.SESSION_SECRET && process.env.SESSION_SECRET.length >= 16
    ? process.env.SESSION_SECRET
    : randomBytes(32).toString("hex");

const CLIENT_KEY_RE = /^[a-f0-9]{32,128}$/;

export function isValidClientKey(key: unknown): key is string {
  return typeof key === "string" && CLIENT_KEY_RE.test(key);
}

/** Derive the server-authoritative uid from a client's secret key. */
export function uidFromClientKey(clientKey: string): string {
  const mac = createHmac("sha256", SECRET).update(clientKey).digest("hex");
  return "u_" + mac.slice(0, 24);
}

/** Generate a fresh client key (used only if a client asks the server for one). */
export function newClientKey(): string {
  return randomBytes(24).toString("hex");
}

/** Constant-time string compare helper (for any future token checks). */
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
