import { createHash } from "node:crypto";
import type { PromptNoveltyFilter } from "../../../shared/promptNovelty.js";
import {
  PROMPT_NOVELTY_FILTER_BYTES,
  PROMPT_NOVELTY_VERSION,
  hasPromptNovelty,
  isPromptNoveltyFilter,
  unionPromptNovelty,
} from "../../../shared/promptNovelty.js";

const TOKEN_PREFIX = `khalik-prompt-novelty:v${PROMPT_NOVELTY_VERSION}:`;

/** Stable per-prompt token. It is serialized only after the prompt is already public. */
export function promptNoveltyToken(promptId: string): string {
  return createHash("sha256").update(`${TOKEN_PREFIX}${promptId}`).digest("hex").slice(0, 32);
}

export function decodePromptNoveltyFilter(value: PromptNoveltyFilter | undefined): Uint8Array | undefined {
  if (value === undefined) return undefined;
  if (!isPromptNoveltyFilter(value)) return undefined;
  const decoded = Buffer.from(value.bits, "base64url");
  if (decoded.byteLength !== PROMPT_NOVELTY_FILTER_BYTES) return undefined;
  return Uint8Array.from(decoded);
}

export function promptProbablySeen(
  filters: Iterable<Uint8Array>,
  promptId: string,
): boolean {
  return hasPromptNovelty(unionPromptNovelty(filters), promptNoveltyToken(promptId));
}
