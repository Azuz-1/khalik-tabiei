# 900-prompt content expansion

The active imitation bank now targets exactly 900 prompts:

- 300 HANDS
- 300 POINT
- 300 NUMBER

The 570-prompt expansion adds H101–H290, P101–P290 and N101–N290 while retaining the existing 330 prompts unchanged except for normal assembly into the larger bank.

Content constraints for the expansion:

- Saudi/Gulf conversational Arabic.
- Family-friendly party-game topics.
- HANDS remains a binary raise/don't-raise physical response.
- POINT remains one-person selection with multiple plausible targets.
- NUMBER remains explicitly answerable from 0 through 5.
- Topic-family metadata is explicit for all 570 additions so family spacing continues to work.
- No sensitive demographic, health, financial-distress or humiliating-disclosure prompts were intentionally added.

Automated tests enforce total/per-mode counts, ID uniqueness, normalized exact-text uniqueness, response-domain prefixes, NUMBER 0–5 constraints, and prompt-family metadata. Existing reviewed quality-risk weights remain active, with the strongest suppression in 3-player games.
