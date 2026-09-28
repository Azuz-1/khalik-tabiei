# Owner's native reference reading: derived calibration targets

The owner recorded all 12 lines (57.8 s) for **calibration only**. The recording itself is **not stored in the repo** and is **not** used as a voice-cloning reference.
This folder holds only derived measurements:
- `owner_targets.json`: per line, word timings from forced alignment, pauses (adaptive threshold: noise floor + 6 dB), stress order, and rise/fall per word in semitones re the speaker median.
- `owner_lineNN.png`: pitch contours.

Produced by `../analyze_ref.py`.

## Key native patterns
- **8:** «فيه» | 220 ms | «وإذا أغلبكم اختار **المتخفي**↗(+4 st)» | 280 ms | «انمسك»↘(fall 2.9 st, *not* stressed). The payoff is explanatory, not exclaimed.
- **12:** «الحين السؤال» | **390 ms** | «تقدر»↗ | **320 ms** | «خلك طبيعي»↘.
- **5:** «ثلاثة اثنين» | 550 ms | «**واحد**»↗(+4.7 st, the peak) | 240 ms | «ارفع يدك»↘, low-key.
- **7:** «**المطلوب**»↗ (+4.6), short juncture, «**يشك**»↗ (+4.6, the accent), «بالثاني» low.
- **10:** «**المتخفي**»↗ … «نقاط» | **500 ms** | «وإذا قدر **يفلت**»↗(+5.5) … «هو اللي يكسب».
- **General:** the focus word before a boundary gets a continuation **rise**; the payoff after the boundary **falls** calmly.
- **Pace:** about 2.2–2.9 words/s, with 0.6–1.0 s between lines. The full script is ≈55 s at a natural pace.
