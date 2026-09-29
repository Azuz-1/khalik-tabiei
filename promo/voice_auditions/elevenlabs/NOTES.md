# ElevenLabs test (owner-requested, non-commercial)

The owner asked to try ElevenLabs after hearing a Saudi voice on X. The project is personal and non-commercial (a game for friends), and the account is on the free plan.
- **Free-plan attribution:** ElevenLabs' free-plan terms ask for a credit; the owner chose not to add one to the post (2026-09-29). Same caption as the R cut: `out/post_caption.txt`.
- **Commercial use** would need a paid plan.

## What the free plan allows through the API (tested 2026-09-29)
- **Library voices** (Lama, Majed, …): blocked, `402 paid_plan_required`. They work only in the ElevenLabs website.
- **Creating a voice** via `/v1/text-to-voice/design`: blocked, `403 feature_not_available`.
- **Voices the owner designed in the website**: allowed. Text-to-speech with `eleven_v4` works.
- **Credential setup gotcha:** the Claude environment credential must use header `xi-api-key` with an **empty Prefix**. The form defaults to `Authorization` + `Bearer`. Keep only one credential per host.

## Voices
All three were designed by the owner with Voice Design; none is cloned from anyone. Category: `generated`.

| Tag | Name in account | Voice ID | Prompt summary |
|---|---|---|---|
| F1 | بنت عربي | tPQlZxlHLbatonwL593Q | Saudi Najdi female, playful game host |
| F2 | بنت عربي نجدي | gTKrhCj22wWEoax2wtwr | thick Najdi female, friendly, soft volume |
| M | رجل عربي | YwG5nJLWQ33Z3AKec3RN | natural Najdi male, upbeat, simple words |

### Prompting lessons
- **Dialect drift:** name the language and dialect in the first sentence, e.g. "Native Arabic, natural Najdi Saudi accent from Riyadh … not Egyptian, not Levantine, not MSA".
- **Shouting:** the preview text shapes the voice. `[excited]`, `[laughs]` and many «!» made it shout. Use calm text with «…» pauses and a «.» on the payoff.
- **Keep the Najdi in the sound, not the vocabulary.** Words like «مير», «عاد», «ترى» made the male voice sound forced and hurt comprehension for other Arabs. Use the real video script as the preview text.
- **Narrator sound:** "warm, smooth, medium-low, clear" produces a documentary narrator. For a person, describe a friend explaining a game he enjoys, without exaggerating.
- **Guidance scale:** ~30–35% (a lower value sounds more natural). Set Loudness to about ⅓.

## Generation
- **Model and texts:** `eleven_v4`. Texts are the exact hidden TTS texts from `segments/R_picks/NN.json` (style prefix removed).
- **calm:** `[warm]` + text, stability 0.6, style 0, speed 1.0.
- **game:** per-line tags (`[excited]`/`[whispers]`/`[playful]`/`[mischievously]`/`[curious]`), stability 0.35, style 0.3, speed 1.05.
- **Code and log:** `gen_own.py`, `gen_log.json`.
- **Credits:** about 2,400 for the 36 takes. The account total after this round is 3,836 / 10,000, including the owner's Voice Design previews.

**Screen (Whisper; pass/fail only, never ranking):** all 36 takes contain every word, with no spoken tags and no language switch. These are Whisper-level flags for the owner's ear, not rejections:
- M_06_game heard «يقلتكم»
- F2_01_game «يفعون»
- F2_12_calm «خلق»
- M_12_calm «أنحين»

## Blind pack
- **Location:** `critical_lines/ElevenLabs-own/lineNN_X.mp3`.
- **Contents:** 7 takes per line, the six new takes plus `Current` (our R_picks narration).
- **Letters:** shuffled per line with seed 20260929.
- **Loudness:** gain-only match to −20 dBFS RMS with peak ≤ −1 dBFS, 48 kHz mono.
- **Listening page:** `index.html`.

<details><summary><b>SEALED mapping: don't open before the owner has picked</b></summary>

| Line | Takes |
|---|---|
| 1 | A=F2_game | B=M_game | C=M_calm | D=Current | E=F1_calm | F=F2_calm | G=F1_game |
| 3 | A=Current | B=F2_game | C=M_calm | D=F1_game | E=F1_calm | F=F2_calm | G=M_game |
| 5 | A=M_calm | B=Current | C=M_game | D=F1_game | E=F2_game | F=F2_calm | G=F1_calm |
| 6 | A=F1_calm | B=Current | C=F2_game | D=M_calm | E=M_game | F=F1_game | G=F2_calm |
| 8 | A=M_calm | B=F2_calm | C=Current | D=F1_calm | E=F2_game | F=M_game | G=F1_game |
| 12 | A=F2_calm | B=Current | C=F1_calm | D=F2_game | E=M_calm | F=M_game | G=F1_game |

</details>

## Six-line comparison (round 2)
- **Contents:** lines 1, 3, 5, 6, 8 and 12 joined in order, with the owner's gaps from `script/short.json`.
- **Takes used:** the *calm* take per voice (no whisper), and R_picks for Current.
- **Loudness:** −20 dBFS RMS over speech.
- **Why six lines:** the full 12-line run stopped at the API key's 3,000-credit cap.
  - Also generated: M lines 1–8 and 11, and F2 lines 11–12 (stability 0.5, style 0.2, no tags).
  - Still missing for full narrations: M 9–10; F1 2, 4, 7, 9, 10, 11; F2 2, 4, 7, 9, 10.

<details><summary><b>SEALED mapping for voice1..voice4: don't open before the owner has commented</b></summary>

`{"1": "Current", "2": "M", "3": "F2", "4": "F1"}`

</details>

## Round 3: the owner prefers Voice 4 (F1, "بنت عربي")
**Owner verdict on the six-line comparison:**
- Voice 4 = F1 has the best pronunciation and is the best overall, beating Current as well.
- M and F2 start in colloquial Najdi, then drift to formal Arabic.
- F2 says «اثنين» the formal way.

**Hypothesis:** full tashkeel reads as formal Arabic to ElevenLabs, and F1's casual design anchors her against that pull.

**Generation:**
- **F1's full narration:** F1's missing lines 2, 4, 7, 9, 10 and 11 were generated with her calm settings (`[warm]`, stability 0.6). They were joined with the owner's gaps into `voice4_full.mp3` (66.7 s).
- **Tashkeel test:** M and F2 each read lines 5, 8 and 12 at seed 7, once with tashkeel and once as plain text (گ kept). «اثنين» is written «ثنين» in both versions.
- **Credits:** 4,819 / 10,000 used.

<details><summary><b>SEALED tashkeel-test mapping (X/Y): don't open before the owner answers</b></summary>

`{"M_05_X":"plain","M_05_Y":"tashkeel","M_08_X":"plain","M_08_Y":"tashkeel","M_12_X":"plain","M_12_Y":"tashkeel","F2_05_X":"tashkeel","F2_05_Y":"plain","F2_08_X":"plain","F2_08_Y":"tashkeel","F2_12_X":"tashkeel","F2_12_Y":"plain"}`

</details>

**Tashkeel test result (owner, blind):**
- **M:** all three pairs sounded the same, and the pronunciation was "much better" than in round 2.
  - The exception is line 5, where «ارفع يدك» doesn't come out as «يدّك» (the females say it right).
- **F2:** mostly good, apart from line 5.

**Conclusion:**
- **Tashkeel was *not* what made M/F2 formal**, because the with and without versions sound the same.
- The round-2 drift was most likely take-to-take randomness (one take per line) plus the formal «اثنين». Write it «ثنين» for ElevenLabs.
- **Rule for ElevenLabs:** generate 2–3 takes per line, as with VoxCPM. Tashkeel can stay.

**Owner approved Voice 4 (F1) with no comments.** The video is built with it: `PICKS=V4_picks OUT=khalik-tabiei-promo-v4 ./build.sh`. The R version stays as `khalik-tabiei-promo.mp4`.
