import {
  createHash,
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";

export const DISPLAY_PAIRING_TTL_MS = 5 * 60_000;
export const DISPLAY_PAIRING_CODE_DIGITS = 6;
export const DEFAULT_MAX_ACTIVE_DISPLAY_PAIRINGS = 5_000;
const DISPLAY_PAIRING_CODE_SPACE = 10 ** DISPLAY_PAIRING_CODE_DIGITS;
const MAX_CODE_GENERATION_ATTEMPTS = 32;

export interface DisplayPairingBinding {
  roomCode: string;
  roomCreatedAt: number;
  hostUid: string;
  displayEpoch: number;
}

interface StoredDisplayPairing {
  id: string;
  code: string;
  secretDigest: Buffer;
  createdAt: number;
  expiresAt: number;
  binding?: DisplayPairingBinding;
}

export interface CreatedDisplayPairing {
  id: string;
  code: string;
  secret: string;
  expiresAt: number;
}

export type DisplayPairingRead =
  | { status: "pending"; expiresAt: number }
  | { status: "claimed"; expiresAt: number; binding: DisplayPairingBinding };

export interface DisplayPairingRegistryOptions {
  now?: () => number;
  ttlMs?: number;
  maxActive?: number;
  randomCode?: () => number;
  createId?: () => string;
  createSecret?: () => string;
}

function digestSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

function sameBinding(left: DisplayPairingBinding, right: DisplayPairingBinding): boolean {
  return left.roomCode === right.roomCode
    && left.roomCreatedAt === right.roomCreatedAt
    && left.hostUid === right.hostUid
    && left.displayEpoch === right.displayEpoch;
}

export function normalizeDisplayPairingCode(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const compact = value.replace(/[\s-]/gu, "");
  return /^[0-9]{6}$/u.test(compact) ? compact : null;
}

export class DisplayPairingRegistry {
  private readonly byId = new Map<string, StoredDisplayPairing>();
  private readonly idByCode = new Map<string, string>();
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly maxActive: number;
  private readonly randomCode: () => number;
  private readonly createId: () => string;
  private readonly createSecret: () => string;

  constructor(options: DisplayPairingRegistryOptions = {}) {
    this.now = options.now ?? Date.now;
    this.ttlMs = options.ttlMs ?? DISPLAY_PAIRING_TTL_MS;
    this.maxActive = options.maxActive ?? DEFAULT_MAX_ACTIVE_DISPLAY_PAIRINGS;
    this.randomCode = options.randomCode ?? (() => randomInt(0, DISPLAY_PAIRING_CODE_SPACE));
    this.createId = options.createId ?? (() => randomUUID());
    this.createSecret = options.createSecret ?? (() => randomBytes(32).toString("base64url"));
  }

  private deleteRecord(record: StoredDisplayPairing): void {
    this.byId.delete(record.id);
    if (this.idByCode.get(record.code) === record.id) this.idByCode.delete(record.code);
  }

  cleanupExpired(): void {
    const now = this.now();
    for (const record of this.byId.values()) {
      if (now >= record.expiresAt) this.deleteRecord(record);
    }
  }

  create(): CreatedDisplayPairing {
    this.cleanupExpired();
    if (this.byId.size >= this.maxActive) throw new Error("display pairing capacity reached");

    for (let attempt = 0; attempt < MAX_CODE_GENERATION_ATTEMPTS; attempt += 1) {
      const codeValue = this.randomCode();
      if (!Number.isSafeInteger(codeValue) || codeValue < 0 || codeValue >= DISPLAY_PAIRING_CODE_SPACE) {
        throw new Error("invalid display pairing code generator");
      }
      const code = String(codeValue).padStart(DISPLAY_PAIRING_CODE_DIGITS, "0");
      if (this.idByCode.has(code)) continue;

      const id = this.createId();
      if (!id || id.length > 128 || this.byId.has(id)) continue;
      const secret = this.createSecret();
      if (!secret || secret.length < 16 || secret.length > 256) {
        throw new Error("invalid display pairing secret generator");
      }

      const createdAt = this.now();
      const record: StoredDisplayPairing = {
        id,
        code,
        secretDigest: digestSecret(secret),
        createdAt,
        expiresAt: createdAt + this.ttlMs,
      };
      this.byId.set(id, record);
      this.idByCode.set(code, id);
      return { id, code, secret, expiresAt: record.expiresAt };
    }

    throw new Error("unable to allocate display pairing code");
  }

  read(id: string, secret: string): DisplayPairingRead | null {
    this.cleanupExpired();
    const record = this.byId.get(id);
    if (!record || typeof secret !== "string") return null;
    const candidate = digestSecret(secret);
    if (candidate.length !== record.secretDigest.length || !timingSafeEqual(candidate, record.secretDigest)) {
      return null;
    }
    if (!record.binding) return { status: "pending", expiresAt: record.expiresAt };
    return {
      status: "claimed",
      expiresAt: record.expiresAt,
      binding: { ...record.binding },
    };
  }

  claim(rawCode: unknown, binding: DisplayPairingBinding): boolean {
    this.cleanupExpired();
    const code = normalizeDisplayPairingCode(rawCode);
    if (!code) return false;
    const id = this.idByCode.get(code);
    if (!id) return false;
    const record = this.byId.get(id);
    if (!record) {
      this.idByCode.delete(code);
      return false;
    }
    if (record.binding) return sameBinding(record.binding, binding);
    record.binding = { ...binding };
    return true;
  }

  clear(): void {
    this.byId.clear();
    this.idByCode.clear();
  }

  get size(): number {
    this.cleanupExpired();
    return this.byId.size;
  }
}
