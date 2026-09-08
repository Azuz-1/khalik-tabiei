# Active prompt-bank audit

The imitation bank is the only active gameplay prompt bank. It contains exactly 330 prompts: 110 HANDS, 110 POINT, and 110 NUMBER. The legacy TEXT_PAIR question-pair files remain isolated and are not selectable by the current protocol or UI.

The automated audit normalizes active text with NFKC plus whitespace collapse, then requires unique IDs, no exact normalized duplicate text, the exact 330/110-per-mode counts, and topic-family metadata for every prompt.

## Topic families and spacing

Active prompts receive one best-effort family such as phone/messaging, sleep/energy, food/drink, travel/driving, shopping, home/routine, media, weather/outdoors, sports/games, social gatherings, planning/time, personality/decisions, or miscellaneous. When a new challenge has multiple unused same-mode candidates, the picker prefers a family different from the immediately previous prompt. If only the previous family remains, it falls back to those unused candidates.

Family spacing never overrides the stronger exact no-repeat rule. `usedPromptIds` remains game-scoped; a mode bank resets only after all 110 prompts for that mode are exhausted. A rematch starts a new game and clears prompt history exactly as before.

## Quality-risk metadata

The post-launch UX simulation reviewed all 330 active prompts and records four human-review risk signals:

- `HIGH_CONSENSUS_RISK`: the group may converge on the same obvious answer, making the impostor easier to expose.
- `CONTEXT_DEPENDENT`: the prompt depends more strongly on context such as driving, a specific platform, or a particular social setting.
- `MEMORY_HEAVY`: the prompt asks for recall that may be unnecessarily difficult in a quick party game.
- `AMBIGUOUS_RESPONSE_RISK`: reasonable players may interpret the response rule differently.

These flags do not delete or ban prompts. They are explicit content metadata and remain auditable by ID.

## Group-size-aware selection

After the existing no-repeat and topic-family spacing rules are applied, the picker uses quality-weighted random selection. Every prompt always keeps a positive probability of being selected, but flagged prompts are less likely than unflagged prompts.

The penalty is deliberately strongest with exactly three players because one unusually obvious answer can expose the impostor immediately when only three actions are visible. The penalty becomes lighter as the group grows, so the full bank remains varied for larger parties.

For example, a prompt marked only `HIGH_CONSENSUS_RISK` keeps relative weight:

- 3 players: `0.08`
- 4–5 players: `0.35`
- 6–10 players: `0.65`

An unflagged prompt has weight `1`. Multiple independent risk flags multiply, while a minimum positive weight guarantees the picker can still fall back to any remaining prompt when the bank is close to exhaustion.

## Existing wording edits

Two base POINT prompts were previously changed from absolute/person-known wording to more situational wording and remain explicitly flagged:

- P06: `أشر على اللي ممكن يوصل آخر واحد للموعد.` → `أشر على اللي لو تغيّر موعد الطلعة قبلها بساعة غالبًا يحتاج أكثر وقت يعيد ترتيب نفسه.`
- P09: `أشر على اللي دايم معه شاحن.` → `أشر على اللي لو بطارية واحد فيكم صارت 5٪ غالبًا بيكون عنده حل أو شاحن.`

The quality flags are not a claim that gameplay quality can be proven mechanically. They make known review findings actionable in the picker while preserving human content review as the source of truth.
