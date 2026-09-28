"""Blind audition pack: loudness-matched (gain only) 48 kHz mono MP3s under a neutral letter.
Gain: scale to -20 dBFS RMS, reduced if needed so the peak stays <= -1 dBFS. No other processing.
Usage: python make_pack.py SRC_DIR LETTER"""
import sys, os, glob, subprocess, numpy as np, soundfile as sf, imageio_ffmpeg
src, L = sys.argv[1], sys.argv[2]
dst = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "critical_lines", f"Candidate-{L}")
FF = imageio_ffmpeg.get_ffmpeg_exe()
def conv(wav, mp3):
    x, sr = sf.read(wav, dtype="float32")
    g = 10 ** (-20 / 20) / (np.sqrt(np.mean(x ** 2)) + 1e-9); g = min(g, 10 ** (-1 / 20) / (np.abs(x).max() + 1e-9))
    tmp = mp3 + ".wav"; sf.write(tmp, x * g, sr)
    subprocess.run([FF, "-y", "-loglevel", "error", "-i", tmp, "-ac", "1", "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "160k", mp3], check=True)
    os.remove(tmp)
for sub in ["", "pairs"]:
    os.makedirs(os.path.join(dst, sub), exist_ok=True)
    for w in sorted(glob.glob(os.path.join(src, sub, "*.wav"))):
        b = os.path.basename(w)[:-4]
        name = (f"seg{b[:2]}_take{b[-1]}" if not sub else f"seg{b[:2]}_{b[3:]}") + ".mp3"
        conv(w, os.path.join(dst, sub, name))
print(dst, len(glob.glob(os.path.join(dst, '*.mp3'))), len(glob.glob(os.path.join(dst, 'pairs', '*.mp3'))))
