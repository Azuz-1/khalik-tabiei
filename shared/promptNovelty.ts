export const PROMPT_NOVELTY_VERSION = 1 as const;
export const PROMPT_NOVELTY_FILTER_BYTES = 3_072;
export const PROMPT_NOVELTY_FILTER_BITS = PROMPT_NOVELTY_FILTER_BYTES * 8;
export const PROMPT_NOVELTY_HASH_COUNT = 18;
/** 3,072 bytes is divisible by three, so unpadded base64url is exactly 4,096 chars. */
export const PROMPT_NOVELTY_ENCODED_LENGTH = 4_096;
export const PROMPT_NOVELTY_TOKEN_RE = /^[a-f0-9]{32}$/;
const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

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

function tokenWords(token: string): [number, number, number, number] {
  if (!PROMPT_NOVELTY_TOKEN_RE.test(token)) throw new Error("invalid prompt novelty token");
  return [
    Number.parseInt(token.slice(0, 8), 16) >>> 0,
    Number.parseInt(token.slice(8, 16), 16) >>> 0,
    Number.parseInt(token.slice(16, 24), 16) >>> 0,
    Number.parseInt(token.slice(24, 32), 16) >>> 0,
  ];
}

export function promptNoveltyIndexes(token: string): number[] {
  const [a, b, c, d] = tokenWords(token);
  const start = (a ^ c) >>> 0;
  const step = ((b ^ d ^ 0x9e3779b9) | 1) >>> 0;
  const indexes: number[] = [];
  const seen = new Set<number>();
  for (let nonce = 0; indexes.length < PROMPT_NOVELTY_HASH_COUNT; nonce += 1) {
    let mixed = (start + Math.imul(nonce, step) + Math.imul(nonce * nonce, 0x27d4eb2d)) >>> 0;
    mixed ^= mixed >>> 16;
    const bitIndex = mixed % PROMPT_NOVELTY_FILTER_BITS;
    if (seen.has(bitIndex)) continue;
    seen.add(bitIndex);
    indexes.push(bitIndex);
  }
  return indexes;
}

export function addPromptNovelty(bytes: Uint8Array, token: string): boolean {
  if (bytes.byteLength !== PROMPT_NOVELTY_FILTER_BYTES) throw new Error("invalid prompt novelty filter size");
  let changed = false;
  for (const bitIndex of promptNoveltyIndexes(token)) {
    const byteIndex = bitIndex >>> 3;
    const mask = 1 << (bitIndex & 7);
    if ((bytes[byteIndex]! & mask) === 0) {
      bytes[byteIndex] = bytes[byteIndex]! | mask;
      changed = true;
    }
  }
  return changed;
}

export function hasPromptNovelty(bytes: Uint8Array, token: string): boolean {
  if (bytes.byteLength !== PROMPT_NOVELTY_FILTER_BYTES) return false;
  return promptNoveltyIndexes(token).every((bitIndex) => {
    const byteIndex = bitIndex >>> 3;
    const mask = 1 << (bitIndex & 7);
    return (bytes[byteIndex]! & mask) !== 0;
  });
}

export function unionPromptNovelty(filters: Iterable<Uint8Array>): Uint8Array {
  const union = new Uint8Array(PROMPT_NOVELTY_FILTER_BYTES);
  for (const filter of filters) {
    if (filter.byteLength !== PROMPT_NOVELTY_FILTER_BYTES) continue;
    for (let index = 0; index < union.length; index += 1) union[index] |= filter[index]!;
  }
  return union;
}

/** Standard Bloom-filter false-positive probability under independent uniform hashes. */
export function promptNoveltyFalsePositiveProbability(itemCount: number): number {
  const n = Math.max(0, Math.floor(itemCount));
  if (n === 0) return 0;
  const m = PROMPT_NOVELTY_FILTER_BITS;
  const k = PROMPT_NOVELTY_HASH_COUNT;
  return (1 - Math.exp((-k * n) / m)) ** k;
}
