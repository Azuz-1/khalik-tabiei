"""Delivery check: compare each local take with the ElevenLabs original of the same voice and line.
Screen only (flags clearly flatter / faster / more pushed takes); the owner's ear decides.
Measures: speech length, pause total (gaps >= 150 ms), pitch range (p10-p90, semitones),
pitch movement (std, semitones) and loudness contrast (p90-p10 frame RMS, dB).
Usage: python delivery_check.py TAKES_DIR > report.tsv"""
import glob, os, sys, numpy as np, librosa

H = os.path.dirname(os.path.abspath(__file__)); EL = os.path.join(H, "..", "elevenlabs")
REF = {"F4": lambda n: os.path.join(EL, "voice4_lines", f"F1_{n}_calm.mp3"),
       "M2": lambda n: os.path.join(EL, "own_lines", f"M_{n}_calm.mp3")}

def feats(p):
    y, sr = librosa.load(p, sr=16000)
    y, _ = librosa.effects.trim(y, top_db=40)
    rms = librosa.feature.rms(y=y, frame_length=400, hop_length=160)[0]; db = 20 * np.log10(rms + 1e-6)
    sil = db < db.max() - 35
    runs, c = [], 0
    for s in sil:
        if s: c += 1
        elif c: runs.append(c); c = 0
    pause = sum(r for r in runs if r * 0.01 >= 0.15) * 0.01
    f0, v, _ = librosa.pyin(y, fmin=70, fmax=500, sr=sr, frame_length=1024, hop_length=160)
    st = 12 * np.log2(f0[v & ~np.isnan(f0)] / 100.0)
    return dict(dur=len(y) / sr, pause=pause, rng=np.percentile(st, 90) - np.percentile(st, 10) if len(st) > 20 else np.nan,
                mov=np.std(st) if len(st) > 20 else np.nan, dyn=np.percentile(db[~sil], 90) - np.percentile(db[~sil], 10))

if __name__ == "__main__":
    cache = {}
    print("take\tspeech_s(ref)\tpause_s(ref)\trange_st(ref)\tmove_st(ref)\tloud_dB(ref)\tflags")
    for f in sorted(glob.glob(os.path.join(sys.argv[1], "*.wav"))):
        v, n = os.path.basename(f).split("_")[:2]
        if (v, n) not in cache: cache[(v, n)] = feats(REF[v](n))
        r, t = cache[(v, n)], feats(f); fl = []
        if t["dur"] > 1.25 * r["dur"]: fl.append("slower")
        if t["dur"] < 0.8 * r["dur"]: fl.append("faster")
        if t["rng"] < 0.7 * r["rng"]: fl.append("flatter")
        if t["rng"] > 1.4 * r["rng"]: fl.append("more pushed")
        if t["pause"] < 0.5 * r["pause"]: fl.append("missing pauses")
        print(os.path.basename(f), *[f"{t[k]:.2f}({r[k]:.2f})" for k in ("dur", "pause", "rng", "mov", "dyn")], ",".join(fl) or "ok", sep="\t")
