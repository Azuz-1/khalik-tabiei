# Native listening notes (owner) and what changed because of them

## Round 1: first quick-start clips (candidates V and K)

| Clip | Owner's verdict | Error class | Action |
|---|---|---|---|
| V seg12 take2 (3 beats: «الحين السؤال…» 300 ms «تِقْدَر؟» 380 ms «خَلِّك طبيعي!») | **Good** | none | Kept as the reference shape for segment 12 on V. |
| K seg12 take1 (one phrase) | **Not good: no pauses, words grouped together** | B (phrasing/pauses) | **My diagnostics had called this take "best-behaved"** (it measured a 280 ms pause and a 1.3 st rise). The listener overrules. Lesson: a measured pause and a rise do not mean the grouping sounds natural. Diagnostics stay secondary. |
| V seg08 take2 (payoff isolated) | «اختار» sounds like **«اخطار»**; the «د» in «تبدون» sounds **heavy** | A (consonant quality / vowel) | The V front end gave «تبدون» the MSA ending → `tbduːna`. Fix: «تِبْدُون» → `tibduːn`. «اختار» is already a plain /t/ in the phonemes (`ʔiχtaːr`), so the «ط» colour is acoustic; A/B with «إخْتار» (`ʔχtaːr`). See `fixes/08_fix*`. |
| K seg08 take1 (one phrase) | **Sounds good**, but the vowels are wrong: «أغلبَكُم» → should be **«أغلبْكُم»**; «انمسك» → the owner says **«إنْمَسَكْ»** | A (vowels) | Applied to the shared script for all engines (below). |

## Round 2: quick-start clips for M and R
- **Owner's pick: R seg07 take3** (the split: «بعدها يِنكَشِف المطلوب…» | 280 ms | «وكل واحد يبدأ يِشِكْ بالثاني.»).

## Pronunciation targets now fixed by the owner (all engines)
- «أغلبْكُم» (sukun on ب), not «أغلبَكُم».
- «إنْمَسَكْ» («in-masak»). Engine-specific spellings used to get that sound:
  - R/M/K: «إنْمَسَكْ» as written.
  - V: «اِنْمَسَكْ». Its front end drops the initial vowel from «إنْمَسَكْ» (`ʔnmasak`) but keeps it from «اِنْمَسَكْ» (`ʔinmasak`).

## Round 3: segment 8 fixes
| Clip | Owner's verdict | Error class | Consequence |
|---|---|---|---|
| R fix1 (payoff in the sentence) | «المتخفي انمسك» **merges into one word** | B (missing juncture) | Needs a *short* boundary, not a full phrase break. |
| R fix2 (payoff isolated, 250 ms) | Stops after «المتخفي», then «انمسك»: **feels unnatural**. «انمسك» is a **small shout**; it should be **explanatory**. The sound itself is good. | B (juncture too strong) + wrong emotion | Separate generation with «!» triggers an exclamation. Drop «!» from the hidden text, and keep some context in the payoff phrase instead of the bare word. |
| R fix3 (fix2, seed 2) | **Bad**: «انمسك» sounds surprised/shouted | wrong emotion | Same cause. |
| V fix1 | **Liked the voice**, but it **still uses «ط» instead of «ت»/«د»** | A (acoustic emphasis) | Spelling can't reach this: the phonemes already ask for plain /t/ and /d/. It is how this voice realizes them. |
| V fix2 / fix3 | The two «انمسك» sound very close | — | The «إخْتار» respelling and in-sentence placement made little audible difference. |

**Target for «إنْمَسَكْ» (owner):** explanatory, matter-of-fact, clearly separated from «المتخفي» but not a full stop, and **not** exclaimed or surprised.

## Owner's read-through (received as a speech-to-text transcript, not audio)
- Natural word choice: **«بصابعك»** (not «بأصابعك») in segment 9. Adopted for the hidden text.
- The transcript shows «هذه» and «الفائز». These are likely the transcriber's MSA normalization of «هذي» and «الفايز», so not adopted.
- There is no prosody information (no audio). Calibration still needs the audio file itself.

## Calibration against the owner's reading (segment 8, engine R)
Six takes: approach A = two phrases, calm style instruction on «إنْمَسَكْ.», 160 ms inserted gap; approach B = one phrase with a «…» juncture. Three seeds each. They were scored by distance to the owner's contour and pauses (`diagnostics/calibrated/score_vs_owner.txt`; a shortlist only).
- **cal1 = A seed 2:** closest. «المتخفي» rise → 230 ms → «انمسك» low falling, not stressed. Same shape as the owner's reading (compare `reference/owner_line08.png`).
- **cal2 = A seed 3:** runner-up. 230 ms juncture, «انمسك» a little more stressed.
- **cal3 = B seed 3:** the only one-phrase take with a juncture (240 ms), for comparison. The other B seeds glued «المتخفي انمسك» together, the same fault the owner heard in fix1.

## Round 4: owner's pick for segment 8 = **cal3** (R, one phrase: style "(calm, conversational, explaining the rules)", «المُتَخَفّي… إنْمَسَكْ.», seed 3)
- My contour scorer had ranked cal3 **last**, because pitch-tracker octave errors inflated its "fall". This is the second time the metrics disagreed with the owner. **From now on, metrics are used only as pass/fail screens** (words present, juncture present), never to rank.
- **R recipe:** one phrase per line + a calm conversational style instruction + «…» at the owner's measured pause points + «.» (not «!») on explanatory payoffs + several seeds, keeping only those where the juncture actually appears.

## Round 5: R recipe applied to segments 12, 5, 7, 10 (3 seeds each; `gen_recipe.py`)
Pass/fail screen (`diagnostics/recipe/screen.txt`): **8 pass**, sent unranked in `critical_lines/Candidate-R/recipe/`.
Failed (not sent):
- 5 seed 3: no pause after «اثنين».
- 10 seeds 2 and 3: no contrast pause after «نقاط».
- 12 seed 3: dialect drift «الحين» → «الآن» and no pause after «السؤال».

## Round 6: owner's picks and issues
- **Picked: 5 = seed 2** (`recipe/seg05_seed2`), **7 = seed 3** (`recipe/seg07_seed3`).
- **12: "not understandable"; maybe the line itself needs changing.** Testing whether this is pronunciation (a lone «تِقْدَر؟» with strong ق) or wording (the question lacks an object):
  - A = same words, «تِگْدَر»
  - B = «تِگْدَر تخدعهم؟»
  - C = «تِگْدَر تسايرهم؟»

  B and C are wording proposals and would change the caption, so the owner decides.
- **10: disliked «المتخفي»; «ق» too strong.** Najdi realizes ق as [g], so the test uses «گِدَر». «المتخفي» is tested in three forms: «المُتَخَفّي» (current), plain «المتخفي», and «المِتْخَفّي» (colloquial *mit-*).
- Round-6 screen: 7 of 12 pass. The seed-1 takes of segment 10 lost the contrast pause for all three spellings; seed 2 kept it for all three. Two segment-12 takes said «خليك» instead of «خلك» (rejected).
- Sent (`critical_lines/Candidate-R/round6/`):
  - 10 A «المُتَخَفّي» / B «المتخفي» / C «المِتْخَفّي»: all seed 2, all with «گِدَر». Only «المتخفي» differs.
  - 12 A «تِگْدَر؟» / B «تِگْدَر تخدعهم؟» / C «تِگْدَر تسايرهم؟».
