"""Voice C: Nabra-Saudi-82M (oddadmix, Apache-2.0) — Kokoro/StyleTTS2 model
fine-tuned on Saudi-dialect speech, with its single built-in voice `af_msa`.

Usage: python gen_nabra.py OUT_DIR [--speed S] [segment numbers...]
Writes OUT_DIR/NN.wav (24 kHz mono). `speed` is the model's own duration
control at synthesis time (not post-processing time-stretch).
The model card advises NOT adding MSA tashkeel, so text is fed as written.
"""
import sys, os, argparse, numpy as np, soundfile as sf
from huggingface_hub import snapshot_download
from script import CAPTIONS
from hidden_script import HIDDEN

SPOKEN = dict(enumerate(CAPTIONS, 1))
# Model reads dialect spelling as written; guillemets removed only.
SPOKEN = {i: t.replace("«", "").replace("»", "") for i, t in SPOKEN.items()}
# Minimal hidden fixes where espeak's Arabic G2P imposes MSA endings/vowels
# (checked by inspecting phonemes + Whisper): sukun to drop the MSA "-na" ending,
# kasra for the dialect vowel.
SPOKEN.update({
    3: "تِدْخِلونْ من جوالاتكم، بدون تحميل ولا تسجيل.",
    5: "ثلاثة… اثنين… واحد… اِرْفَعوا!",
    8: "تصوّتونْ للشخص اللي شاكّينْ فيه… وإذا أغلبكم اختاره، انمسك.",
})
SPEED = {i: 1.0 for i in SPOKEN}

ap = argparse.ArgumentParser()
ap.add_argument("out"); ap.add_argument("segs", nargs="*", type=int)
ap.add_argument("--speed", type=float, default=1.0)
ap.add_argument("--hidden", action="store_true", help="use the approved hidden script verbatim (C2)")
a = ap.parse_intermixed_args(); os.makedirs(a.out, exist_ok=True)
if a.hidden:  # verbatim; only the «» quote marks are dropped (punctuation, not pronunciation)
    SPOKEN = {i: t.replace("«", "").replace("»", "") for i, t in enumerate(HIDDEN, 1)}

sys.path.insert(0, snapshot_download("oddadmix/Nabra-Saudi-82M",
    allow_patterns=["*.py", "*.json", "af_msa.pt", "nabra_saudi_82m_v0.pth"]))
from load_model import load
model, pipeline, voice = load(device="cpu")

for i in a.segs or list(SPOKEN):
    chunks = [r[2].numpy() for r in pipeline(SPOKEN[i], voice=voice, speed=SPEED[i] * a.speed)]
    sf.write(os.path.join(a.out, f"{i:02d}.wav"), np.concatenate(chunks), 24000)
    print("done", i, flush=True)
