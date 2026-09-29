# ElevenLabs test (owner-requested, non-commercial)

The owner asked to try ElevenLabs after hearing a Saudi voice on X. The project is personal and non-commercial (a game for friends), and the account is on the free plan.
- **Free-plan attribution:** credit "Voice by ElevenLabs" wherever this audio is published.
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
