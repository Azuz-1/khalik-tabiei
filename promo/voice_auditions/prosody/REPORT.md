# Saudi-Najdi prosody casting experiment: critical lines only

> **Listen to `../critical_lines/Candidate-V`, `Candidate-K`, `Candidate-M` and `Candidate-R` before reading this file**, because the engine details below would unblind them. (M and R are the VoxCPM and Chatterbox runs you asked for in parallel, under random letters.)
> Each folder has `segNN_takeN.mp3`, 6 segments × 3 takes. V also has `pairs/` for the pronunciation A/B tests.
> Take meanings (the same across both candidates):
> - take 1 = engine defaults, one phrase
> - take 2 / take 3 = one variable changed (see `variants.py`; engine-specific replacements are recorded in `diagnostics/<letter>/*.json`)

Status: **research + critical-line audition. No full narration and no video.** Candidates are presented blind in `../critical_lines/Candidate-<letter>/`. The engine mapping is in `SEALED_mapping.md`; please open it only after listening.

Automatic measurements below (Whisper, pitch, pauses, prominence) are **diagnostics only**. They were used to find and fix broken takes, never to pick a voice. The choice is yours as the native listener.

## 1. What the research changed in the method

| Source | What it says | How it was used |
|---|---|---|
| [AihmedML/SaudiVoice-TTS](https://github.com/AihmedML/SaudiVoice-TTS) | Fixed prompt lists and native Saudi listening review. Qwen-KSA produced valid WAVs but natives found it "barely understandable". **Habibi-SAU = "the strongest Saudi dialect baseline so far"**; NAMAA is functional but underperforming; Voxtral has better acoustics but weaker Saudi authenticity. | Same fixed critical prompts for every engine. Habibi-SAU was chosen as the Saudi-specialized candidate (SILMA/Munsit are not accessible here, see §4). |
| [Habibi paper, arXiv 2601.13802](https://arxiv.org/abs/2601.13802) | Native-rater MOS split into **dialect accuracy / speaker similarity / naturalness**, because "ASR models remain weak in Arabic dialect settings". SAU dialect accuracy: ElevenLabs v3 3.70, Habibi-specialized 3.77 (lowest of the 7 dialects for most systems). Built to work "**without requiring text diacritization**". | WER is not used to rank. Tashkeel is stripped for Habibi (out-of-distribution for it). |
| [Audar-TTS-V1](https://github.com/AudarAI/Audar-TTS-V1) | "**Judge choice decides Arabic TTS rankings**": they score with an MSA-leaning Whisper *and* a dialect-aware judge. Expression tags; six synthetic voices. | Reinforces the rule that Whisper doesn't choose. Audar is blocked here (see §4). |
| [Chatterbox README](https://github.com/resemble-ai/chatterbox) | The reference-clip language leaks its accent; `exaggeration` ~0.7 with `cfg_weight` ~0.3 gives expressive speech; higher exaggeration speeds speech up. | Method guidance (reference = a Saudi-dialect synthetic clip for zero-shot engines). |
| [Almalki & Morrill, *Yes/No question intonation in Urban Najdi Arabic*, Speech Prosody 2016](https://www.isca-archive.org/speechprosody_2016/almalki16_speechprosody.html) | Najdi yes/no questions end **high**: H-H% or L-H% boundary tones. | Supports your «تِقْدَر؟» rise. Measured per take. |
| Najdi phonology: stress ([Alsuhaibani](http://www.scholink.org/ojs/index.php/selt/article/view/5109); [Najdi syllabification/stress](https://www.researchgate.net/publication/336556943_The_Syllabification_System_and_Stress_Pattern_of_Najdi_Arabic)) and /q/→[g], /k/→[ts] ([Najdi Arabic](https://en.wikipedia.org/wiki/Najdi_Arabic); [deaffrication in Qaṣīmī](https://www.cambridge.org/core/journals/language-variation-and-change/article/abs/regional-dialect-leveling-in-najdi-arabic-the-case-of-the-deaffrication-of-k-in-the-qasimi-dialect/81940391B7F366723AC4D4F0761B004D)) | Stress falls on the rightmost heavy syllable. ق is usually [g] («تِگدر», «گِدَر»). ك→[ts] is receding under dialect levelling. | Tested ق vs گ. **Did not** add ts-affrication: too local for a pan-Arab audience, matching your "light Najdi" target. |
| Munsit ([site](https://munsit.com/text-to-speech-model), [Emirati TTS blind test](https://www.zawya.com/en/press-release/companies-news/cntxt-ai-introduces-munsit-emirati-tts-the-most-accurate-native-emirati-voice-model-setting-a-new-benchmark-for-arabic-speech-pnmmy6pt)) | A blind test with native listeners (93% preferred it; this is vendor-published). I could not find a published "Munsit Arabic TTS Benchmark 2026" methodology page. | Blind, randomized letters and identical text across engines. |
| Reddit / X / TikTok | Reddit is blocked for my tools, and TikTok pages return no content. On X, the only substantive Saudi-user posts I found were about NAMAA (earlier rounds). **I found no credible community reports on chunking, seeds or prosody for Saudi TTS specifically.** | None. I'm not claiming evidence I didn't find. |

## 2. Experiment design

- **Segments:** 1, 5, 7, 8, 10, 12. There are 3 takes each, and each take changes **one** variable versus take 1 (the engine's defaults, one phrase). See `variants.py`.
- **Variables:** phrase split on performance beats (joined with exact silences); an engine-native prosody control; and one hidden-spelling test (10-t3: Najdi /g/ «گِدَر»).
- **Pronunciation A/B pairs** (`pairs/`): «يِشِكْ» (yours) vs «يشِكّ», and «يَدَك» vs «يَدَكْ».
- **Diagnostics** (`analyze.py`):
  - word timing by **MMS forced alignment of the intended text** (Whisper word timings proved unreliable on Arabic TTS);
  - pitch contour in semitones;
  - pauses of 120 ms or more;
  - word prominence (pitch peak + loudness + length);
  - terminal rise/fall;
  - Whisper transcript for intelligibility.
- **Blind pack:** loudness matched by gain only (−20 dBFS RMS, peak ≤ −1 dBFS), 48 kHz mono MP3. No EQ, compression, pitch shift or time-stretch.

## 3. Engines

### V: see sealed mapping
- **Controls researched:** the checkpoint exposes **speed only**. Its style vector is picked by phoneme count, and it has one voice, so there is no emotion control. "adj" = speed 0.9 (segment 12 t3: per-beat speeds 0.88 / 1.0 / 0.94).
- **Generation time:** 18 takes + 4 pairs in about 30 s on CPU.
- **Hidden overrides actually needed** (espeak front end; each verified by audio, not guessed):

| Your hidden text | What the engine produced | Changed to | Evidence |
|---|---|---|---|
| «تَخَيَّل» | phonemes `taχaiːl` (shadda mangled) | plain «تخيل» → `taχajjal` | Whisper heard «أخيل» in 2 of 3 takes before, «تخيل» after |
| «اِنْمَسَك!» | `ʔinmasaka` (MSA case vowel) | «اِنْمَسَكْ!» → `ʔinmasak` | heard «المسكة» ×3 before, «المسك» after |
| «يِشِكْ» | `jiːʃik` (long ī, first-syllable stress) | **not changed**; A/B pair with «يشِكّ» → `jʃikː` (final geminate, the stress Najdi phonology predicts) | your ear decides |
| «يَدَك!» | `jadaka` | **not changed**; A/B pair with «يَدَكْ» → `jadak` | Whisper can't tell these apart; your ear decides |
| «خَلِّك» | `χallka` (odd string) | not changed | heard correctly; the model was trained through this front end |

- **Diagnostics** (in the table, a positive "fall" means the pitch goes down at the end):

| Segment | Take 1 (one phrase) | Split / adjusted takes | Reading |
|---|---|---|---|
| 12 | 2.2 s, **no pause**, «تقدر» rise 0.1 st | pauses 340–360 ms and 480–540 ms; rise 1.3–1.5 st; «طبيعي» falls 1.6–1.9 st | Splitting is required. The question rise exists but is shallow. |
| 5 | 2.4 s, no beat before «ارفع» | beats: «يدك» becomes the **most prominent word**, ending falls 2.4 st | Matches your hypothesis. |
| 8 | «انمسك» **least prominent** (rank 9 of 9) | isolated payoff: rank 3, pause 370 ms | Confirms rule D (swallowed payoff). |
| 7 | «يشك» rank 3–4, «بالثاني» last | same across takes | Your stress target holds by default. |
| 1 | «تخيل» most prominent; «الوحيد» rank 6 | split: «الوحيد» rank 3; ending rises (surprise) | Whether the rise on «السالفة» sounds natural is for you to judge. |
| 10 | «يفلت» rank 1–2, «نقاط» low | split adds a 490 ms contrast pause | As hypothesized. |

### K: see sealed mapping
- **Controls researched:** zero-shot diffusion model. Its native controls are `cfg_strength`, diffusion steps, sway sampling, speed and seed; there are no emotion tags. "adj" = `cfg_strength` 1.5 instead of 2.0 (less guidance, more prosodic variation). The reference voice is a synthetic Saudi-dialect male clip (no real person); its transcript is known.
- **Generation time:** about 1 minute per take on 4 CPU cores at 16 diffusion steps (the default is 32; halved for the time budget and applied equally to every take). About 25 minutes in total, including re-takes.
- **Hidden overrides:** **all tashkeel stripped; letters kept (including «گ»).** With your tashkeel, take 1 of segment 1 came out as «اخ خيال … يرفعوني الدهم». Without it, all three segment-1 takes read cleanly. The model's paper says it was built to work without diacritization.
- **Pruned as broken (not in the pack):** 5-t2 (per-word countdown), 8-t2 (isolated «اِنْمَسَك!»), and 12-t2/t3 (isolated «تِقْدَر؟»). **This engine cannot voice very short isolated phrases**: they came out silent or garbled (Whisper heard «الحين السؤال طبيعي» with a 1.2 s hole). The replacements in the pack are marked in their `.json` files:
  - 5-t2: count | payoff with cfg 1.5
  - 8-t2: first clause | condition + payoff
  - 12-t2/t3: «الحين السؤال…» | «تِقْدَر؟ خَلِّك طبيعي!»
- **Diagnostics:**

| Segment | Finding |
|---|---|
| 12 | **One phrase (t1) is the best-behaved:** natural 280 ms pause after «السؤال», «تقدر» rise 1.3 st, and «طبيعي» falls 3.5 st. The two-beat replacements **lose the question rise** (0.0–0.1 st) and add a vowel («السؤالة»). |
| 8 | **One phrase already delivers the payoff:** the model inserts its own 370–420 ms beat before «انمسك», which becomes the most prominent word (rank 1). Isolating it breaks it. |
| 5 | Count-then-payoff gives a 530 ms beat, but «يدك» ranks low (5) and the ending is flat. Weaker command prosody than V's. |
| 7 | «يشك» outranks «بالثاني» in all takes. One-phrase takes add a vowel («المطلوبة»); the split take (t3) does not. |
| 1 | Clean in all takes. The ending falls (1.2–2.1 st) rather than rising; the surprise is carried by «الوحيد» (rank 1–3). |
| 10 | The «گِدَر» take (t3) was heard by Whisper as «أدري فلت». Whisper can't judge /g/ vs /q/, so that one is for your ear. |

### M: see sealed mapping
_Added at your request as a parallel candidate for later comparison._
- **Controls** (per the Chatterbox README): exaggeration, cfg_weight, temperature, seed. Take 1 uses the README defaults (0.5 / 0.5, temperature 0.8). "adj" uses the README's "expressive or dramatic" recipe (exaggeration 0.7, cfg_weight 0.3). Built-in default voice, no reference audio.
- **Generation time:** 18 takes in about 10 minutes (2 CPU threads, running in parallel with another engine).
- **Hidden overrides:** none. Your tashkeel text was used as-is. The model card says the model supports tashkeel and that missing tashkeel "may affect pronunciation accuracy".
- **Failures:**
  - **10-t1 (defaults) is broken:** it repeats «هو الذي يكسب هو الذي يكسب», a known Chatterbox repetition issue. It also **drifts «اللي» → «الذي»** (MSA). It was held back from the pack and re-taken with seed 2.
  - **Dialect drift under the expressive setting:** 12-t3 seed 1 (exaggeration 0.7 / cfg 0.3) says **«الآن»** instead of «الحين». The same setting gives 7-t2 a large end-rise (+7 st) and loses the «يشك» focus. The seed-2 re-take (the one now in the pack) keeps «الحين», so that drift is **not systematic**. But **both seeds lose the question rise** (0.0–0.1 st), and seed 2 blurs «خلك» (heard «شنك»). **Recipe: keep the defaults (0.5 / 0.5) for questions and taglines.** The seed-1 take is kept in the scratch record only, not in the pack.
  - **«اللي» → «الذي» drift on segment 10 at defaults, in both seeds.** The split take (10-t2) keeps «اللي». This is a systematic dialect-drift point for this model on this line.
  - 1-t2 (expressive): «يرفعون» was heard as «يدفعون» (stochastic).
- **What worked:**
  - **12-t2** (defaults, 3 beats) is the clearest question shape of any engine so far: «تقدر» rises **6.8 st**, with pauses of 420 and 470 ms. The one-phrase 12-t1 instead *rises* at the end of the tagline (−2.8 st fall), which is the wrong direction.
  - «انمسك» is the most prominent word both when isolated (8-t2, 390 ms beat) and in-sentence under the expressive setting (8-t3).
  - 10-t2 (split): «يفلت» is the most prominent word, with a 370 ms contrast pause.

### R: see sealed mapping
_Added at your request as a parallel candidate for later comparison._
- **Voice:** the casual young Saudi female designed earlier (sample G's anchor clip, no real person), used as the reference for every phrase.
- **Controls** (VoxCPM2 docs): a style instruction `(…)` prepended to the text together with the reference ("controllable cloning"), plus cfg_value (2.0), inference_timesteps (20) and seed. "adj" = per-segment style instructions:
  - 1: "playful, curious, surprised, casual, not over-acted"
  - 7: "playfully suspicious, conversational"
  - 8: "conversational, building tension toward the end"
  - 12: "calm, slightly slower" / "genuine curious question" / "confident, relaxed, settled falling ending"
- **Generation time:** 18 takes in about 11 minutes (4 threads, running alone). My first attempt ran in parallel with M and was **OOM-killed** (9.4 GB); running it alone fixed that.
- **Hidden overrides:** none. Your tashkeel text was used as-is and was transcribed cleanly.
- **Harness correction (my bug, not the model's):** VoxCPM phrases carry long low-level lead/tail silence, so split takes first measured 900–1360 ms pauses. `retrim_gaps.py` trims only the engine's own silence next to each inserted gap. The inserted gaps are exact digital zeros, so this is not time-stretching. Pauses afterwards: 370–590 ms.
- **Failures / oddities (for your ear):**
  - 1-t3 said «الوحيد**ة**» (feminine), apparently leaking from the female voice.
  - 12-t1/t2 say «خ**لي**ك» for «خلك».
  - 7-t2 (style instruction) was heard as «بحتها» and ends on a rise.
  - 10-t3 («گِدَر») loses the stress on «يفلت».
- **What worked:**
  - «انمسك» is the most prominent word in **all three** takes, both in-sentence and isolated.
  - 7-t3 (the split) makes **«يشك» the most prominent word** in the line.
  - 12-t1's tagline falls 5.8 st, with a question rise of 1.9 st. With the 3-beat split, 12-t2's tagline falls 8 st.

## 3b. Cross-engine lessons (the most reusable findings)

**Phrase splitting is engine-dependent.**
- It helps V (the only way to get a pause or a question shape), M (12-t2: the biggest question rise, 6.8 st) and R (7-t3: puts the focus on «يشك»).
- It breaks K: short isolated phrases come out silent or garbled. K does the pause, rise and payoff beat by itself in one phrase.

**Expressiveness settings are risky for dialect.**
- M's expressive recipe (exaggeration 0.7 / cfg 0.3) caused MSA drift («الآن» in one seed) and flattened the question rise in both seeds.
- R's style instructions changed delivery, but 7-t2 garbled a word.
- In all cases, conservative defaults and phrase structure were more reliable than "more expression".

**Hidden spelling is engine-specific:**
- V needs a sukun against MSA case vowels, and plain «تخيل».
- K needs the tashkeel removed.
- M and R take your tashkeel as written.

**Effective pause = inserted gap + the engine's own lead/tail silence.**
- The tail varies by engine (about 100 ms for V, up to about 1 s for R before correction).
- Measure it per engine and set the gap so the result lands at 300–450 ms.

## 3c. Success-criteria status (you fill in the perceptual rows)

| Question | V | K | M | R |
|---|---|---|---|---|
| 1. Sounds Saudi/Najdi? | your ear | your ear | your ear | your ear |
| 2. Least synthetic? | your ear | your ear | your ear | your ear |
| 3. Controllable prosody | speed only + phrase splits | cfg / speed / seed; must stay one phrase | exaggeration / cfg / seed + splits; defaults safest | style instructions + seed + splits |
| 4. Overrides needed | «تخيل» plain, «اِنْمَسَكْ» (+ A/B pairs) | strip tashkeel | none (watch «اللي»→«الذي» drift in seg 10) | none (watch «الوحيدة», «خليك») |
| 5. Best question / payoff shape so far (diagnostic) | 12: 3 beats; 8: isolated payoff | 12 and 8: one phrase | 12: 3 beats at defaults; 8: isolated or in-sentence | 12: 3 beats; 8: any; 7: split |
| 6. Reproducible across the script? | yes, deterministic | yes with fixed seeds, but slow (~1 min/phrase on CPU) | yes with fixed seeds (re-take repetitions) | yes with fixed seeds |
| 7. Commercial use | Apache-2.0 ✔ | CC-BY-NC-SA ✘ | MIT ✔ (inaudible Perth watermark) | Apache-2.0 ✔ |

## 4. Candidates not auditioned, and why

- **SILMA TTS v2 KSA:** API only, requiring "log in … generate your API key" ([silma.ai/saudi-tts-model](https://silma.ai/saudi-tts-model)); paid from $0.025/min. There is no key in this environment, and I can't create accounts. Its docs mention style-variance ("creativity") and speed control; SSML `<break>` support is **not documented** on the public pages.
- **Munsit (Faseeh):** account / API key required.
- **Audar-TTS-V1 Flash:** installed and the model loads. It is blocked because its audio codec `neuphonic/neucodec` is a **gated** Hugging Face repo (accept terms + login). A community mirror serves a file whose SHA-256 is byte-identical to the official one (`30c3ea13…ebdf`). However, loading an externally mirrored model file was blocked by this session's safety policy, so I stopped there. **To unblock (your call):**
  - (a) accept the terms at `huggingface.co/neuphonic/neucodec` and give me an HF read token, or
  - (b) explicitly allow the hash-verified Apache-2.0 mirror.

  The Audar plan is ready (`gen_audar.py`, voice `demo_male_3`, whose Gulf-flavoured reference is «يا هلا والله شفيك…»).

## 5. Reusable recipe so far

1. **Segment 12 (question + tagline):**
   - V: split into 3 beats. One phrase gives no rise and no pause.
   - K: keep it as **one phrase**. The model produces the pause, the rise and the falling tagline itself, and short isolated beats break.
2. **Effective pause = join gap + the model's own tail (about 100–160 ms).** To land at your 300–450 ms target, set the join gap to about 200–300 ms, not 380.
3. **Payoff words** («اِنْمَسَك!», «اِرْفَع يَدَك!»):
   - V: isolate them after a beat; in-sentence they get the least prominence.
   - K: keep them in the sentence; the model beats and stresses them itself, and isolating them breaks them.
4. **Hidden spelling is engine-specific:**
   - espeak-based engines (V) need a sukun to stop MSA case vowels, and plain «تخيل»;
   - diffusion engines trained without diacritics (K) need the tashkeel **removed**.
   - The same tashkeel that helps one engine breaks another.
5. **Najdi /g/** («گ») is supported by both front ends; the choice is in 10-t3 for your ear.
