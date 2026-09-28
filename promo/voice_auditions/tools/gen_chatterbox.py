"""Voice B: NAMAA-Saudi-TTS (Saudi-dialect fine-tune of Chatterbox Multilingual,
MIT) with Chatterbox's built-in default voice (no reference audio / no cloning).

Usage: python gen_chatterbox.py OUT_DIR [--stock] [--seed N] [segment numbers...]
  --stock  use the stock ResembleAI Chatterbox Multilingual T3 instead of NAMAA.
Writes OUT_DIR/NN.wav (24 kHz mono). CPU is fine (~1-2 min per segment).
"""
import sys, os, argparse, torch, numpy as np, soundfile as sf
from huggingface_hub import snapshot_download
from safetensors.torch import load_file
from chatterbox import mtl_tts
from script import CAPTIONS
from hidden_script import HIDDEN

# Hidden spellings (light diacritics only on words the model tends to misread).
SPOKEN = dict(enumerate(CAPTIONS, 1))
SPOKEN.update({
    2: "هذي… خَلِّك طَبيعي… لعبة جماعية، وواحد فيكم ما يدري وش المطلوب.",
    8: "تصوّتون للشخص اللي شاكّين فيه… وإذا أغلبكم اختاره، اِنْمَسَك.",
    12: ["الحين السؤال… تقدر؟", "خَلِّك طَبيعي!"],  # two phrases, short beat between
})
# (exaggeration, cfg_weight) per segment: calm-conversational baseline,
# a bit more energy on the hook, countdown, fast lines and the ending.
STYLE = {i: (0.55, 0.40) for i in SPOKEN}
STYLE.update({1: (0.65, 0.35), 5: (0.70, 0.35), 9: (0.60, 0.35), 12: (0.65, 0.40)})

# Base seed of the take kept for each segment (several seeds were auditioned;
# the take with the fewest garbled words, per Whisper + listening proxy, was kept).
SEEDS = {1: 202, 2: 302, 3: 101, 4: 7, 5: 7, 6: 101, 7: 7, 8: 101, 9: 101, 10: 101, 11: 101, 12: 202}

# Same, for the approved hidden script (voice F).
SEEDS_HIDDEN = {1: 7, 2: 404, 3: 7, 4: 404, 5: 7, 6: 303, 7: 7, 8: 101, 9: 7, 10: 7, 11: 101, 12: 7}

ap = argparse.ArgumentParser()
ap.add_argument("out"); ap.add_argument("segs", nargs="*", type=int)
ap.add_argument("--stock", action="store_true")
ap.add_argument("--hidden", action="store_true", help="use the approved hidden script verbatim (F)"); ap.add_argument("--seed", type=int, default=None)
a = ap.parse_intermixed_args(); os.makedirs(a.out, exist_ok=True)
if a.hidden:  # verbatim; «» dropped; 12 split at the scripted pause after «تقدر؟» (text unchanged)
    SPOKEN = {i: t.replace("«", "").replace("»", "") for i, t in enumerate(HIDDEN, 1)}
    SPOKEN[12] = [HIDDEN[11].split("؟")[0] + "؟", HIDDEN[11].split("؟")[1].strip()]

torch.set_num_threads(os.cpu_count())
model = mtl_tts.ChatterboxMultilingualTTS.from_pretrained(device="cpu")
if not a.stock:
    ck = snapshot_download("NAMAA-Space/NAMAA-Saudi-TTS")
    model.t3.load_state_dict(load_file(f"{ck}/t3_mtl23ls_v2.safetensors", device="cpu"))
    model.t3.eval()

for i in a.segs or list(SPOKEN):
    torch.manual_seed((a.seed if a.seed is not None else (SEEDS_HIDDEN if a.hidden else SEEDS)[i]) + i)
    ex, cfg = STYLE[i]
    parts = SPOKEN[i] if isinstance(SPOKEN[i], list) else [SPOKEN[i]]
    audio = []
    for k, text in enumerate(parts):
        x = model.generate(text, language_id="ar", exaggeration=ex, cfg_weight=cfg,
                           temperature=0.8).squeeze(0).numpy()
        if len(parts) > 1:  # trim edge silence of sub-phrases, keep a short natural beat
            idx = np.where(np.abs(x) > 10 ** (-45 / 20) * np.abs(x).max())[0]
            x = x[max(idx[0] - 1200, 0):idx[-1] + 1200]
            if k < len(parts) - 1: x = np.concatenate([x, np.zeros(int(0.35 * model.sr), np.float32)])
        audio.append(x)
    sf.write(os.path.join(a.out, f"{i:02d}.wav"), np.concatenate(audio), model.sr)
    print("done", i, flush=True)
