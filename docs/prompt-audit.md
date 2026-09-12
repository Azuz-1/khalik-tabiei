# Active prompt-bank audit

The imitation bank is the only active gameplay prompt bank. It contains exactly 900 prompts: 300 HANDS, 300 POINT, and 300 NUMBER. The legacy TEXT_PAIR question-pair files remain isolated and are not selectable by the current protocol or UI.

The automated audit normalizes active text with NFKC plus whitespace collapse, then requires unique IDs, no exact normalized duplicate text, the exact 900/300-per-mode counts, and topic-family metadata for every prompt.

## Topic families and spacing

Active prompts receive one best-effort family such as phone/messaging, sleep/energy, food/drink, travel/driving, shopping, home/routine, media, weather/outdoors, sports/games, social gatherings, planning/time, personality/decisions, or miscellaneous. When a new challenge has multiple unused same-mode candidates, the picker prefers a family different from the immediately previous prompt. If only the previous family remains, it falls back to those unused candidates.

Family spacing never overrides the stronger exact no-repeat rule. `usedPromptIds` is authoritative and room-session scoped: it survives rematches, selected-mode changes, and roster changes while the room exists. A prompt is not reused while another unused prompt exists for that mode. Only when all 300 prompts in one mode have been consumed are that mode's IDs removed from `usedPromptIds`; other modes keep their history. A brand-new room starts with an empty exact history.

## Cross-room novelty history

Participant browsers also keep a versioned 3 KiB Bloom filter in local site storage. A prompt is added only after that browser receives the prompt in a public phase (`PROMPT_REVEAL` or later). The server sends a stable opaque novelty token at that public boundary; the internal `promptId` remains server-only.

On room creation/join and after a newly public prompt is recorded, the browser sends its current filter as an advisory novelty hint. The server validates the exact version, encoded length, and base64url alphabet, then keeps the decoded filter only in the current room's memory. Prompt selection unions the filters of the current challenge participants and prefers candidates that are not probably present in that union.

This Bloom filter is compression, not encryption or anonymization. Because the active prompt universe is known, the server can test approximate membership for known prompt tokens. The filter is not used as a player identity, is not linked to IP for novelty selection, and is not written to analytics. Clearing site data, using another browser/device, or using private browsing can therefore begin a new local history.

A Bloom filter may also produce a false positive, which can temporarily hide an unseen candidate. With 24,576 bits, 18 hash positions, and 900 inserted prompts, the modeled false-positive probability is about 0.000203% (roughly 1 in 494,000). There are no Bloom-filter false negatives for successfully recorded items.

Client novelty data is never authoritative. A malformed filter is rejected. If a stale, saturated, or malicious all-ones filter makes every otherwise-valid candidate appear seen, the picker falls back to the normal exact room-session eligible pool. It does not clear browser history, block gameplay, alter scoring, or reset another mode.

## Stable novelty identity

The novelty token is derived server-side from the stable internal prompt ID and is revealed only when the prompt itself becomes public. Wording corrections that preserve the prompt's meaning should keep the same ID and therefore remain seen. A materially different prompt should receive a new ID.

## Quality-risk metadata

The original 330 prompts received a dedicated human risk review. The 570-prompt expansion follows the same response domains and topic-family conventions and is covered by structural content audits. Existing reviewed risk flags remain explicit and continue to influence weighted selection:

- `HIGH_CONSENSUS_RISK`: the group may converge on the same obvious answer, making the impostor easier to expose.
- `CONTEXT_DEPENDENT`: the prompt depends more strongly on context such as driving, a specific platform, or a particular social setting.
- `MEMORY_HEAVY`: the prompt asks for recall that may be unnecessarily difficult in a quick party game.
- `AMBIGUOUS_RESPONSE_RISK`: reasonable players may interpret the response rule differently.

These flags do not delete or ban prompts. They are explicit content metadata and remain auditable by ID.

## Group-size-aware selection

After no-repeat, cross-room novelty preference, and topic-family spacing are applied, the picker uses quality-weighted random selection. Every eligible prompt always keeps a positive probability of being selected, but flagged prompts are less likely than unflagged prompts.

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
