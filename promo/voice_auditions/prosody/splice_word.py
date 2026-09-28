"""Replace one word in a take with the same word from another take (owner request: line 6's «المتخفي» should
sound like line 10's). Both takes are the same voice/engine. Word spans come from MMS forced alignment of
each take's own text; the donor word is loudness-matched (RMS) to the word it replaces and joined with
15 ms equal-power crossfades. No pitch/time processing.
Usage: python splice_word.py TARGET.wav TARGET_TEXT DONOR.wav DONOR_TEXT WORD OUT.wav"""
import sys, re, numpy as np, soundfile as sf, librosa, torch, uroman
from torchaudio.pipelines import MMS_FA
UR = uroman.Uroman(); FA = MMS_FA.get_model(with_star=False).eval(); TOK = MMS_FA.get_tokenizer(); ALN = MMS_FA.get_aligner()
def norm(t): return re.sub("[إأآ]", "ا", re.sub(r"[ً-ْـ«»…،,.!؟?]", "", t)).replace("ة", "ه").replace("ى", "ي")
def spans(path, text):
    x, sr = sf.read(path, dtype="float32"); x = x.mean(1) if x.ndim > 1 else x
    y = librosa.resample(x, orig_sr=sr, target_sr=16000)
    ws = [w for w in (norm(t) for t in re.sub(r"\([^)]*\)", " ", text).split()) if w]
    rom = ["".join(c for c in UR.romanize_string(w).lower() if c in MMS_FA.get_dict()) or "a" for w in ws]
    with torch.inference_mode():
        em, _ = FA(torch.tensor(y)[None]); sp = ALN(em[0], TOK(rom))
    r = len(y) / em.shape[1] / 16000
    return x, sr, [(w, s[0].start * r, s[-1].end * r) for w, s in zip(ws, sp)]
if __name__ == "__main__":
    tp, tt, dp, dt, word, out = sys.argv[1:7]
    x, sr, ts = spans(tp, tt); d, dsr, ds = spans(dp, dt)
    if dsr != sr: d = librosa.resample(d, orig_sr=dsr, target_sr=sr)
    W = norm(word)
    _, a, b = next(s for s in ts if W in s[0]); _, c, e = next(s for s in ds if W in s[0])
    pad = 0.02
    ia, ib = int((a - pad) * sr), int((b + pad) * sr); ic, ie = int((c - pad) * sr), int((e + pad) * sr)
    piece = d[ic:ie].copy(); old = x[ia:ib]
    piece *= np.sqrt(np.mean(old ** 2)) / (np.sqrt(np.mean(piece ** 2)) + 1e-9)
    f = int(0.015 * sr); up = np.sin(np.linspace(0, np.pi / 2, f)) ** 2; dn = up[::-1]
    head, tail = x[:ia + f].copy(), x[ib - f:].copy()
    head[-f:] = head[-f:] * dn + piece[:f] * up; tail[:f] = piece[-f:] * dn + tail[:f] * up
    y = np.concatenate([head, piece[f:-f], tail])
    sf.write(out, y, sr)
    print(f"replaced {tt.split()[0]}… word '{word}' {a:.2f}-{b:.2f}s with donor {c:.2f}-{e:.2f}s → {out}")
