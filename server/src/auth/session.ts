/** HttpOnly anonymous bearer sessions. No account, email, or password. */
import { createHmac, randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";

export const SESSION_COOKIE = "kt_session";
export const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export interface AnonymousSession {
  token: string;
  uid: string;
}

export function sessionSecretProblem(secret: unknown): string | null {
  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
    return "SESSION_SECRET must contain at least 32 bytes";
  }
  if (/^(change[-_ ]?me|secret|password|example|test)+$/i.test(secret)) {
    return "SESSION_SECRET must not be a placeholder";
  }
  if (new Set(secret).size < 10) {
    return "SESSION_SECRET does not have enough character diversity";
  }
  return null;
}

export function isValidSessionToken(token: unknown): token is string {
  return typeof token === "string" && TOKEN_RE.test(token);
}

export function newSessionToken(): string {
  return randomBytes(32).toString("base64url");
}

export function uidFromSessionToken(token: string, secret: string): string {
  const mac = createHmac("sha256", secret).update(token).digest("hex");
  return `u_${mac.slice(0, 24)}`;
}

function cookieValue(header: string | undefined, name: string): string | null {
  if (!header || header.length > 8 * 1024) return null;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 1) continue;
    if (part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

export function readAnonymousSession(
  req: Pick<IncomingMessage, "headers">,
  secret: string,
): AnonymousSession | null {
  const token = cookieValue(req.headers.cookie, SESSION_COOKIE);
  if (!isValidSessionToken(token)) return null;
  return { token, uid: uidFromSessionToken(token, secret) };
}

export function ensureAnonymousSession(
  req: Pick<IncomingMessage, "headers">,
  res: { setHeader(name: string, value: string): unknown },
  secret: string,
  secure: boolean,
): AnonymousSession {
  const existing = readAnonymousSession(req, secret);
  if (existing) return existing;
  const token = newSessionToken();
  const attributes = [
    `${SESSION_COOKIE}=${token}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${SESSION_MAX_AGE_SECONDS}`,
  ];
  if (secure) attributes.push("Secure");
  res.setHeader("Set-Cookie", attributes.join("; "));
  return { token, uid: uidFromSessionToken(token, secret) };
}
