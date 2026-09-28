---
name: saudi-voiceover
description: Produce or edit a natural Saudi (light Najdi) AI voiceover for this project's promo videos: new lines, re-takes, pronunciation fixes, or choosing a voice. Use whenever a task involves Arabic/Saudi TTS, narration, voice casting, dialect pronunciation or prosody for «خلك طبيعي». Encodes the owner-validated recipe (VoxCPM2 + Fasee7 Najdi LoRA, style-prompted one-phrase lines, native-calibrated pauses, hidden spellings) and the evaluation rules (native ear decides; metrics only screen).
---

# Saudi-Najdi voiceover (owner-validated recipe)

Read `promo/voice_auditions/RECIPE.md` first. It is the full recipe with the reasons behind it. The history is in `promo/voice_auditions/prosody/LISTENING_NOTES.md`.

## Non-negotiables
- **The owner (native Saudi listener) makes every perceptual decision.** Automatic metrics (Whisper, WER, pitch, DNSMOS) may only *reject* broken takes; they must never rank or choose. They were wrong about the owner's favourites repeatedly.
- **No voice cloning** of real people from the internet. The narrator is the designed synthetic voice in `promo/voice_auditions/segments/G/anchor.wav`. The owner's own reference recording is for calibration only, unless the owner explicitly says otherwise.
- **Do not use:**
  - Piper/VITS «SA_dii» or other Piper voices
  - paid APIs or new accounts
  - time-stretching, pitch-shifting or "humanizing" post-processing
- **Commercial use must be legal:** VoxCPM2 and Fasee7 are Apache-2.0. Habibi-TTS SAU is non-commercial.
- **Visible captions stay normal Arabic.** Hidden pronunciation spellings go only into the TTS input.

## Workflow for new or changed lines
1. **Write the TTS line:**
   - style prefix: `(calm, conversational, <intent>)`;
   - «…» at native pause points, «،» for short ones;
   - «.» on explanatory payoffs (not «!»);
   - hidden spellings from RECIPE §3 («گ» for Najdi ق, «المُتَخَفّي», «أغلبْكُم», «إنْمَسَكْ.», «تدْخلون», «بصابعك»).
2. **Generate 3 seeds** on CPU. Pattern: `promo/voice_auditions/prosody/gen_recipe.py` / `gen_round*.py`. Model: `openbmb/VoxCPM2` + LoRA `Wittify/Fasee7-Najdi-Small` (config from its `lora_config.json`), `cfg_value=2.0`, `inference_timesteps=20`, `reference_wav_path=segments/G/anchor.wav`, `torch.manual_seed(seed*100+80)`. It needs ~9.5 GB RAM, so run it alone.
3. **Screen, don't rank:**
   - run `prosody/analyze.py <dir>` (MMS forced alignment + pauses + contour), then `prosody/screen.py <dir>/results.jsonl`;
   - drop takes with missing or drifted words («الآن», «الذي», «خليك», «المتختفي», «يقلتكم») or a missing native pause;
   - optionally run `prosody/predict.py` (timing vs the owner's reading) to *order* a shortlist, and say plainly that it is only 3/7 accurate.
4. **Send the passing takes** to the owner (loudness-matched MP3, neutral names). Log any prediction *before* they listen. Record verdicts in `LISTENING_NOTES.md`.
5. **Diagnose before changing anything:**
   - wrong sound → hidden spelling;
   - right sound, wrong stress/contour/pause → style prompt, «…»/«،», seed, or (rarely) a phrase split;
   - accent not Saudi → reject the engine;
   - payoff swallowed or shouted → the pause before it plus «.».
6. **Assemble** with the owner's measured pauses between lines: `prosody/assemble_draft.py`, targets in `prosody/reference/owner_targets.json`.

## Current final voiceover
Owner-picked per-line takes: `promo/voice_auditions/segments/R_picks/NN.wav`, each with a `.json` holding the exact text, style and seed. The confirmed narration is `promo/voice_auditions/narration_draft2_R.mp3` (60.1 s). The video uses it via `promo/audio/narration_picks.py`.
