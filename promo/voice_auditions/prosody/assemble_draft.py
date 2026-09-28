"""Assemble a DRAFT narration from per-line picks for one owner listening pass (not final).
Between lines: the owner's own measured pause after each line (reference/owner_targets.json).
Each take: engine edge silence trimmed (-40 dB re peak, 60 ms kept); no other processing.
Output: gain-normalized (-1 dBFS peak) 48 kHz mono MP3 + a JSON of which take was used per line.
Usage: python assemble_draft.py PICKS.json OUT.mp3"""
import sys, json, os, subprocess, numpy as np, soundfile as sf, librosa, imageio_ffmpeg
picks = json.load(open(sys.argv[1])); out = sys.argv[2]
T = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "reference/owner_targets.json")))["lines"]
SR = 48000; parts = []; log = []
for ln in range(1, 13):
    x, sr = sf.read(picks[str(ln)], dtype="float32")
    if sr != SR: x = librosa.resample(x, orig_sr=sr, target_sr=SR)
    thr = 10 ** (-40 / 20) * np.abs(x).max(); idx = np.where(np.abs(x) > thr)[0]; k = int(0.06 * SR)
    x = x[max(idx[0] - k, 0): idx[-1] + k]
    parts.append(x); gap = T[str(ln)]["pause_after_line_ms"] if ln < 12 else 0
    parts.append(np.zeros(int((gap or 0) / 1000 * SR), np.float32))
    log.append(dict(line=ln, take=picks[str(ln)], dur=round(len(x) / SR, 2), gap_after_ms=gap))
y = np.concatenate(parts); y *= 10 ** (-1 / 20) / np.abs(y).max()
tmp = out + ".wav"; sf.write(tmp, y, SR)
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-i", tmp, "-ac", "1", "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "160k", out], check=True)
os.remove(tmp); json.dump(log, open(out[:-4] + ".json", "w"), ensure_ascii=False, indent=1)
print(f"{out}: {len(y) / SR:.1f} s"); [print(l) for l in log]
