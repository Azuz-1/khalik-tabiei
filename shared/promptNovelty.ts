export const PROMPT_NOVELTY_VERSION = 2 as const;

/** Reserved slots per mode. 300 are used today; the tail is future append room. */
export const PROMPT_NOVELTY_SLOTS_PER_MODE = 512;
export const PROMPT_NOVELTY_FILTER_BITS = PROMPT_NOVELTY_SLOTS_PER_MODE * 3;
export const PROMPT_NOVELTY_FILTER_BYTES = PROMPT_NOVELTY_FILTER_BITS / 8;
/** 192 bytes is divisible by three, so unpadded base64url is exactly 256 chars. */
export const PROMPT_NOVELTY_ENCODED_LENGTH = 256;
/** A wire token is just the opaque zero-padded hex history slot. */
export const PROMPT_NOVELTY_TOKEN_RE = /^[a-f0-9]{4}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;
const PROMPT_ID_RE = /^([HPN])(\d{2,3})$/;

const MODE_SLOT_BASE: Record<string, number> = {
  H: 0 * PROMPT_NOVELTY_SLOTS_PER_MODE,
  P: 1 * PROMPT_NOVELTY_SLOTS_PER_MODE,
  N: 2 * PROMPT_NOVELTY_SLOTS_PER_MODE,
};

/** Base bank ids are two digits (H01..H10); every later id is three (H001..). */
const BASE_BANK_SIZE = 10;

export interface PromptNoveltyFilter {
  version: typeof PROMPT_NOVELTY_VERSION;
  bits: string;
}

export function isPromptNoveltyFilter(value: unknown): value is PromptNoveltyFilter {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return Object.keys(candidate).length === 2 &&
    candidate.version === PROMPT_NOVELTY_VERSION &&
    typeof candidate.bits === "string" &&
    candidate.bits.length === PROMPT_NOVELTY_ENCODED_LENGTH &&
    BASE64URL_RE.test(candidate.bits);
}

export function emptyPromptNoveltyBytes(): Uint8Array {
  return new Uint8Array(PROMPT_NOVELTY_FILTER_BYTES);
}

/**
 * Immutable slot for a prompt id. Pure function of the id, so it is stable across
 * releases and independent of array order. Returns undefined for ids that do not
 * fit the scheme rather than throwing, so gameplay degrades instead of failing.
 */
export function promptNoveltySlot(promptId: string): number | undefined {
  const match = PROMPT_ID_RE.exec(promptId);
  if (!match) return undefined;
  const base = MODE_SLOT_BASE[match[1]!];
  if (base === undefined) return undefined;
  const ordinal = Number.parseInt(match[2]!, 10);
  if (!Number.isInteger(ordinal) || ordinal < 1) return undefined;
  const offset = match[2]!.length === 2 ? ordinal - 1 : BASE_BANK_SIZE + ordinal - 1;
  if (offset < 0 || offset >= PROMPT_NOVELTY_SLOTS_PER_MODE) return undefined;
  return base + offset;
}

function slotFromToken(token: string): number | undefined {
  if (!PROMPT_NOVELTY_TOKEN_RE.test(token)) return undefined;
  const slot = Number.parseInt(token, 16);
  return slot >= 0 && slot < PROMPT_NOVELTY_FILTER_BITS ? slot : undefined;
}

export function promptNoveltyTokenForSlot(slot: number): string {
  return slot.toString(16).padStart(4, "0");
}

export function addPromptNovelty(bytes: Uint8Array, token: string): boolean {
  if (bytes.byteLength !== PROMPT_NOVELTY_FILTER_BYTES) throw new Error("invalid prompt novelty filter size");
  const slot = slotFromToken(token);
  if (slot === undefined) return false;
  const byteIndex = slot >>> 3;
  const mask = 1 << (slot & 7);
  if ((bytes[byteIndex]! & mask) !== 0) return false;
  bytes[byteIndex] = bytes[byteIndex]! | mask;
  return true;
}

export function hasPromptNovelty(bytes: Uint8Array, token: string): boolean {
  if (bytes.byteLength !== PROMPT_NOVELTY_FILTER_BYTES) return false;
  const slot = slotFromToken(token);
  if (slot === undefined) return false;
  return (bytes[slot >>> 3]! & (1 << (slot & 7))) !== 0;
}

export function unionPromptNovelty(filters: Iterable<Uint8Array>): Uint8Array {
  const union = emptyPromptNoveltyBytes();
  for (const filter of filters) {
    if (filter.byteLength !== PROMPT_NOVELTY_FILTER_BYTES) continue;
    for (let index = 0; index < union.length; index += 1) union[index] |= filter[index]!;
  }
  return union;
}
