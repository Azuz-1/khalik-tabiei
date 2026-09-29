"""Narration for the short cut from the owner-confirmed AI voiceover (no re-synthesis, no processing).

Input : voice_auditions/segments/R_picks/NN.wav (+ NN.json with the exact TTS text) — the 12 lines the
        owner picked; script/short.json (caption phrases + the owner's pause after each line).
Output: build/vo/narration.wav — the confirmed narration (= voice_auditions/narration_draft2_R.mp3):
        each line's engine edge-silence trimmed (-40 dB re peak, 60 ms kept), joined with the owner's
        own inter-line pauses; peak-normalised only (mix.py sets loudness). No EQ, compression,
        denoise, pause-tightening, time-stretch or pitch-shift (audio/voice.py is for human
        recordings and would shorten the calibrated pauses).
        build/timings.json — beats s1…s12 + caption chunks timed by forced alignment (MMS_FA) of the
        spoken words, so each caption phrase appears exactly while it is said.
Run with a Python that has torch/torchaudio(MMS_FA)/uroman/librosa (e.g. the voice-audition venv)."""
import json, os, re, sys
import numpy as np, soundfile as sf, librosa, torch, uroman
from torchaudio.pipelines import MMS_FA

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build"); SR = 48000
PICKS = os.path.join(ROOT, "voice_auditions", "segments", os.environ.get("PICKS", "R_picks"))  # PICKS=V4_picks for the ElevenLabs voice
S = json.load(open(os.path.join(ROOT, "script", "short.json")))
UR = uroman.Uroman(); FA = MMS_FA.get_model(with_star=False).eval(); TOK = MMS_FA.get_tokenizer(); ALN = MMS_FA.get_aligner()

def norm(t): return re.sub("[إأآ]", "ا", re.sub(r"[ً-ْـ«»…،,.!؟?]", "", t)).replace("ة", "ه").replace("ى", "ي")
def words_of(text): return [w for w in (norm(x) for x in re.sub(r"\([^)]*\)", " ", text).split()) if w]

def align(x48, words):
    y = librosa.resample(x48, orig_sr=SR, target_sr=16000).astype(np.float32)
    rom = ["".join(c for c in UR.romanize_string(w).lower() if c in MMS_FA.get_dict()) or "a" for w in words]
    with torch.inference_mode():
        em, _ = FA(torch.tensor(y)[None]); sp = ALN(em[0], TOK(rom))
    r = len(y) / em.shape[1] / 16000
    return [(s[0].start * r, s[-1].end * r) for s in sp]

os.makedirs(os.path.join(BUILD, "vo"), exist_ok=True)
t = S.get("lead_in", 0.12); pieces = [np.zeros(int(t * SR), np.float32)]
tm = {"beats": [], "chunks": [], "source": f"voice_auditions/segments/{os.path.basename(PICKS)} (owner-confirmed)"}
for i, seg in enumerate(S["segments"], 1):
    x, sr = sf.read(os.path.join(PICKS, f"{i:02d}.wav"), dtype="float32")
    if sr != SR: x = librosa.resample(x, orig_sr=sr, target_sr=SR)
    thr = 10 ** (-40 / 20) * np.abs(x).max(); idx = np.where(np.abs(x) > thr)[0]; k = int(0.06 * SR)
    x = x[max(idx[0] - k, 0): idx[-1] + k]
    spoken = words_of(" ".join(json.load(open(os.path.join(PICKS, f"{i:02d}.json")))["phrases"]))
    counts = [len(words_of(p)) for p in seg["phrases"]]
    if sum(counts) != len(spoken):
        sys.exit(f"{seg['id']}: caption words {sum(counts)} != spoken words {len(spoken)}")
    spans = align(x, spoken); b0 = t; w = 0
    for k2, (p, n) in enumerate(zip(seg["phrases"], counts)):
        a, b = spans[w][0], spans[w + n - 1][1]; w += n
        tm["chunks"].append({"id": f"{seg['id']}.{k2}", "beat": seg["id"], "cap": p, "start": round(t + a, 3), "end": round(t + b, 3)})
    pieces.append(x); t += len(x) / SR
    gap = float(seg.get("gap", 0.7)); pieces.append(np.zeros(int(gap * SR), np.float32)); t += gap
    tm["beats"].append({"id": seg["id"], "start": round(b0, 3), "end": round(t, 3)})
    print(f"{seg['id']}: {len(x) / SR:.2f}s  " + " | ".join(f"{c['cap']} {c['start']:.2f}-{c['end']:.2f}" for c in tm["chunks"] if c["beat"] == seg["id"]))
tail = S.get("tail", 1.3); pieces.append(np.zeros(int(tail * SR), np.float32))
y = np.concatenate(pieces); y = y / (np.abs(y).max() + 1e-9) * 0.89
sf.write(os.path.join(BUILD, "vo", "narration.wav"), y.astype(np.float32), SR)
tm["duration"] = round(len(y) / SR, 3)
json.dump(tm, open(os.path.join(BUILD, "timings.json"), "w"), ensure_ascii=False, indent=1)
print(f"narration {tm['duration']:.2f}s → build/vo/narration.wav, build/timings.json")
