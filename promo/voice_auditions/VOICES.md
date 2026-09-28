# Voice auditions — «خلك طبيعي» promo narration

Three complete narrations of the 12-segment script. Each one uses a different engine and model, and only built-in or default voices (no cloning and no Piper/VITS).
Files: `voice_A.mp3`, `voice_B.mp3`, `voice_C.mp3` (48 kHz mono MP3, 160 kbps, peak-normalized to −1 dBFS; no other processing and no time-stretch).
Per-segment WAVs: `segments/<A|B|C>/01.wav … 12.wav`. Generators: `tools/` (`script.py` holds the captions and pauses, `join.py` assembles the narration, `check_whisper.py` is a transcription sanity check).

Voices are listed alphabetically; they are not ranked.

## Network check (2026-09-28)

| Host | Result |
|---|---|
| `huggingface.co` API (`/api/models/ResembleAI/chatterbox`) | 200 OK |
| `huggingface.co/.../resolve/main/conds.pt` → CDN redirect (`us.aws.cdn.hf.co` xet-bridge) | 200 OK |
| `speech.platform.bing.com` (`edge-tts --list-voices`) | OK — `ar-SA-HamedNeural`, `ar-SA-ZariyahNeural` listed (edge-tts needs the proxy CA bundle via `SSL_CERT_FILE`) |
| `download.pytorch.org` (CPU wheels) | 200 OK |
| `pypi.org` | OK |

(`NETWORK.md` from the earlier blocked attempt is superseded by this section.)

## Voice A

- **Engine / model:** Microsoft Edge "Read Aloud" neural TTS via `edge-tts` 7.2.8 (Azure neural voice)
- **Voice:** `ar-SA-HamedNeural` (male, Saudi Arabic)
- **Runtime:** 55.0 s
- **Free or paid:** free (unofficial, unauthenticated Edge read-aloud endpoint; no account)
- **Commercial use / license:** **not clearly licensed for commercial use.** The endpoint is Microsoft's Edge browser read-aloud service, and these outputs are Azure neural voices. Commercial use would normally go through official Azure AI Speech, which has a free F0 tier under its own terms.
- **Engine settings:** the engine's own rate was raised to +15% (+10% on 5 and 12, +18% on 10, +20% on 9), with pitch +2 to +3 Hz. At the default rate this voice runs about 58 s for this script.
- **Hidden pronunciation spellings** (the captions are unchanged):
  - `…` becomes `،` everywhere, because Edge renders `…` as roughly 1 s of dead air.
  - Segment 2: `خلك طبيعي` becomes `خَلِّك طَبيعي`, and the «» quotes are dropped in favour of commas.
  - Segment 4: `المطلوب` becomes `المطلوبْ` and `المتخفي` becomes `المتخفّي`. Without this, Edge added an MSA ending («المطلوبة»).
  - Segment 8: `انمسك` becomes `اِنْمَسَك`, synthesized as its own short phrase after a 0.25 s beat. Inside the long sentence, the «م» was being swallowed («انسك»).
  - Segment 10: `المتخفي` becomes `المتخفّيْ`, to stop the MSA ending «المتخفيةُ».
  - Segment 12: `خلك طبيعي` becomes `خَلِّك طَبيعي`.

## Voice B

- **Engine / model:** [NAMAA-Space/NAMAA-Saudi-TTS](https://huggingface.co/NAMAA-Space/NAMAA-Saudi-TTS). This is a Saudi-dialect fine-tune of the T3 model inside [Chatterbox Multilingual](https://huggingface.co/ResembleAI/chatterbox), run with `chatterbox-tts` 0.1.7 on CPU.
- **Voice:** Chatterbox's built-in default voice (`conds.pt` shipped with ResembleAI/chatterbox); no reference audio.
- **Runtime:** 43.0 s
- **Free or paid:** free (open weights, runs locally)
- **Commercial use / license:** MIT (NAMAA fine-tune) and MIT (Chatterbox base). Both permit commercial use. Chatterbox embeds an imperceptible Perth watermark in its output.
- **Engine settings:** `language_id="ar"`, `temperature=0.8`, and exaggeration/cfg_weight of 0.55/0.40 by default. Segment 1 uses 0.65/0.35, segment 5 uses 0.70/0.35, segment 9 uses 0.60/0.35 and segment 12 uses 0.65/0.40. Several seeds were generated for each segment, and the take with the fewest garbled words was kept. The chosen seeds are recorded in `tools/gen_chatterbox.py`.
- **Hidden pronunciation spellings:**
  - Segment 2: `هذي «خلك طبيعي»…` becomes `هذي… خَلِّك طَبيعي…`.
  - Segment 8: `انمسك` becomes `اِنْمَسَك`.
  - Segment 12: `خلك طبيعي` becomes `خَلِّك طَبيعي`, synthesized as two phrases («الحين السؤال… تقدر؟» and «خَلِّك طَبيعي!») with a 0.35 s beat between them.

## Voice C

- **Engine / model:** [oddadmix/Nabra-Saudi-82M](https://huggingface.co/oddadmix/Nabra-Saudi-82M), a Kokoro-82M/StyleTTS2 model fine-tuned on about 146 h of single-speaker Saudi-dialect speech (checkpoint `nabra_saudi_82m_v0.pth`), run on CPU. It uses espeak-ng for Arabic grapheme-to-phoneme conversion.
- **Voice:** `af_msa`, the model's single built-in voice (female)
- **Runtime:** 43.5 s
- **Free or paid:** free (open weights, runs locally)
- **Commercial use / license:** Apache-2.0 (the model card also credits Kokoro-82M, Apache-2.0, and StyleTTS2, MIT). This permits commercial use.
- **Engine settings:** speed 1.0 (the model's default). The model card advises feeding dialect text without full tashkeel, so text goes in as written except for the fixes listed below.
- **Hidden pronunciation spellings:**
  - The «» quotes are removed everywhere.
  - Segment 3: `تدخلون` becomes `تِدْخِلونْ`. espeak had produced the MSA form «tadakhkhulūna».
  - Segment 5: `ارفعوا` becomes `اِرْفَعوا`, because the plain spelling came out as «أرفع».
  - Segment 8: `تصوّتون` becomes `تصوّتونْ` and `شاكّين` becomes `شاكّينْ`. The sukun drops the MSA «-na» ending that espeak adds.

---

# Round 2: C2, D, E and F (approved hidden script)

All four read the owner-approved hidden pronunciation script **verbatim** (`tools/hidden_script.py`): the tashkeel is kept, nothing is normalized to MSA and no dialect word is rewritten. The only change is dropping the «» quote marks, which are punctuation. The visible captions are not part of this and remain plain Arabic.
Output format is the same as round 1: 48 kHz mono MP3 at 160 kbps, peak-normalized, with no time-stretch and no other processing. Per-segment WAVs are in `segments/<C2|D|E|F>/`.
Voices are listed by letter; they are not ranked.

**How the voice is kept consistent without cloning anyone (D and E):** these engines have no fixed built-in speaker. For each one, a voice was *designed* from a text description (no reference audio). It was rendered once on a short anchor line that is not part of the script («هلا والله! اليوم عندي لكم لعبة حلوة مرة، تعالوا أعلمكم عليها.»). That synthetic `anchor.wav` (kept in `segments/D` and `segments/E`) was then used as the voice prompt for all 12 segments.

**Network (2026-09-28, round 2):** Hugging Face, `download.pytorch.org` and PyPI were all reachable. Reddit is blocked for the research tools used here, and TikTok is not searchable, so the evidence below comes from X, Hugging Face, GitHub and vendor/official pages.

## C2: Nabra-Saudi-82M, regenerated

- **Provider / model:** [oddadmix/Nabra-Saudi-82M](https://huggingface.co/oddadmix/Nabra-Saudi-82M), a Kokoro-82M/StyleTTS2 model fine-tuned on about 146 h of single-speaker Saudi speech (`nabra_saudi_82m_v0.pth`), run on CPU
- **Voice:** `af_msa`, the model's single built-in voice (female)
- **Runtime:** 45.4 s
- **Free or paid:** free (open weights, runs locally)
- **Commercial use / license:** Apache-2.0. Commercial use is allowed.
- **Settings:** speed 1.0. `tools/gen_nabra.py --hidden`
- **Evidence:** [model card](https://huggingface.co/oddadmix/Nabra-Saudi-82M) and [82M vs 7M demo Space](https://huggingface.co/spaces/oddadmix/Nabra-Saudi-Demo). The same author's [Nabra-2 demo](https://huggingface.co/spaces/oddadmix/Nabra-2-Demo) and an upstream [sherpa-onnx integration request](https://github.com/k2-fsa/sherpa-onnx/issues/3897) are also relevant. No first-hand comments from Saudi users were found. This one is here because you asked for it, not because of community feedback.

## D: Lahgtna-OmniVoice-v2, «لهجتنا»

- **Provider / model:** [oddadmix/lahgtna-omnivoice-v2](https://huggingface.co/oddadmix/lahgtna-omnivoice-v2), a fine-tune of [k2-fsa/OmniVoice](https://huggingface.co/k2-fsa/OmniVoice) covering 13 Arabic dialects. It was run with the `lahgtna-omnivoice` 0.1.5 package using its Saudi dialect id `"sa"` ("Saudi Lahgtna"), with 32 steps and guidance 2.0, on CPU.
- **Voice:** a designed voice with attributes `male, young adult, moderate pitch`. It is carried across segments by the synthetic anchor described above (seed 11).
- **Runtime:** 54.2 s. The model's own pacing is slow; the speech alone is about 48.5 s. The model has a native `speed` option that was not used.
- **Free or paid:** free (open weights, runs locally)
- **Commercial use / license:** **non-commercial.** The fine-tune has no license tag of its own. Its base, the OmniVoice pre-trained weights, is CC-BY-NC because of its training data, and the audio tokenizer is under the Boson Higgs Audio 2 Community License. The `lahgtna-omnivoice` code is Apache-2.0.
- **Settings:** `tools/gen_omnivoice.py`
- **Evidence:** the [model](https://huggingface.co/oddadmix/lahgtna-omnivoice-v2) (about 500 downloads, 11 likes), a [public demo Space](https://huggingface.co/spaces/oddadmix/Lahgtna-OmniVoice-Demo) and the [GitHub repo](https://github.com/Oddadmix/Lahgtna-OmniVoice). There is also third-party reuse: [Rabe3/saudi-xtts-v2](https://huggingface.co/Rabe3/saudi-xtts-v2) was trained on Saudi speech synthesized with this model, and there are community dialect forks such as [ehabnegm/lahgtna-omnivoice-egyptian-v3](https://huggingface.co/ehabnegm/lahgtna-omnivoice-egyptian-v3). The earlier [Lahgtna Chatterbox](https://huggingface.co/oddadmix/lahgtna-chatterbox-v1) has 16 likes.

## E: Fasee7-Najdi-Small (VoxCPM2 + Najdi LoRA)

- **Provider / model:** [Wittify/Fasee7-Najdi-Small](https://huggingface.co/Wittify/Fasee7-Najdi-Small), a Najdi LoRA (r=32) from Wittify.ai, applied to [openbmb/VoxCPM2](https://huggingface.co/openbmb/VoxCPM2). It was run with `voxcpm` on CPU, with cfg 2.0 and 20 timesteps as the model card recommends.
- **Voice:** designed with VoxCPM2 voice design using the description `(A young adult Saudi man, warm, friendly and playful, relaxed and confident, conversational)`. It is carried across segments by the synthetic anchor described above (seed 21). Output is 48 kHz.
- **Runtime:** 51.7 s
- **Free or paid:** free (open weights, runs locally)
- **Commercial use / license:** Apache-2.0 (Fasee7 LoRA) and Apache-2.0 (VoxCPM2). Commercial use is allowed.
- **Settings:** `tools/gen_voxcpm.py`
- **Evidence:** the [model card](https://huggingface.co/Wittify/Fasee7-Najdi-Small), which says it is trained on an in-house conversational Najdi dataset and released in June 2026. Wittify.ai also makes regional-Arabic voices commercially with [Rime](https://www.rime.ai/resources/rime-wittify). VoxCPM2 itself has about 1.6k likes and about 390k downloads on HF. No first-hand comments from Saudi users on this LoRA were found; it is very new, with about 100 downloads.

## F: NAMAA-Saudi-TTS

- **Provider / model:** [NAMAA-Space/NAMAA-Saudi-TTS](https://huggingface.co/NAMAA-Space/NAMAA-Saudi-TTS), a Saudi-dialect fine-tune of the Chatterbox Multilingual T3 model (0.5B). It was run with `chatterbox-tts` 0.1.7 on CPU. This is the same model as round-1 voice B, re-run on the approved script.
- **Voice:** Chatterbox's built-in default voice (`conds.pt`); no reference audio
- **Runtime:** 44.5 s
- **Free or paid:** free (open weights, runs locally)
- **Commercial use / license:** MIT (NAMAA) and MIT (Chatterbox). Commercial use is allowed. The output carries Chatterbox's inaudible Perth watermark.
- **Settings:** the same per-segment exaggeration/cfg as voice B. Segment 12 is generated as two phrases split at the scripted pause after «تِقْدَر؟», with the text unchanged. Several seeds were generated per segment and the best take was kept; the seeds are recorded in `SEEDS_HIDDEN` in `tools/gen_chatterbox.py --hidden`.
- **Evidence:** this is the Saudi open model with the most first-hand posts from Saudi users on X:
  - [@alghali](https://x.com/alghali/status/2024111820978442591): «كلام سعودي طبيعي كأنك تسولف»
  - [@muslehNayesh](https://x.com/muslehNayesh/status/2024181386266235104): «يعطي نبرة وتنغيم طبيعيين ولهجة سعودية مضبوطة»
  - [@sulimanalowayed](https://x.com/sulimanalowayed/status/2024148304854962236)
  - [@OsMo999](https://x.com/OsMo999/status/2024092360519332191)

  It also has a [public demo Space](https://huggingface.co/spaces/omarelshehy/NAMAA-Saudi-Voice) and is hosted on [TTS.ai](https://tts.ai/text-to-speech/?model=saudi-tts). There is a critical user report too: HF discussion ["The synthesized voice is too fast"](https://huggingface.co/NAMAA-Space/NAMAA-Saudi-TTS/discussions).

## Researched but not generated

- **Needs an account, API key or payment, so not auditioned here.** These are for you to try directly if you want to:
  - [SILMA TTS v2 KSA](https://silma.ai/saudi-tts-model): Najdi, API-only, paid from $0.025/min, sign-up required for "Try Now"
  - [Nabrah AI](https://www.nabrah.ai/): Riyadh-based, Saudi-dialect TTS and voice agents
  - [ElevenLabs Saudi voices](https://elevenlabs.io/text-to-speech/arabic)
  - [Lahajati](https://lahajati.ai/en)
  - Munsit
  - Rime × Wittify
- **Open, but only reach a Saudi voice by cloning a reference speaker (excluded by the no-cloning rule):**
  - [Habibi-TTS SAU](https://huggingface.co/SWivid/Habibi-TTS) (CC-BY-NC-SA; a Saudi user [post on X](https://x.com/muslehNayesh/status/2028873731171324248))
  - [NAMAA-Saudi-TTS-V2](https://huggingface.co/NAMAA-Space/NAMAA-Saudi-TTS-V2)
  - [khalidhabbash/Saudi-tts-v4](https://huggingface.co/khalidhabbash/Saudi-tts-v4)
  - [mobarmg/OmniVoice-Najdi](https://huggingface.co/mobarmg/OmniVoice-Najdi): single real podcast speaker; its auto voice drifts to that person
  - [Rabe3/saudi-xtts-v2](https://huggingface.co/Rabe3/saudi-xtts-v2)

---

# Round 3: casual voices for everyday listeners, one sample at a time

Feedback on round 2 was that none of the voices worked; the brief is now **casual, for normal people, and female voices are welcome**.

**What people actually use and recommend.** This was researched on Arabic reviews, X, TikTok discovery pages, vendor pages and HF. Reddit and TikTok content can't be fetched from here.
- **ElevenLabs**
  - A hands-on Arabic comparison ([the-aicity, Sep 2026](https://www.the-aicity.com/2026/09/arabic-text-to-speech-ai-tools.html)) called it «the closest to human voice in our experience».
  - Its voice library includes Saudi/casual female voices (e.g. "Hana – casual & relaxed", Heba Mansuri) ([list](https://json2video.com/ai-voices/elevenlabs/languages/arabic/)).
  - TikTok creators share "best ElevenLabs Arabic voice" picks ([TikTok discover](https://www.tiktok.com/discover/best-voice-for-eleven-labs-arab)).
  - Free tier: 10k credits/month, but free-tier output is not licensed for commercial use.
- **Lahajati**
  - The same review rated it as natural as ElevenLabs and the best for **Saudi/Najdi dialect control** ([lahajati.ai](https://lahajati.ai/en)).
  - Free: 10k points/month.
- **Gemini TTS** (Google AI Studio): free; controllable by style prompts (e.g. "casual, chatty"). Reviewers found it less natural than the two above for casual delivery.
- **Fish Audio**: popular community "بنت سعودية" voices ([example](https://fish.audio/m/384051d27069462aa9b7a021ce541c8f/)). These are user-uploaded clones of real people, so they are excluded under the no-cloning rule.
- **Blocked for me:** all four require an account or API key, and there is none in this environment. They can be auditioned as soon as a key is provided. The free Gemini API key is the easiest; ElevenLabs and Lahajati also have free keys.

## G: casual young Saudi woman (VoxCPM2 + Fasee7 Najdi LoRA)

- **Provider / model:** [Wittify/Fasee7-Najdi-Small](https://huggingface.co/Wittify/Fasee7-Najdi-Small) Najdi LoRA on [openbmb/VoxCPM2](https://huggingface.co/openbmb/VoxCPM2), run on CPU with cfg 2.0 and 20 timesteps. This is the same engine as round-2 voice E, which had the cleanest transcription, but with a new casual female voice.
- **Voice:** designed from the description `(A young Saudi woman in her twenties, casual and chatty, warm, smiling, playful, talking to her friends, relaxed, not formal)`, rendered on the anchor line «هلا والله يا بنات! تعالوا أقولكم عن لعبة حلوة مرة، والله بتعجبكم.» (seed 32, kept as `segments/G/anchor.wav`). That anchor is the voice prompt for all segments. Median pitch is about 200–285 Hz on every segment, confirming a female voice (`tools/check_pitch.py`). Seed 31 of the same description came out male and was discarded.
- **Text:** the approved hidden script, verbatim.
- **Seeds:** segments 1–4 and 6–12 use `--seed 32`. Segment 5 was re-taken with `--seed 40` because the first take had a creaky low-pitch artifact.
- **Runtime:** 55.8 s at the model's natural pace, with no speed-up.
- **Free or paid:** free (open weights, runs locally)
- **Commercial use / license:** Apache-2.0 (LoRA) and Apache-2.0 (VoxCPM2). Commercial use is allowed.
