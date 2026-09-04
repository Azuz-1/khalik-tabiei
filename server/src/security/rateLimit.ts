import type { ClientMessage } from "../../../shared/types.js";
import type { IncomingMessage } from "node:http";
import { isIP } from "node:net";

interface Bucket {
  count: number;
  resetAt: number;
}

export class FixedWindowLimiter {
  private readonly buckets = new Map<string, Bucket>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly maxEntries = 20_000,
    private readonly now: () => number = Date.now,
  ) {}

  allow(key: string): boolean {
    const now = this.now();
    let bucket = this.buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      if (!bucket && this.buckets.size >= this.maxEntries) {
        const oldest = this.buckets.keys().next().value as string | undefined;
        if (oldest) this.buckets.delete(oldest);
      }
      bucket = { count: 0, resetAt: now + this.windowMs };
      this.buckets.set(key, bucket);
    }
    bucket.count += 1;
    return bucket.count <= this.limit;
  }

  cleanup(): void {
    const now = this.now();
    for (const [key, bucket] of this.buckets) {
      if (now >= bucket.resetAt + this.windowMs) this.buckets.delete(key);
    }
  }

  get size(): number {
    return this.buckets.size;
  }
}

const ACTION_LIMITS: Partial<Record<ClientMessage["t"], [number, number]>> = {
  CREATE_ROOM: [3, 60_000],
  JOIN_ROOM: [10, 60_000],
  SET_SETTINGS: [30, 60_000],
  SUBMIT_ANSWER: [10, 60_000],
  // A 10-round game can legitimately ask one player for up to 30 votes.
  // Engine phase/duplicate guards remain authoritative, so this limiter is
  // only an abuse backstop and must never block normal multi-challenge play.
  SUBMIT_VOTE: [40, 60_000],
  NEXT_ROUND: [30, 60_000],
  KICK_PLAYER: [20, 60_000],
};

export class AbuseGuard {
  // Shared Wi-Fi/NAT is the normal deployment shape for this party game.
  // Keep a high coarse per-IP shield, then apply tighter limits per signed
  // anonymous session once a verified uid is available.
  private readonly connectionIp: FixedWindowLimiter;
  private readonly connectionIdentity: FixedWindowLimiter;
  private readonly sessionIp: FixedWindowLimiter;
  private readonly sessionIdentity: FixedWindowLimiter;
  private readonly generic: FixedWindowLimiter;
  private readonly httpFallback: FixedWindowLimiter;
  private readonly actions = new Map<ClientMessage["t"], FixedWindowLimiter>();
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(now: () => number = Date.now) {
    this.connectionIp = new FixedWindowLimiter(300, 60_000, 20_000, now);
    this.connectionIdentity = new FixedWindowLimiter(60, 60_000, 20_000, now);
    this.sessionIp = new FixedWindowLimiter(300, 60_000, 20_000, now);
    this.sessionIdentity = new FixedWindowLimiter(120, 60_000, 20_000, now);
    this.generic = new FixedWindowLimiter(80, 10_000, 20_000, now);
    this.httpFallback = new FixedWindowLimiter(240, 60_000, 20_000, now);
    for (const [type, [limit, windowMs]] of Object.entries(ACTION_LIMITS)) {
      this.actions.set(type as ClientMessage["t"], new FixedWindowLimiter(limit, windowMs, 20_000, now));
    }
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    this.cleanupTimer.unref?.();
  }

  allowConnection(ip: string, identity?: string): boolean {
    if (!this.connectionIp.allow(ip)) return false;
    return identity ? this.connectionIdentity.allow(identity) : true;
  }

  allowSession(ip: string, identity?: string): boolean {
    if (!this.sessionIp.allow(ip)) return false;
    return identity ? this.sessionIdentity.allow(identity) : true;
  }

  allowMessage(identity: string, type?: ClientMessage["t"]): boolean {
    if (!this.generic.allow(identity)) return false;
    const limiter = type ? this.actions.get(type) : undefined;
    return limiter ? limiter.allow(identity) : true;
  }

  allowHttpFallback(ip: string): boolean {
    return this.httpFallback.allow(ip);
  }

  cleanup(): void {
    this.connectionIp.cleanup();
    this.connectionIdentity.cleanup();
    this.sessionIp.cleanup();
    this.sessionIdentity.cleanup();
    this.generic.cleanup();
    this.httpFallback.cleanup();
    for (const limiter of this.actions.values()) limiter.cleanup();
  }

  dispose(): void {
    clearInterval(this.cleanupTimer);
  }
}

export type ClientIpMode = "socket" | "render" | "trusted-proxy";

function validIp(value: string | undefined): string | null {
  const candidate = value?.trim();
  return candidate && candidate.length <= 64 && isIP(candidate) !== 0 ? candidate : null;
}

export function clientIp(
  req: Pick<IncomingMessage, "headers" | "socket">,
  mode: ClientIpMode,
): string {
  if (mode === "render") {
    // Render public web traffic passes through Cloudflare, which overwrites
    // CF-Connecting-IP. Never fall back to caller-prepended XFF on Render.
    const connectingIp = req.headers["cf-connecting-ip"];
    const trusted = Array.isArray(connectingIp) ? null : validIp(connectingIp);
    if (trusted) return trusted;
  } else if (mode === "trusted-proxy") {
    // TRUST_PROXY means exactly one trusted terminating proxy. It appends the
    // directly observed client to XFF, so use the right-most value; a caller's
    // spoofed left-most entries can only make limiting more coarse, not bypass it.
    const forwarded = req.headers["x-forwarded-for"];
    const combined = Array.isArray(forwarded) ? forwarded.join(",") : forwarded;
    const rightMost = combined?.split(",").at(-1);
    const trusted = validIp(rightMost);
    if (trusted) return trusted;
  }
  return req.socket.remoteAddress ?? "unknown";
}
