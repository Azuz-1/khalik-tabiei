# Active prompt-bank audit

Stage D treats the imitation bank as the only active gameplay prompt bank. It contains exactly 330 prompts: 110 HANDS, 110 POINT, and 110 NUMBER. The legacy TEXT_PAIR question-pair files remain isolated and are not selectable by the current protocol or UI.

The automated audit normalizes active text with NFKC plus whitespace collapse, then requires unique IDs, no exact normalized duplicate text, the exact 330/110-per-mode counts, and topic-family metadata for every prompt. It also reports prompts still marked `HIGH_CONSENSUS_RISK`; that flag is a human-review signal, not a claim that gameplay quality can be proven mechanically.

## Topic families and spacing

Active prompts receive one best-effort family such as phone/messaging, sleep/energy, food/drink, travel/driving, shopping, home/routine, media, weather/outdoors, sports/games, social gatherings, planning/time, personality/decisions, or miscellaneous. When a new challenge has multiple unused same-mode candidates, the picker prefers a family different from the immediately previous prompt. If only the previous family remains, it falls back to those unused candidates.

Family spacing never overrides the stronger exact no-repeat rule. `usedPromptIds` remains game-scoped; a mode bank resets only after all 110 prompts for that mode are exhausted. A rematch starts a new game and clears prompt history exactly as before.

## Explicit wording edits

Two base POINT prompts remain flagged for high-consensus review but were changed from absolute/person-known wording to more situational wording:

- P06: `أشر على اللي ممكن يوصل آخر واحد للموعد.` → `أشر على اللي لو تغيّر موعد الطلعة قبلها بساعة غالبًا يحتاج أكثر وقت يعيد ترتيب نفسه.`
- P09: `أشر على اللي دايم معه شاحن.` → `أشر على اللي لو بطارية واحد فيكم صارت 5٪ غالبًا بيكون عنده حل أو شاحن.`

These edits reduce obvious fixed-person answers; they do not assert that the prompts are universally balanced or fun for every group.
