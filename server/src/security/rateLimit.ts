import type { ClientMessage } from "../../../shared/types.js";
import type { IncomingMessage } from "node:http";

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
  SUBMIT_ANSWER: [5, 60_000],
  SUBMIT_VOTE: [5, 60_000],
  NEXT_ROUND: [10, 60_000],
  KICK_PLAYER: [20, 60_000],
};

export class AbuseGuard {
  private readonly connection: FixedWindowLimiter;
  private readonly session: FixedWindowLimiter;
  private readonly generic: FixedWindowLimiter;
  private readonly actions = new Map<ClientMessage["t"], FixedWindowLimiter>();
  private readonly cleanupTimer: NodeJS.Timeout;

  constructor(now: () => number = Date.now) {
    this.connection = new FixedWindowLimiter(30, 60_000, 20_000, now);
    this.session = new FixedWindowLimiter(60, 60_000, 20_000, now);
    this.generic = new FixedWindowLimiter(80, 10_000, 20_000, now);
    for (const [type, [limit, windowMs]] of Object.entries(ACTION_LIMITS)) {
      this.actions.set(type as ClientMessage["t"], new FixedWindowLimiter(limit, windowMs, 20_000, now));
    }
    this.cleanupTimer = setInterval(() => this.cleanup(), 60_000);
    this.cleanupTimer.unref?.();
  }

  allowConnection(ip: string): boolean {
    return this.connection.allow(ip);
  }

  allowSession(ip: string): boolean {
    return this.session.allow(ip);
  }

  allowMessage(identity: string, type?: ClientMessage["t"]): boolean {
    if (!this.generic.allow(identity)) return false;
    const limiter = type ? this.actions.get(type) : undefined;
    return limiter ? limiter.allow(identity) : true;
  }

  cleanup(): void {
    this.connection.cleanup();
    this.session.cleanup();
    this.generic.cleanup();
    for (const limiter of this.actions.values()) limiter.cleanup();
  }

  dispose(): void {
    clearInterval(this.cleanupTimer);
  }
}

export function clientIp(req: Pick<IncomingMessage, "headers" | "socket">, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = req.headers["x-forwarded-for"];
    const first = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(",")[0]?.trim();
    if (first && first.length <= 64 && /^[a-f0-9:.]+$/i.test(first)) return first;
  }
  return req.socket.remoteAddress ?? "unknown";
}
