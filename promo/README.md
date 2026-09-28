# خلك طبيعي — promo video (source project)

The finished film is **`out/khalik-tabiei-promo.mp4`**. It is vertical 1080×1920 (9:16), 30 fps,
H.264 + AAC, **1:02**, 19 MB. It has a natural Saudi (light Najdi) voiceover, a word-timed Arabic
transcript burned in along the lower third (clear of the TikTok/Reels/Shorts UI), a music bed and the
game's sound effects. It is ready for TikTok, Instagram Reels and YouTube Shorts.

This folder is self-contained and separate from the game. Nothing in `server/`,
`client/` or `shared/` was changed, and the root `npm` workspaces don't include it.

## What the film shows

Every phone and TV screen in the film is a **real capture of the running game**.
`capture/capture.mjs` boots the unmodified server and plays a full 5-player match
with Playwright: owner فهد plus نورة، سعود، ريم، خالد on phones, and a paired TV.
The story in the ad is the game that was actually played:

| Challenge | Mode | Prompt (from the game's bank) | What happened |
| --- | --- | --- | --- |
| 1 | 🙋 ارفع يدك | ارفع يدك إذا قلت «أنا بالطريق» وأنت للحين بالبيت. | سعود is the impostor and survives (2/5 votes) |
| 2 | 🔢 ارفع أصابعك | من آخر 5 أيام، كم يوم شربت قهوة؟ | Same impostor. The majority (3/5) catches سعود |
| 3 | 👉 أشر على شخص | أشر على اللي ممكن ينام بنص الفيلم. | نورة is the new impostor. Nobody catches her |

Final score: نورة 3 (first place), ريم 2, سعود 1, فهد 1, خالد 0. All scoring is computed
by the real engine. The capture seeds only the browser's *advisory* prompt history
(`kt_prompt_novelty`) so the server's normal freshness rules deal those three prompts.
Impostor choice and mode order stay random, and the script retries rooms until the
deal matches the storyboard.

The illustrated characters are drawn in the language of the game's own mark
(`client/src/ui/EyesMark.tsx`) and use the game's seat colours.

## Pipeline

```
capture/capture.mjs      real gameplay → assets/capture/*.webp
script/short.json        12 lines: caption phrases (plain Arabic) + the owner's pause after each line
audio/narration_picks.py the owner-confirmed voiceover (voice_auditions/segments/R_picks) →
                         build/vo/narration.wav + caption timing by forced alignment → build/timings.json
compositor/              deterministic HTML/SVG motion design; renderAt(t)
render/render.mjs        headless Chromium → frames → x264 (+ build/cues.json)
audio/score.py           original Khaleeji-style score in D Hijaz + SFX
                         (game SFX ported from client/src/audio/gameAudio.ts)
audio/mix.py             voice EQ/compression, music ducking, −14 LUFS / −1 dBTP
build.sh                 runs everything → out/khalik-tabiei-promo.mp4
```

Everything is free and open source and runs locally. No paid APIs were used.

* **Voice:** VoxCPM2 (OpenBMB, Apache-2.0) + the Fasee7-Najdi-Small LoRA (Wittify, Apache-2.0), with a
  designed casual young Saudi female voice (no real person cloned). Every line was chosen by the
  native-Saudi owner. The full recipe and learnings are in `voice_auditions/RECIPE.md`, and the
  project skill is `.claude/skills/saudi-voiceover`.
* **Caption timing:** MMS forced alignment (torchaudio) of the spoken words.
* **Font:** Tajawal (OFL, the game's own font), in `assets/fonts/`.

## Editing

* **Change the words:** edit `script/narration.json`. `cap` is the on-screen caption.
  `say` is the fully voweled spelling the voice reads. For example, `خَلِّكَ طَبِيعِي`
  is spelled this way so the game's name is pronounced correctly. Then run
  `bash build.sh`. Scene timing follows the new narration automatically.
* **Change visuals:** each scene is one block in `compositor/app.js`.
  To look at a single frame, run `node render/render.mjs --stills 12.5,40`.
* **Re-capture the game:** from the repo root, run `npm run build`, then
  `node promo/capture/capture.mjs` and `python3 promo/tools/optimize_captures.py`.
* **First-time setup:** `bash tools/setup.sh` installs the Python packages and
  downloads the voice and ASR models into `.models/`.
