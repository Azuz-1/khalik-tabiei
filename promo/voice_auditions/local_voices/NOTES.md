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
