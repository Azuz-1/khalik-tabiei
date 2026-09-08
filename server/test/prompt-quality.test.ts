import { test } from "node:test";
import assert from "node:assert/strict";
import { choosePromptCandidate } from "../src/game/engine.js";
import { IMITATION_PROMPTS, type ImitationPrompt } from "../src/game/imitationPrompts.data.js";
import { auditActivePrompts } from "../src/game/promptAudit.js";
import { promptQualityWeight } from "../src/game/promptMetadata.js";

test("reviewed prompt risks are explicit and auditable across the active 330 bank", () => {
  const report = auditActivePrompts();
  assert.equal(report.total, 330);
  assert.equal(report.qualityFlagCounts.HIGH_CONSENSUS_RISK, 35);
  assert.equal(report.qualityFlagCounts.CONTEXT_DEPENDENT, 12);
  assert.equal(report.qualityFlagCounts.MEMORY_HEAVY, 7);
  assert.equal(report.qualityFlagCounts.AMBIGUOUS_RESPONSE_RISK, 3);

  for (const id of ["H001", "P001", "P094", "N074"]) {
    assert.ok(report.qualityFlagIds.HIGH_CONSENSUS_RISK.includes(id), `${id} should be high-consensus`);
  }
  for (const id of ["H035", "H043", "H074"]) {
    assert.ok(report.qualityFlagIds.CONTEXT_DEPENDENT.includes(id), `${id} should be context-dependent`);
  }
  for (const id of ["N06", "N006", "N069"]) {
    assert.ok(report.qualityFlagIds.MEMORY_HEAVY.includes(id), `${id} should be memory-heavy`);
  }
  for (const id of ["H075", "N093", "N099"]) {
    assert.ok(report.qualityFlagIds.AMBIGUOUS_RESPONSE_RISK.includes(id), `${id} should be ambiguous`);
  }
});

test("quality penalties are strongest for three-player games without banning any prompt", () => {
  assert.equal(promptQualityWeight(["HIGH_CONSENSUS_RISK"], 3), 0.08);
  assert.equal(promptQualityWeight(["HIGH_CONSENSUS_RISK"], 5), 0.35);
  assert.equal(promptQualityWeight(["HIGH_CONSENSUS_RISK"], 10), 0.65);
  assert.equal(promptQualityWeight(["CONTEXT_DEPENDENT"], 3), 0.2);
  assert.equal(promptQualityWeight(["MEMORY_HEAVY"], 3), 0.3);
  assert.equal(promptQualityWeight(["AMBIGUOUS_RESPONSE_RISK"], 3), 0.15);
  assert.ok(promptQualityWeight(["CONTEXT_DEPENDENT", "AMBIGUOUS_RESPONSE_RISK"], 3) > 0);
});

test("three-player selection materially suppresses high-consensus prompts compared with large groups", () => {
  const risky: ImitationPrompt = {
    id: "risky",
    mode: "POINT",
    text: "risky",
    family: "misc",
    flags: ["HIGH_CONSENSUS_RISK"],
  };
  const safe: ImitationPrompt = {
    id: "safe",
    mode: "POINT",
    text: "safe",
    family: "misc",
  };

  function riskySelections(participantCount: number): number {
    let selected = 0;
    for (let index = 0; index < 1_000; index += 1) {
      const rng = () => (index + 0.5) / 1_000;
      if (choosePromptCandidate([risky, safe], undefined, rng, participantCount).id === "risky") selected += 1;
    }
    return selected;
  }

  const threePlayers = riskySelections(3);
  const tenPlayers = riskySelections(10);
  assert.ok(threePlayers < 100, `expected strong three-player suppression, got ${threePlayers}/1000`);
  assert.ok(tenPlayers > 300, `expected risky prompts to remain available for large groups, got ${tenPlayers}/1000`);
  assert.ok(threePlayers < tenPlayers / 3);
});

test("quality weighting never breaks family spacing or no-alternative fallback", () => {
  const sameFamily: ImitationPrompt = {
    id: "same",
    mode: "HANDS",
    text: "same",
    family: "phone-messaging",
  };
  const riskyOtherFamily: ImitationPrompt = {
    id: "other",
    mode: "HANDS",
    text: "other",
    family: "food-drink",
    flags: ["HIGH_CONSENSUS_RISK"],
  };

  assert.equal(
    choosePromptCandidate([sameFamily, riskyOtherFamily], "phone-messaging", () => 0.99, 3).id,
    "other",
  );
  assert.equal(choosePromptCandidate([riskyOtherFamily], "food-drink", () => 0.5, 3).id, "other");
});

test("all quality flags attach to real active prompts only", () => {
  const ids = new Set(IMITATION_PROMPTS.map((prompt) => prompt.id));
  const report = auditActivePrompts();
  for (const promptIds of Object.values(report.qualityFlagIds)) {
    for (const id of promptIds) assert.ok(ids.has(id), `quality registry references missing prompt ${id}`);
  }
});
