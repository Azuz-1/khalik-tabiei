import { randomBytes } from "node:crypto";
import { sessionSecretProblem } from "./auth/session.js";
import { canonicalOrigin } from "./security/origin.js";

function positiveInteger(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function renderOrigin(env: NodeJS.ProcessEnv): string | null {
  const hostname = env.RENDER_EXTERNAL_HOSTNAME;
  if (!hostname || !/^[a-z0-9.-]+$/i.test(hostname)) return null;
  return canonicalOrigin(`https://${hostname}`);
}

export function readConfig(env: NodeJS.ProcessEnv = process.env) {
  const production = env.NODE_ENV === "production";
  let sessionSecret = env.SESSION_SECRET ?? "";
  const secretProblem = sessionSecretProblem(sessionSecret);
  if (secretProblem) {
    if (production) throw new Error(`Configuration error: ${secretProblem}`);
    sessionSecret = randomBytes(32).toString("base64url");
    console.warn("SESSION_SECRET is missing/weak; using an ephemeral development secret.");
  }

  const configuredOrigin = env.PUBLIC_ORIGIN ? canonicalOrigin(env.PUBLIC_ORIGIN) : renderOrigin(env);
  if (env.PUBLIC_ORIGIN && !configuredOrigin) throw new Error("Configuration error: PUBLIC_ORIGIN must be an exact http(s) origin");
  if (production && !configuredOrigin) throw new Error("Configuration error: PUBLIC_ORIGIN is required in production");
  if (production && configuredOrigin && !configuredOrigin.startsWith("https://")) throw new Error("Configuration error: PUBLIC_ORIGIN must use https in production");

  const allowedOrigins = new Set<string>();
  if (configuredOrigin) allowedOrigins.add(configuredOrigin);
  for (const item of (env.ALLOWED_ORIGINS ?? "").split(",")) {
    if (!item.trim()) continue;
    const origin = canonicalOrigin(item.trim());
    if (!origin) throw new Error("Configuration error: invalid ALLOWED_ORIGINS entry");
    if (production && !origin.startsWith("https://")) throw new Error("Configuration error: production ALLOWED_ORIGINS must use https");
    allowedOrigins.add(origin);
  }
  if (!production) {
    for (const origin of ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:8080", "http://127.0.0.1:8080"]) allowedOrigins.add(origin);
  }

  return {
    production,
    port: positiveInteger(env.PORT, 8080),
    host: env.HOST ?? "0.0.0.0",
    publicOrigin: configuredOrigin,
    allowedOrigins,
    sessionSecret,
    clientIpMode: env.RENDER === "true" ? "render" : env.TRUST_PROXY === "true" ? "trusted-proxy" : "socket",
    maxMessageBytes: positiveInteger(env.MAX_MESSAGE_BYTES, 8 * 1024),
    maxBufferedBytes: positiveInteger(env.MAX_BUFFERED_BYTES, 512 * 1024),
    heartbeatMs: positiveInteger(env.HEARTBEAT_MS, 30_000),
    authTimeoutMs: positiveInteger(env.AUTH_TIMEOUT_MS, 8_000),
    emptyLobbyExpiryMs: positiveInteger(env.EMPTY_LOBBY_EXPIRY_MS, 20 * 60 * 1_000),
    // At least Host + ten phones behind one NAT, with generous reconnect overlap.
    maxConcurrentSocketsPerIp: positiveInteger(env.MAX_SOCKETS_PER_IP, 64),
    maxConcurrentSockets: positiveInteger(env.MAX_SOCKETS, 4_000),
  } as const;
}

export const config = readConfig();
