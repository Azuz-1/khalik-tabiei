import { test } from "node:test";
import assert from "node:assert/strict";
import { IMITATION_PROMPTS } from "../src/game/imitationPrompts.data.js";
import { promptQualityWeight } from "../src/game/promptMetadata.js";

test("flagged production prompts keep positive selection weight for every supported group size", () => {
  const flagged = IMITATION_PROMPTS.filter((prompt) => prompt.flags?.length);
  assert.ok(flagged.length > 0);

  for (const participantCount of [3, 4, 5, 6, 10]) {
    for (const prompt of flagged) {
      const weight = promptQualityWeight(prompt.flags, participantCount);
      assert.ok(weight > 0 && weight <= 1, `${prompt.id} invalid weight ${weight} for ${participantCount}`);
    }
  }
});
