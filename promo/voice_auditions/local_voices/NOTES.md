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
