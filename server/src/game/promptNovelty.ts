import type { PromptNoveltyFilter } from "../../../shared/promptNovelty.js";
import {
  PROMPT_NOVELTY_FILTER_BYTES,
  hasPromptNovelty,
  isPromptNoveltyFilter,
  promptNoveltySlot,
  promptNoveltyTokenForSlot,
  unionPromptNovelty,
} from "../../../shared/promptNovelty.js";

export function promptNoveltyToken(promptId: string): string | undefined {
  const slot = promptNoveltySlot(promptId);
  return slot === undefined ? undefined : promptNoveltyTokenForSlot(slot);
}

export function decodePromptNoveltyFilter(value: PromptNoveltyFilter | undefined): Uint8Array | undefined {
  if (value === undefined) return undefined;
  if (!isPromptNoveltyFilter(value)) return undefined;
  const decoded = Buffer.from(value.bits, "base64url");
  if (decoded.byteLength !== PROMPT_NOVELTY_FILTER_BYTES) return undefined;
  return Uint8Array.from(decoded);
}

export function promptSeenByAny(filters: Iterable<Uint8Array>, promptId: string): boolean {
  const token = promptNoveltyToken(promptId);
  if (token === undefined) return false;
  return hasPromptNovelty(unionPromptNovelty(filters), token);
}
