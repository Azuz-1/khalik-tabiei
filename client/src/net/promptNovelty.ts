import type { PromptNoveltyFilter } from "../../../shared/promptNovelty.js";
import {
  PROMPT_NOVELTY_FILTER_BYTES,
  PROMPT_NOVELTY_VERSION,
  addPromptNovelty,
  emptyPromptNoveltyBytes,
  isPromptNoveltyFilter,
} from "../../../shared/promptNovelty.js";

const STORAGE_KEY = "kt_prompt_novelty";

export interface PromptNoveltyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function encode(bytes: Uint8Array): string {
  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]!);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function decode(bits: string): Uint8Array | null {
  try {
    const padded = bits.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (bits.length % 4)) % 4);
    const binary = atob(padded);
    if (binary.length !== PROMPT_NOVELTY_FILTER_BYTES) return null;
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return bytes;
  } catch {
    return null;
  }
}

function emptyFilter(): PromptNoveltyFilter {
  return { version: PROMPT_NOVELTY_VERSION, bits: encode(emptyPromptNoveltyBytes()) };
}

function parseStoredFilter(raw: string | null): PromptNoveltyFilter | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    return isPromptNoveltyFilter(parsed) && decode(parsed.bits) ? parsed : null;
  } catch {
    return null;
  }
}

function load(): PromptNoveltyFilter {
  if (typeof window === "undefined") return emptyFilter();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyFilter();
    const parsed = parseStoredFilter(raw);
    if (!parsed) {
      const fresh = emptyFilter();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
      return fresh;
    }
    return parsed;
  } catch {
    return emptyFilter();
  }
}

export function mergePromptNoveltyFilters(
  ...filters: ReadonlyArray<PromptNoveltyFilter | null | undefined>
): PromptNoveltyFilter {
  const merged = emptyPromptNoveltyBytes();
  for (const filter of filters) {
    if (!filter || !isPromptNoveltyFilter(filter)) continue;
    const bytes = decode(filter.bits);
    if (!bytes) continue;
    for (let index = 0; index < merged.length; index += 1) merged[index] |= bytes[index]!;
  }
  return { version: PROMPT_NOVELTY_VERSION, bits: encode(merged) };
}

/**
 * Merge-before-write makes browser history grow-only across stale tabs. Client
 * history is advisory only; the server remains authoritative for game state.
 */
export function persistPromptNoveltyUpdate(
  storage: PromptNoveltyStorage,
  currentHistory: PromptNoveltyFilter,
  nextHistory: PromptNoveltyFilter,
): PromptNoveltyFilter {
  const latestStored = parseStoredFilter(storage.getItem(STORAGE_KEY));
  const merged = mergePromptNoveltyFilters(latestStored, currentHistory, nextHistory);
  storage.setItem(STORAGE_KEY, JSON.stringify(merged));
  return merged;
}

let current = load();

function persist(next: PromptNoveltyFilter): PromptNoveltyFilter {
  const inMemoryMerged = mergePromptNoveltyFilters(current, next);
  if (typeof window === "undefined") return inMemoryMerged;
  try {
    return persistPromptNoveltyUpdate(window.localStorage, current, next);
  } catch {
    // localStorage can be denied by browser policy. Keep in-memory history and gameplay working.
    return inMemoryMerged;
  }
}

export function currentPromptNoveltyFilter(): PromptNoveltyFilter {
  return current;
}

export function recordPublicPromptNovelty(token: string): boolean {
  const bytes = decode(current.bits);
  if (!bytes) {
    current = emptyFilter();
    return false;
  }
  let changed = false;
  try { changed = addPromptNovelty(bytes, token); }
  catch { return false; }
  if (!changed) return false;
  const next = { version: PROMPT_NOVELTY_VERSION, bits: encode(bytes) } satisfies PromptNoveltyFilter;
  current = persist(next);
  return true;
}

export function resetPromptNoveltyForTests(): void {
  current = emptyFilter();
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); }
  catch { /* test reset is best-effort, like production persistence */ }
}
