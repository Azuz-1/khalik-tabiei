import type { PromptNoveltyFilter } from "../../../shared/promptNovelty.js";
import {
  PROMPT_NOVELTY_FILTER_BYTES,
  PROMPT_NOVELTY_VERSION,
  addPromptNovelty,
  isPromptNoveltyFilter,
} from "../../../shared/promptNovelty.js";

const STORAGE_KEY = "kt_prompt_novelty";

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
  return { version: PROMPT_NOVELTY_VERSION, bits: encode(new Uint8Array(PROMPT_NOVELTY_FILTER_BYTES)) };
}

function load(): PromptNoveltyFilter {
  if (typeof window === "undefined") return emptyFilter();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyFilter();
    const parsed: unknown = JSON.parse(raw);
    if (!isPromptNoveltyFilter(parsed) || !decode(parsed.bits)) {
      const fresh = emptyFilter();
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
      return fresh;
    }
    return parsed;
  } catch {
    return emptyFilter();
  }
}

let current = load();

function persist(): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); }
  catch { /* local history is best-effort; gameplay must still work */ }
}

export function currentPromptNoveltyFilter(): PromptNoveltyFilter {
  return current;
}

/** Called only when a STATE actually exposes the public prompt to this browser. */
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
  current = { version: PROMPT_NOVELTY_VERSION, bits: encode(bytes) };
  persist();
  return true;
}

export function resetPromptNoveltyForTests(): void {
  current = emptyFilter();
  persist();
}
