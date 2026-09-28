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
