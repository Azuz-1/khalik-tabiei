import { EXPANSION_IMITATION_PROMPTS } from "./imitationPrompts.expansion.js";
import { EXTRA_HANDS_PROMPTS } from "./imitationPrompts.extra.hands.js";
import { EXTRA_NUMBER_PROMPTS } from "./imitationPrompts.extra.number.js";
import { EXTRA_POINT_PROMPTS } from "./imitationPrompts.extra.point.js";

export const EXTRA_IMITATION_PROMPTS = [
  ...EXTRA_HANDS_PROMPTS,
  ...EXTRA_POINT_PROMPTS,
  ...EXTRA_NUMBER_PROMPTS,
  ...EXPANSION_IMITATION_PROMPTS,
];
