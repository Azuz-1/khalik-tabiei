/**
 * Question service. Owns all curated content and hands out pairs to rounds.
 *
 * Content is curated and stored (no AI generation at runtime, per spec). To
 * add a pack, import it and spread it into ALL_PAIRS — nothing else changes.
 */
import type { CategoryId } from "../../../shared/types.js";
import { CORE_PACK, type QuestionPair } from "./questions.data.js";

const ALL_PAIRS: QuestionPair[] = [...CORE_PACK];

// Fail fast on duplicate ids — a common content-authoring mistake.
(() => {
  const seen = new Set<string>();
  for (const p of ALL_PAIRS) {
    if (seen.has(p.id)) throw new Error(`Duplicate question id: ${p.id}`);
    seen.add(p.id);
  }
})();

export function totalPairs(): number {
  return ALL_PAIRS.length;
}

export function pairsForCategories(categories: CategoryId[]): QuestionPair[] {
  if (categories.length === 0) return [];
  const set = new Set(categories);
  return ALL_PAIRS.filter((p) => set.has(p.category));
}

/**
 * Pick a pair for the next round, avoiding reuse of ids in `usedIds` until the
 * selected categories are exhausted, at which point reuse is allowed again.
 * Selection is server-side only; clients never influence it.
 */
export function pickPair(
  categories: CategoryId[],
  usedIds: Set<string>,
  rng: () => number = Math.random,
): QuestionPair {
  const pool = pairsForCategories(categories);
  if (pool.length === 0) {
    // Defensive: should be prevented by settings validation.
    throw new Error("No questions available for selected categories");
  }
  const fresh = pool.filter((p) => !usedIds.has(p.id));
  const candidates = fresh.length > 0 ? fresh : pool;
  const idx = Math.floor(rng() * candidates.length);
  return candidates[Math.min(idx, candidates.length - 1)];
}
