"""Median F0 (Hz) of WAV files: rough male (~85-155) / female (~165-255) check.
Usage: python check_pitch.py a.wav [b.wav ...]"""
import sys, numpy as np, librosa
for f in sys.argv[1:]:
    y, sr = librosa.load(f, sr=16000)
    f0, v, _ = librosa.pyin(y, fmin=60, fmax=400, sr=sr)
    print(f"{f}: median F0 {np.nanmedian(f0[v]):.0f} Hz")
