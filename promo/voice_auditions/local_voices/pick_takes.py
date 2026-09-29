"""Pick the local takes whose delivery is closest to Voice 4 (measure only; the audio is never modified).
Per take, against the Voice 4 reading of the same line:
  timing  - mean |word length difference| after scaling both to the same total length (s)
  melody  - correlation of word-average pitch (mean-centred, semitones, octave errors folded)
  pauses  - mean |pause difference| at every word gap (s)
Rank = average of the three ranks; the owner hears the top ones.
Usage: python pick_takes.py TAKES_DIR [top=2] > picks.json"""
import glob, json, os, sys, numpy as np
from transplant import load, align, words_of, fix_octaves, SR
import parselmouth

H = os.path.dirname(os.path.abspath(__file__)); R = os.path.join(H, "..", "segments", "R_picks")
def target_of(n): return os.path.join(H, "..", "elevenlabs", "voice4_lines", f"F1_{n}_calm.mp3")

def profile(path, words):
    y = load(path); sp = align(y.astype(np.float32), words)
    ws = [[(s, e) for wi, s, e in sp if wi == i] for i in range(len(words))]
    st = [w[0][0] for w in ws]; en = [w[-1][1] for w in ws]
    p = parselmouth.Sound(y, SR).to_pitch(time_step=0.01, pitch_floor=75, pitch_ceiling=500)
    f = fix_octaves(p.selected_array["frequency"]); t = p.xs()
    mel = []
    for a, b in zip(st, en):
        m = (t >= a) & (t <= b) & (f > 0)
        mel.append(np.mean(12 * np.log2(f[m] / 100)) if m.any() else np.nan)
    return dict(dur=np.array(en) - np.array(st), gaps=np.array(st[1:]) - np.array(en[:-1]), mel=np.array(mel), total=en[-1] - st[0])

def score(tp, pp):
    d = np.mean(np.abs(pp["dur"] * tp["total"] / pp["total"] - tp["dur"]))
    a, b = tp["mel"] - np.nanmean(tp["mel"]), pp["mel"] - np.nanmean(pp["mel"]); ok = ~np.isnan(a) & ~np.isnan(b)
    c = float(np.corrcoef(a[ok], b[ok])[0, 1]) if ok.sum() > 2 else 0.0
    g = float(np.mean(np.abs(np.clip(pp["gaps"], 0, None) - np.clip(tp["gaps"], 0, None)))) if len(tp["gaps"]) else 0.0
    return dict(timing=round(float(d), 3), melody=round(c, 3), pauses=round(g, 3))

if __name__ == "__main__":
    top = int(sys.argv[2]) if len(sys.argv) > 2 else 2; out = {}
    files = sorted(glob.glob(os.path.join(sys.argv[1], "F4_*.wav")))
    for n in sorted({os.path.basename(f).split("_")[1] for f in files}):
        words = words_of(json.load(open(os.path.join(R, f"{n}.json")))["phrases"][0])
        tp = profile(target_of(n), words); rows = []
        for f in [f for f in files if os.path.basename(f).split("_")[1] == n]:
            rows.append(dict(take=os.path.basename(f), **score(tp, profile(f, words))))
        for k, rev in (("timing", False), ("melody", True), ("pauses", False)):
            for r_, row in enumerate(sorted(rows, key=lambda r: r[k], reverse=rev)): row[k + "_rank"] = r_ + 1
        for row in rows: row["rank"] = round((row["timing_rank"] + row["melody_rank"] + row["pauses_rank"]) / 3, 2)
        rows.sort(key=lambda r: r["rank"]); out[n] = dict(all=rows, picks=[r["take"] for r in rows[:top]])
    json.dump(out, sys.stdout, indent=1)
