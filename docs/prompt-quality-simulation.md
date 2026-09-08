# Prompt quality simulation scope

This pass turns the earlier 10-person UX/content simulation into explicit, testable prompt metadata without pretending that synthetic users can prove fun or fairness.

The review covered the active 330-prompt imitation bank (110 HANDS, 110 POINT, 110 NUMBER) using a mixed group model spanning teenagers through adults, different familiarity with games, different social habits, and both small and large party sizes.

The implementation deliberately focuses on repeatable risk signals that can be acted on safely by the picker:

- likely high-consensus answers
- context dependence (for example driving or a narrow platform/social setting)
- unusually heavy recall burden
- ambiguous response interpretation

The selection policy is group-size-aware. Exactly three players receive the strongest quality weighting because a single incompatible action among three visible actions can expose the impostor immediately. Larger groups retain more of the full bank's variety.

This is not a permanent verdict on the flagged prompts. Real post-game feedback and human playtests can later promote, rewrite, or clear individual flags without changing game protocol or scoring.
