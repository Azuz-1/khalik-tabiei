"""Join per-segment WAVs into one narration MP3 with natural pauses.

Usage: python join.py SEG_DIR OUT.mp3
Only trims leading/trailing silence of each segment, inserts the pauses from
script.GAPS, peak-normalizes to -1 dBFS, encodes 48 kHz mono MP3 160 kbps.
No time-stretching, EQ or compression.
"""
import sys, subprocess, numpy as np, soundfile as sf, imageio_ffmpeg
from script import GAPS

def trim(x, sr, thr_db=-45, pad=0.05):
    env = np.abs(x); thr = 10 ** (thr_db / 20) * max(env.max(), 1e-9)
    idx = np.where(env > thr)[0]
    if not len(idx): return x
    a = max(idx[0] - int(pad * sr), 0); b = min(idx[-1] + int(pad * sr), len(x))
    return x[a:b]

seg_dir, out = sys.argv[1], sys.argv[2]
parts, sr0 = [], None
for i, gap in enumerate(GAPS, 1):
    x, sr = sf.read(f"{seg_dir}/{i:02d}.wav", dtype="float32")
    if x.ndim > 1: x = x.mean(1)
    sr0 = sr0 or sr; assert sr == sr0
    x = trim(x, sr)
    f = int(0.01 * sr); x[:f] *= np.linspace(0, 1, f); x[-f:] *= np.linspace(1, 0, f)
    parts += [x, np.zeros(int(gap * sr), np.float32)]
y = np.concatenate(parts); y *= 10 ** (-1 / 20) / np.abs(y).max()
tmp = out + ".tmp.wav"; sf.write(tmp, y, sr0)
subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-i", tmp, "-ac", "1",
                "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "160k", out], check=True)
import os; os.remove(tmp)
print(f"{out}: {len(y)/sr0:.1f} s")
