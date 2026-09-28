"""Sanity proxy: transcribe each segment with Whisper and print it next to the
caption, with a rough character error rate (diacritics/punctuation stripped).
Usage: python check_whisper.py SEG_DIR [segment numbers...]"""
import sys, re, difflib
from faster_whisper import WhisperModel
from script import CAPTIONS

def norm(t):
    t = re.sub(r"[ً-ْـ«»…،,.!?؟]", "", t)
    t = re.sub("[إأآ]", "ا", t).replace("ة", "ه").replace("ى", "ي")
    return re.sub(r"\s+", " ", t).strip()

m = WhisperModel("large-v3-turbo", device="cpu", compute_type="int8")
segs = [int(a) for a in sys.argv[2:]] or range(1, 13)
for i in segs:
    out = " ".join(s.text for s in m.transcribe(f"{sys.argv[1]}/{i:02d}.wav", language="ar", beam_size=5)[0])
    a, b = norm(CAPTIONS[i-1]), norm(out)
    cer = 1 - difflib.SequenceMatcher(None, a, b).ratio()
    print(f"{i:02d} cer={cer:.2f} | {out.strip()}", flush=True)
