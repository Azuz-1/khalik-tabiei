# Local copies of Voice 4 (F4) and Voice 2 (M2)

**Goal:** run the owner's two favourite ElevenLabs voices on our own engine, free and offline: VoxCPM2 + Fasee7 Najdi LoRA, CPU. The owner asked for more than the sound of the voice: pronunciation of every word, energy and natural delivery.

- **Sample clips:** `ref/`.
  - `*_ref.wav` is line 2 + line 4 of the ElevenLabs voice, ~11 s. These lines aren't in the test set.
  - `*_prompt.wav` is line 2 alone, used for continuation.
- **Mode A:** `reference_wav_path` only. It copies the sound of the voice and keeps our recipe's style prefix and «…» pause control.
- **Mode B:** reference plus `prompt_wav_path`/`prompt_text` continuation, which carries over the voice's delivery. **The "(style…)" prefix must be removed in mode B**, or it is spoken aloud; in round 1 it was, and all of round 1's B takes were redone.

## Round 1 (lines 1, 5, 8, 12; 2 seeds per mode; cfg 2.0, 20 steps)
**Screen** (Whisper plus `delivery_check.py` against the ElevenLabs originals; screens only):
- **Dropped:**
  - F4_12_A_s1 «خليك»
  - M2_01_A_s1 garbled «يرفعون يدهم»
  - F4_08_A_s2 «اختاروا… المسك»
  - M2_01_B_s1 «الثالثة»
  - M2_12_B_s2 «خليك»
- **Mode A:** words clean, but often **flatter** (smaller pitch range) and **faster** than the originals, especially line 12 and the male countdown.
- **Mode B:** words clean, and the pitch movement is closer to the originals on the female lines. It **ignores the «…» pauses**: the pause total is often less than a third of the target.

**Blind page:** `test_r1/index.html`. Each voice and line has the ElevenLabs target plus shuffled local takes. The owner rates each take for closeness (Far/Close/Same), energy (Flat/Right/Too much) and any mispronounced word.

<details><summary><b>SEALED: take number → mode/seed. Don't open before the owner has rated</b></summary>

`{"F4_01_1":"F4_01_A_s2","F4_01_2":"F4_01_B_s1","F4_01_3":"F4_01_A_s1","F4_01_4":"F4_01_B_s2","F4_05_1":"F4_05_A_s1","F4_05_2":"F4_05_B_s1","F4_05_3":"F4_05_A_s2","F4_05_4":"F4_05_B_s2","F4_08_1":"F4_08_B_s2","F4_08_2":"F4_08_A_s1","F4_08_3":"F4_08_B_s1","F4_12_1":"F4_12_A_s2","F4_12_2":"F4_12_B_s1","F4_12_3":"F4_12_B_s2","M2_01_1":"M2_01_B_s2","M2_01_2":"M2_01_A_s2","M2_05_1":"M2_05_A_s2","M2_05_2":"M2_05_B_s1","M2_05_3":"M2_05_A_s1","M2_05_4":"M2_05_B_s2","M2_08_1":"M2_08_A_s2","M2_08_2":"M2_08_B_s1","M2_08_3":"M2_08_A_s1","M2_08_4":"M2_08_B_s2","M2_12_1":"M2_12_A_s2","M2_12_2":"M2_12_B_s1","M2_12_3":"M2_12_A_s1"}`

</details>

**Owner verdict on round 1** (pick closest plus a free note; the rating scales didn't fit how the owner hears differences):
- **Female:**
  - line 1: take 4 = **B s2**, closest, but «يرفعون» is said differently and the energy differs.
  - line 5: none close.
  - line 8: closest, but the pause and the pronunciation before «انمسك» differ.
  - line 12: none close.
- **Male:**
  - lines 1, 5 and 8: none close. The ElevenLabs male itself says «ثلاثة» badly.
  - line 12: take 1 = **A s2**, "kinda close but flat".

**Read:** the local engine gets the voice colour but not the delivery (word stress, energy, pauses).

## Round 2: female only, mode B with a line-matched prompt ("delivery bank")
- **Prompt per test line:** each takes the Voice 4 line closest in kind, from `ref/F4_prompt_bank.json`:
  - 1 ← 7
  - 5 ← 9
  - 8 ← 10
  - 12 ← 11
- **Takes:** 3 per line.
- **Stop rule:** if this is still not close, stop chasing a local copy and use ElevenLabs' monthly free credits (10,000 per month, about 12 full narrations) for Voice 4.

**Round 2 screen:**
- All 12 takes have every word clean.
- The delivery check is closer than in round 1 on pauses and pitch range for lines 8 and 12.
- Blind page: `test_r2/index.html`. Line 1 also includes the round-1 pick as a hidden control.

<details><summary><b>SEALED round 2 mapping: don't open before the owner has picked</b></summary>

`{"F4_01_1":"bank_s1","F4_01_2":"bank_s3","F4_01_3":"round1_pick_B_s2","F4_01_4":"bank_s2","F4_05_1":"bank_s1","F4_05_2":"bank_s3","F4_05_3":"bank_s2","F4_08_1":"bank_s3","F4_08_2":"bank_s1","F4_08_3":"bank_s2","F4_12_1":"bank_s1","F4_12_2":"bank_s3","F4_12_3":"bank_s2"}`

</details>

## Delivery copy ("prosody transplant"), owner's idea
- **Owner's note after round 2:** "still the same issue". Measure how Voice 4 says each word (length, ups and downs, loudness) and copy it onto the local take.
- **Tool:** `transplant.py`.
  - MMS_FA letter alignment of the same text in both recordings.
  - Praat PSOLA: each letter and pause is stretched to the target length, and the target pitch curve (octave errors folded) is moved into the take's register.
  - Per-word gain toward the target's loudness shape (±6 dB).
- **This deliberately breaks the old "no time-stretch / no pitch-shift" rule, at the owner's request.** The owner's ear judges the artifacts.
- **Result:**
  - Word timing is within about 10–15 ms of the target.
  - Word-level melody correlation with Voice 4, before → after copy:

    | Line | Before | After |
    |---|---|---|
    | 1 | 0.64 | 0.99 |
    | 5 | 0.33 | 0.99 |
    | 8 | 0.70 | 0.90 |
    | 12 | 0.54 | 0.85 («الحين» rise only partly transferred) |
- **Page:** `transplant_r1/index.html`. For each line it plays the target, the local take before and the local take after, and shows the pitch chart and a per-word table.
- **For new lines** there is no Voice 4 reading to copy. The target can be the owner's own phone reading, which gives the owner's delivery in the local Voice 4 timbre.

**Owner verdict on the delivery copy:** "before" was much better. After the copy the audio sounded artificial, with an echo and a thick sound.
- **Causes:** PSOLA phasiness, and the take being resampled to 16 kHz.
- **The approach is dropped:** no post-processing of local audio.

## Round 3: the analysis picks, it doesn't operate
- **Takes:** 8 clean takes per line (mode B with the line-matched prompt, seeds 4–11), for lines 1, 5, 8 and 12. Together with round 2 that makes 11 takes per line.
- **Scoring:** each take is scored against Voice 4:
  - per-word timing error;
  - word-melody correlation;
  - pause match.
- **What the owner hears:** the 2 best takes per line, untouched.

**Round 3 result:**
- **Pool:** 44 takes (rounds 2 and 3, 11 per line).
- **Screen:** dropped 8 for missing or altered words (e.g. «خليك», «شكين», «المسك»). Three others were only Whisper formatting (digits, «ان مسك») and were kept.
- **Scoring:** `pick_takes.py` on the 36 left. Scores are in `test_r3/scores.json`.
- **Page:** the top 2 per line, untouched audio (48 kHz, loudness-matched gain only), in `test_r3/index.html`.

<details><summary><b>SEALED round 3 mapping: don't open before the owner has picked</b></summary>

`{"F4_01_1":"F4_01_bank_s3.wav","F4_01_2":"F4_01_bank_s11.wav","F4_05_1":"F4_05_bank_s9.wav","F4_05_2":"F4_05_bank_s1.wav","F4_08_1":"F4_08_bank_s3.wav","F4_08_2":"F4_08_bank_s6.wav","F4_12_1":"F4_12_bank_s7.wav","F4_12_2":"F4_12_bank_s10.wav"}`

</details>

## Conclusion (owner, 2026-09-29)
- **Verdict:** the local copy is "good", but Voice 4 feels more alive and real.
- **Production:** Voice 4 on ElevenLabs (owner-designed voice, eleven_v4, via the website or the API).
- **Local copy** (VoxCPM2 + Fasee7 + `ref/F4_*`) is a free offline backup for drafts. Use `say.py` or `gen_bank.py`, generate 8+ takes and pick with `pick_takes.py`.
- **Findings:**
  - Zero-shot copying transfers the voice colour but not the liveliness.
  - Selecting among many clean takes matches timing and pauses closely; melody reaches 0.74–0.87 at best.
  - Post-hoc prosody transplant was rejected (artifacts).

## New free Saudi models (2026-09-29): NAMAA-Saudi-TTS-V2, Saudi-tts-v4, Lahgtna
- **Setup:** all three copy the Voice 4 sample (female) and the Voice 2 sample (male). Lines 1, 5, 8 and 12, with 3–4 takes each.
  - NAMAA-V2 and Saudi-tts-v4 use F5-TTS (`gen_saudi_f5.py`), with tashkeel removed and «گ» kept.
  - Lahgtna uses Chatterbox (`gen_lahgtna.py`) with dialect "sa".
- **Licences:**
  - NAMAA-V2 and Saudi-tts-v4: CC-BY-NC-SA-4.0 (non-commercial).
  - Lahgtna: MIT.
- **Screen (Whisper, key words):**
  - NAMAA-V2 is the cleanest. It sometimes adds a sound after «المتخفي».
  - Saudi-tts-v4 slips more («تدر» for «تقدر», dropped «ارفع», «خليك»).
  - Lahgtna repeats words and babbles at line ends on most takes, so it is excluded from the blind test (2 samples shown).
- **Blind page:** `test_new/index.html`.
  - One best clean take per model, chosen by `pick_takes.py` against Voice 4 or Voice 2.
  - Female also includes the round-3 VoxCPM2 local copy.

<details><summary><b>SEALED new-models mapping: don't open before the owner has picked</b></summary>

`{"F_01_A":"NAMAA-Saudi-TTS-V2","F_01_B":"Saudi-tts-v4","F_01_C":"VoxCPM2localcopy(round3)","F_05_A":"VoxCPM2localcopy(round3)","F_05_B":"Saudi-tts-v4","F_05_C":"NAMAA-Saudi-TTS-V2","F_08_A":"NAMAA-Saudi-TTS-V2","F_08_B":"Saudi-tts-v4","F_08_C":"VoxCPM2localcopy(round3)","F_12_A":"VoxCPM2localcopy(round3)","F_12_B":"Saudi-tts-v4","F_12_C":"NAMAA-Saudi-TTS-V2","M_01_A":"Saudi-tts-v4","M_01_B":"NAMAA-Saudi-TTS-V2","M_05_A":"NAMAA-Saudi-TTS-V2","M_05_B":"Saudi-tts-v4","M_08_A":"NAMAA-Saudi-TTS-V2","M_08_B":"Saudi-tts-v4","M_12_A":"NAMAA-Saudi-TTS-V2","M_12_B":"Saudi-tts-v4"}`

</details>

**Owner picks on the new-models page (female):**
- line 1: NAMAA-V2;
- lines 5, 8 and 12: the VoxCPM2 local copy (round 3).
- The owner rated the pronunciation "about 90%", but heard **echo or noise**.
- The owner rejected **all male options** and **Lahgtna** (it sounded Levantine or Jordanian).

## Echo cleanup test
- **Diagnosis:** the noise floor between words is already −88 to −98 dB (cleaner than Voice 4's −70), so the "echo" is inside the voice (vocoder roominess or doubling), not hiss.
- **Versions tested per pick:**
  - original;
  - cleaned with ClearerVoice MossFormer2_SE_48K (Apache-2.0);
  - line 1 only: cleaned plus MossFormer2_SR_48K upscaling (NAMAA outputs 24 kHz);
  - lines 5, 8 and 12 only: regenerated with the same seed at 40 diffusion steps (`STEPS=40 gen_bank.py`), raw and cleaned.
- The 40-step takes keep every word.
- **Blind page:** `test_clean/index.html`.

<details><summary><b>SEALED cleanup mapping: don't open before the owner has picked</b></summary>

`{ "01_1": "cleaned + upscaled to 48k", "01_2": "cleaned", "01_3": "original", "05_1": "original", "05_2": "40 steps + cleaned", "05_3": "cleaned", "05_4": "40 steps", "08_1": "40 steps", "08_2": "cleaned", "08_3": "40 steps + cleaned", "08_4": "original", "12_1": "40 steps + cleaned", "12_2": "original", "12_3": "40 steps", "12_4": "cleaned"}`

</details>
