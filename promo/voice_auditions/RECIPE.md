# Saudi-Najdi AI voiceover: the recipe that worked

This is what we learned producing the «خلك طبيعي» promo voice (2026-09). The owner is the native Saudi listener, and every decision below was confirmed by their ear. The detailed history is in `prosody/LISTENING_NOTES.md`, and the research is in `prosody/REPORT.md`.

## 1. Engine and voice (the winner, "R")
- **Model:** [openbmb/VoxCPM2](https://huggingface.co/openbmb/VoxCPM2) (Apache-2.0) + the [Wittify/Fasee7-Najdi-Small](https://huggingface.co/Wittify/Fasee7-Najdi-Small) Najdi LoRA (Apache-2.0). Commercial use is OK.
- **Voice:** a casual young Saudi woman created with VoxCPM2 voice design, not cloned from anyone. The reference clip is `segments/G/anchor.wav`, and every line uses it via `reference_wav_path`.
- **Settings:** `cfg_value=2.0`, `inference_timesteps=20`. Seed with `torch.manual_seed(seed*100+80)`.
- **Word splice as a last resort:** when one word is only right in another line (line 6 «المتخفي» ← line 10), `prosody/splice_word.py` cuts it in via forced alignment, RMS match and 15 ms crossfades. The owner accepted it.
- **Runs** on CPU at about 1 minute per line on 4 cores. It needs ~9.5 GB RAM, so **never run it in parallel** with another large model (it gets OOM-killed).
- **Rejected by the owner:**
  - Piper / VITS «SA_dii»
  - Edge «Hamed»
  - Nabra-Saudi-82M: good Saudi colour, but **«ت/د» sound like «ط»**
  - Habibi-SAU: non-commercial, and **its short phrases break**
  - NAMAA/Chatterbox: **drifts to MSA** («الآن», «الذي») under expressive settings

## 2. How to write each line (the prompt recipe)
1. **One phrase per line.** Generate the whole line in one go. Splitting it into separately generated pieces gave unnatural stops and shouted payoffs. Exception: split only when the model cannot produce a long pause you need (line 9, before «وكل جولة غير»).
2. **Prefix a calm conversational style instruction**, e.g. `(calm, conversational, explaining the rules)`. Pick the variant per line:
   - "asking a friendly question"
   - "playfully suspicious"
   - "relaxed, playful countdown"
3. **Put «…» where a native speaker pauses.** Get the pause points from a real native reading (§4). «…» gives a long pause (~250–600 ms), and «،» gives a short one or none.
4. **End explanatory payoffs with «.», not «!».** «!» made «انمسك» come out as a small shout. The owner wants it explanatory: the key word before the break rises, and the payoff after it falls calmly.
5. **Generate 3+ seeds per line.** Seeds change the delivery much more than any setting does. Screen them automatically (§5), then the native listener picks.

## 3. Pronunciation: hidden spellings that the owner confirmed
These go into the TTS input only; the visible captions stay normal Arabic.

| Intended | Write for the TTS | Why |
|---|---|---|
| قدر / تقدر (soft Najdi /g/) | **«گِدَر»**, **«تِگْدَر»** | A written «ق» sounds too strong; Najdi says [g]. |
| المتخفي | **«المُتَخَفّي»** (full tashkeel) | Owner-picked form. Plain spelling or «المِتْخَفّي» was worse. Some seeds insert a «ت» («المتختفي»), so screen for it. |
| أغلبكم | **«أغلبْكُم»** | Not «أغلبَكُم». |
| انمسك | **«إنْمَسَكْ.»** | The owner's own pronunciation, with a calm «.». |
| تدخلون | **«تدْخلون»** (sukun on د) | Otherwise it gets an audible shadda. |
| بأصابعك | **«بصابعك»** | What the owner actually says. |
| يدهم | **«يِدّهُم»** | Shadda; a sukun («يِدْهُم») gave «يدْهم». |
| يدك (ارفع يدك) | **«يِدّكْ»** | Not «يَدَك» / «يدْك». |
| يقلدكم | **«يگلّدكم»** | Najdi [g]; a written «ق» sounds too strong, as with «قدر». |
| ولا تسجيل | **«بدون تحميل… ولا تسجيل.»** | Without the beat, «و» was swallowed and «تسجيل» came out 14.5 dB quieter than the line. |

**Hidden spelling is engine-specific.** The same tashkeel that helps one engine breaks another:
- espeak-based engines need a sukun against MSA case endings;
- diacritic-free engines (Habibi) need the tashkeel removed;
- VoxCPM takes it as written.

## 4. Calibrate against a native reading
- The owner read all 12 lines once on a phone. `prosody/analyze_ref.py` extracts the pause positions and lengths, word timing and pitch shape. It uses forced alignment (MMS_FA) and an adaptive silence threshold at the noise floor + 6 dB; a phone recording's floor is about −25 dB.
- **Native pattern:** the focus word before a boundary gets a continuation **rise**; the payoff after the boundary **falls**.
- **The countdown peaks on «واحد»**, and the command after it is low-key.
- **Pace:** 2.2–2.9 words/s, with 0.6–1.0 s between lines. At a natural pace the full script is **~55–60 s**, not 40 s.

## 5. What automatic metrics can and cannot do
- **Use them only as pass/fail screens** (`prosody/screen.py`): Whisper transcript contains the key words, and the pause exists at each native pause point. They reliably caught:
  - dialect drift («الآن», «الذي»)
  - garbled words
  - «خليك» for «خلك»
  - missing pauses
- **Never use them to rank.** My contour score ranked the owner's favourite take *last*, twice. Similarity to the native pitch contour was *anti*-predictive, because a female synthetic voice shouldn't copy a male pitch curve. A timing-only predictor (rhythm + pause error) matched 3/3 picks in hindsight but only **3/7 out-of-sample**. It's a shortlister, not a judge.
- **Whisper can't hear** «ق» vs «گ», shadda, or «ت» vs «ط». Those need the native ear.

## 6. Harness pitfalls (my bugs, fixed)
- Word timings: use **forced alignment of the intended text**. Whisper's word edges were badly misplaced on Arabic TTS.
- **Trim silence conservatively** (−50 dB, 80 ms pad). Aggressive trimming clipped weak onsets such as the /t/ in «تخيل».
- **VoxCPM phrases carry long edge silence.** When joining separately generated phrases, trim only next to the inserted gap (`prosody/retrim_gaps.py`).
- **Pitch trackers make octave errors.** Look at the plot before believing a ±15 semitone "rise".

## 7. Final narration
- Per-line WAVs picked by the owner: `segments/R_picks/NN.wav` (+ `.json` with the exact text, style and seed).
- Assembled with the owner's own pauses between lines: `narration_draft2_R.mp3` (60.1 s). The owner confirmed this version.

## 8. ElevenLabs Voice 4: the current production voice (owner verdict, 2026-09-29)
Full notes: `elevenlabs/NOTES.md` and `local_voices/NOTES.md`.
- **The voice.** The owner designed "Voice 4" ("بنت عربي", id `tPQlZxlHLbatonwL593Q`) in ElevenLabs Voice Design. The owner found it better than R and more alive than any local copy.
- **Generation.**
  - Model `eleven_v4`, text = the hidden TTS text of RECIPE §3 with a `[warm]` tag.
  - Settings: stability 0.6, style 0, speed 1.0.
  - Generate 2–3 takes per line; one take per line was the main cause of drift.
- **Free-plan API limits.** It works only with voices the owner designed. Library voices return 402 and voice design returns 403.
- **Designing voices.**
  - First sentence: "Native Arabic, Saudi Najdi …"; describe delivery, not "accent".
  - The preview text shapes the voice. Keep the Najdi in the sound, not in dialect vocabulary.
- **Spelling for this engine.**
  - Tashkeel is fine; it was *not* the cause of formal drift.
  - Write «ثنين» for the countdown.
- **Local copies can't replace it.**
  - VoxCPM2 + Fasee7 with Voice 4 samples copies the voice colour, not the liveliness.
  - Picking the best of 8–11 clean takes (`local_voices/pick_takes.py`) helps timing and pauses.
  - Never stretch or pitch-bend the audio afterwards: the owner heard echo and a thick sound.
- **Captions and credits.** The owner decides; the post caption stays exactly as written.
