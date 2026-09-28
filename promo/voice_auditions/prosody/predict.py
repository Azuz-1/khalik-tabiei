"""Backtest/predict: similarity of a take to the owner's native reading of the same line.
Features (word-aligned with MMS forced alignment, both sides):
  contour  = Pearson r of per-word median F0 (semitones re each speaker's own median)  -> intonation shape
  rhythm   = Pearson r of per-word duration share (word dur / line speech dur)         -> timing/grouping
  pauses   = mean |log2(take_pause+60)/(owner_pause+60)| at owner pause points (>=100 ms) -> juncture
Score = contour + rhythm - pauses. Octave-robust: per-word MEDIAN, and frames > 9 st from median dropped.
Usage: python predict.py LINE take.wav[:text] ...   (text defaults to the take's .json phrases)"""
import sys, os, re, json, numpy as np, librosa, torch, uroman
from torchaudio.pipelines import MMS_FA
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
REF = "/tmp/claude-0/-home-user-khalik-tabiei/46443562-8662-5161-849c-63d06d367297/scratchpad/ref/owner16k.wav"
T = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "reference/owner_targets.json")))
UR = uroman.Uroman(); FA = MMS_FA.get_model(with_star=False).eval(); TOK = MMS_FA.get_tokenizer(); ALN = MMS_FA.get_aligner()
HOP = 0.01
def norm(t): return re.sub("[إأآ]", "ا", re.sub(r"[ً-ْـ«»…،,.!؟?]", "", t)).replace("ة", "ه").replace("ى", "ي")
def feats(y, sr, words, spans=None):
    if spans is None:
        rom = ["".join(c for c in UR.romanize_string(w).lower() if c in MMS_FA.get_dict()) or "a" for w in words]
        with torch.inference_mode():
            em, _ = FA(torch.tensor(y)[None]); sp = ALN(em[0], TOK(rom))
        r = len(y) / em.shape[1] / sr; spans = [(s[0].start * r, s[-1].end * r) for s in sp]
    f0, vo, _ = librosa.pyin(y, fmin=70, fmax=450, sr=sr, hop_length=int(HOP * sr))
    med = np.nanmedian(f0[vo]); st = 12 * np.log2(f0 / med); st[np.abs(st) > 9] = np.nan
    rms = librosa.feature.rms(y=y, hop_length=int(HOP * sr))[0]; db = 20 * np.log10(rms / rms.max() + 1e-9)
    thr = np.percentile(db, 10) + 6
    fr = lambda t: min(int(t / HOP), len(st) - 1)
    wf0 = [np.nanmedian(st[fr(a):max(fr(b), fr(a) + 1)]) if np.any(~np.isnan(st[fr(a):max(fr(b), fr(a) + 1)])) else np.nan for a, b in spans]
    tot = spans[-1][1] - spans[0][0]; dur = [(b - a) / tot for a, b in spans]
    def gap(i):
        s = db[fr(spans[i][1] - 0.05):fr(spans[i + 1][0] + 0.05)] < thr; best = cur = 0
        for x in s: cur = cur + 1 if x else 0; best = max(best, cur)
        return best * HOP * 1000
    return np.array(wf0), np.array(dur), [gap(i) for i in range(len(spans) - 1)]
def corr(a, b):
    m = ~np.isnan(a) & ~np.isnan(b)
    return float(np.corrcoef(a[m], b[m])[0, 1]) if m.sum() >= 3 else 0.0
line = sys.argv[1]; L = T["lines"][line]; ow = [norm(w["w"]) for w in L["words"]]
yr, _ = librosa.load(REF, sr=16000); a0 = L["words"][0]["s"] - 0.2; b0 = L["words"][-1]["e"] + 0.2
seg = yr[int(a0 * 16000):int(b0 * 16000)]
of0, odur, ogap = feats(seg, 16000, ow, [(w["s"] - a0, w["e"] - a0) for w in L["words"]])
for arg in sys.argv[2:]:
    path, _, txt = arg.partition(":")
    if not txt:
        d = json.load(open(path[:-4] + ".json")); txt = re.sub(r"\([^)]*\)", " ", " ".join(d["phrases"]))
    tw = [norm(w) for w in txt.split() if norm(w)]
    y, sr = librosa.load(path, sr=16000)
    if len(tw) != len(ow): print(os.path.basename(path), f"word count {len(tw)} != owner {len(ow)}: skipped"); continue
    f0, dur, gp = feats(y, sr, tw)
    pts = [i for i, g in enumerate(ogap) if g >= 100]
    pz = float(np.mean([abs(np.log2((gp[i] + 60) / (ogap[i] + 60))) for i in pts])) if pts else 0.0
    c, r = corr(f0, of0), corr(dur, odur)
    print(f"{os.path.basename(path):28s} score {c + r - pz:+.2f} | contour r {c:+.2f} | rhythm r {r:+.2f} | pause err {pz:.2f} | pauses {[int(gp[i]) for i in pts]} vs owner {[int(ogap[i]) for i in pts]}")
