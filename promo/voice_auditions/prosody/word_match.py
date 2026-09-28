"""Shortlist aid: MFCC-DTW distance between «WORD» in each take and the same word in a reference take.
Lower = acoustically closer to the owner-liked reference. Diagnostic only; the owner decides.
Usage: python word_match.py REF.wav REF_TEXT WORD take.wav[:text] ..."""
import sys, json, numpy as np, librosa
from splice_word import spans, norm
ref, rtext, word = sys.argv[1:4]; W = norm(word)
def mf(path, text):
    x, sr, sp = spans(path, text); _, a, b = next(s for s in sp if W in s[0])
    y = librosa.resample(x[int(a * sr):int(b * sr)], orig_sr=sr, target_sr=16000)
    m = librosa.feature.mfcc(y=y, sr=16000, n_mfcc=20)[1:]; return (m - m.mean(1, keepdims=True)) / (m.std(1, keepdims=True) + 1e-9), b - a
R, rd = mf(ref, rtext)
for arg in sys.argv[4:]:
    p = arg.split(":")[0]; t = json.load(open(p[:-4] + ".json"))["phrases"][0]
    M, d = mf(p, t); D, wp = librosa.sequence.dtw(R, M, metric="euclidean")
    print(f"{p.split('/')[-1]:14s} dist {D[-1, -1] / len(wp):.2f} | dur {d:.2f}s (ref {rd:.2f}s)")
