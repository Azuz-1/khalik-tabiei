"""Engine-specific pause correction for phrase-joined takes (used for VoxCPM, whose phrases carry long
low-level lead/tail silence that the generic trim keeps). The inserted gaps are exact digital zeros, so
we locate them and trim only the engine's own silence adjacent to each gap (threshold -40 dB re take peak,
keep 60 ms). No time-stretching; speech samples are untouched. Usage: python retrim_gaps.py IN.wav OUT.wav GAP_MS..."""
import sys, numpy as np, soundfile as sf
x, sr = sf.read(sys.argv[1], dtype="float32"); gaps = [int(g) for g in sys.argv[3:]]
thr = 10 ** (-40 / 20) * np.abs(x).max(); keep = int(0.06 * sr)
z = (x == 0).astype(np.int8); runs = []; i = 0
while i < len(x):
    if z[i]:
        j = i
        while j < len(x) and z[j]: j += 1
        if j - i >= int(min(gaps) / 1000 * sr * 0.9): runs.append((i, j))
        i = j
    else: i += 1
runs = runs[:len(gaps)]
parts, prev = [], 0
for a, b in runs:
    seg = x[prev:a]; loud = np.where(np.abs(seg) > thr)[0]
    end = min(len(seg), loud[-1] + keep) if len(loud) else len(seg)
    parts.append(seg[:end] if not parts else seg[:end]); parts.append(x[a:b]); prev = b
    # trim lead of next phrase
    nxt = x[prev:]; loud = np.where(np.abs(nxt) > thr)[0]
    prev += max(0, loud[0] - keep) if len(loud) else 0
parts.append(x[prev:])
sf.write(sys.argv[2], np.concatenate(parts), sr); print(len(runs), "gaps retrimmed")
