import type { GameMode } from "../../../shared/types.js";
import { IMITATION_PROMPTS } from "./imitationPrompts.data.js";
import { normalizePromptText, type PromptFamily } from "./promptMetadata.js";

export interface PromptAuditReport {
  total: number;
  byMode: Record<GameMode, number>;
  duplicateIds: string[];
  duplicateTexts: Array<{ normalizedText: string; ids: string[] }>;
  familyCounts: Record<string, number>;
  highConsensusIds: string[];
  missingFamilyIds: string[];
}

export function auditActivePrompts(): PromptAuditReport {
  const byMode: Record<GameMode, number> = { HANDS: 0, POINT: 0, NUMBER: 0 };
  const ids = new Map<string, number>();
  const texts = new Map<string, string[]>();
  const familyCounts: Record<string, number> = {};
  const highConsensusIds: string[] = [];
  const missingFamilyIds: string[] = [];

  for (const prompt of IMITATION_PROMPTS) {
    byMode[prompt.mode] += 1;
    ids.set(prompt.id, (ids.get(prompt.id) ?? 0) + 1);
    const normalizedText = normalizePromptText(prompt.text);
    const textIds = texts.get(normalizedText) ?? [];
    textIds.push(prompt.id);
    texts.set(normalizedText, textIds);
    if (prompt.family) familyCounts[prompt.family] = (familyCounts[prompt.family] ?? 0) + 1;
    else missingFamilyIds.push(prompt.id);
    if (prompt.flags?.includes("HIGH_CONSENSUS_RISK")) highConsensusIds.push(prompt.id);
  }

  return {
    total: IMITATION_PROMPTS.length,
    byMode,
    duplicateIds: [...ids].filter(([, count]) => count > 1).map(([id]) => id),
    duplicateTexts: [...texts]
      .filter(([, promptIds]) => promptIds.length > 1)
      .map(([normalizedText, promptIds]) => ({ normalizedText, ids: promptIds })),
    familyCounts,
    highConsensusIds,
    missingFamilyIds,
  };
}

export function assertActivePromptBank(report = auditActivePrompts()): PromptAuditReport {
  const expectedByMode: Record<GameMode, number> = { HANDS: 110, POINT: 110, NUMBER: 110 };
  if (report.total !== 330) throw new Error(`Active prompt bank must contain exactly 330 prompts; found ${report.total}`);
  for (const mode of Object.keys(expectedByMode) as GameMode[]) {
    if (report.byMode[mode] !== expectedByMode[mode]) {
      throw new Error(`Active ${mode} prompt bank must contain exactly ${expectedByMode[mode]}; found ${report.byMode[mode]}`);
    }
  }
  if (report.duplicateIds.length) throw new Error(`Duplicate active prompt ids: ${report.duplicateIds.join(", ")}`);
  if (report.duplicateTexts.length) {
    throw new Error(`Duplicate active prompt text: ${report.duplicateTexts.map((entry) => entry.ids.join("/")).join(", ")}`);
  }
  if (report.missingFamilyIds.length) throw new Error(`Active prompts missing topic family: ${report.missingFamilyIds.join(", ")}`);
  return report;
}

export function promptFamilyOf(id: string): PromptFamily | undefined {
  return IMITATION_PROMPTS.find((prompt) => prompt.id === id)?.family;
}
