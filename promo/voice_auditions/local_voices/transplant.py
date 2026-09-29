"""Prosody transplant: copy a target reading's timing, melody and loudness onto a local take of the same text.

1. Forced alignment (MMS_FA) of the same text in both recordings gives every letter's start/end in each.
2. Timing: each letter/pause of the take is stretched or shortened to the target's length (Praat PSOLA DurationTier).
3. Melody: the target's pitch curve, mapped onto the take's timeline and moved into the take's own register
   (median ratio), replaces the take's pitch (Praat PitchTier).
4. Loudness: per-word gain so each word's level follows the target's word-to-word shape (smoothed, +-6 dB max).
Also writes an analysis JSON: per word, duration / mean pitch / pitch movement / loudness for target, take and result.

Usage: python transplant.py TARGET.wav|mp3 TAKE.wav "text" OUT.wav
The target can be the ElevenLabs line, or the owner's own phone recording of how the line should sound."""
import json, re, sys
import numpy as np, soundfile as sf, librosa, torch, uroman, parselmouth
from parselmouth.praat import call
from torchaudio.pipelines import MMS_FA

SR = 16000
UR = uroman.Uroman(); FA = MMS_FA.get_model(with_star=False).eval(); TOK = MMS_FA.get_tokenizer(); ALN = MMS_FA.get_aligner()
def norm(t): return re.sub("[إأآ]", "ا", re.sub(r"[ً-ْـ«»…،,.!؟?]", "", t)).replace("ة", "ه").replace("ى", "ي").replace("گ", "ق")
def words_of(text): return [w for w in (norm(x) for x in re.sub(r"\([^)]*\)|\[[^]]*\]", " ", text).split()) if w]

def align(y, words):
    """letter-level spans [(word_index, start_s, end_s), ...] in time order"""
    rom = ["".join(c for c in UR.romanize_string(w).lower() if c in MMS_FA.get_dict()) or "a" for w in words]
    with torch.inference_mode():
        em, _ = FA(torch.tensor(y, dtype=torch.float32)[None]); sp = ALN(em[0], TOK(rom))
    r = len(y) / em.shape[1] / SR
    return [(wi, t.start * r, t.end * r) for wi, ws in enumerate(sp) for t in ws]

def load(p):
    y, _ = librosa.load(p, sr=SR, mono=True); _, (a, b) = librosa.effects.trim(y, top_db=45)
    k = int(0.05 * SR); return y[max(0, a - k): b + k].astype(np.float64)

def fix_octaves(f):
    """pitch-tracker octave errors: a point ~an octave away from the local median is folded back; wild points dropped"""
    f = f.copy(); v = f > 0
    if v.sum() < 10: return f
    st = 12 * np.log2(np.where(v, f, 1) / 100)
    for i in np.where(v)[0]:
        w = st[max(0, i - 15): i + 16][v[max(0, i - 15): i + 16]]; med = np.median(w)
        d = st[i] - med
        if abs(d) > 7:
            d2 = d - 12 * np.round(d / 12)
            if abs(d2) < 4: st[i] -= 12 * np.round(d / 12)
            else: f[i] = 0; continue
        f[i] = 100 * 2 ** (st[i] / 12)
    return f

def paired_breakpoints(st_, ss_, tt, ts):
    """paired time grid (target, take): 0, every letter start/end, end; a pair is kept only if both times advance"""
    bt, bs = [0.0], [0.0]
    for (_, a1, b1), (_, a2, b2) in zip(st_, ss_):
        for x, y in ((a1, a2), (b1, b2)):
            if x > bt[-1] + 1e-3 and y > bs[-1] + 1e-3: bt.append(x); bs.append(y)
    bt.append(max(tt, bt[-1] + 1e-2)); bs.append(max(ts, bs[-1] + 1e-2))
    return bt, bs

def word_stats(y, spans, nw, pitch_times=None, pitch_vals=None):
    snd = parselmouth.Sound(y, SR); pt = snd.to_pitch(time_step=0.01, pitch_floor=75, pitch_ceiling=500)
    f = fix_octaves(pt.selected_array["frequency"]); ts = pt.xs(); out = []
    for w in range(nw):
        ss = [(s, e) for wi, s, e in spans if wi == w]; s, e = ss[0][0], ss[-1][1]
        m = (ts >= s) & (ts <= e) & (f > 0); st = 12 * np.log2(f[m] / 100) if m.any() else np.array([np.nan])
        seg = y[int(s * SR): int(e * SR)]
        out.append(dict(start=round(s, 3), dur=round(e - s, 3), pitch_st=round(float(np.nanmean(st)), 2),
                        move_st=round(float(st[-1] - st[0]) if len(st) > 1 else 0.0, 2),
                        loud_db=round(float(20 * np.log10(np.sqrt(np.mean(seg ** 2)) + 1e-9)), 2)))
    return out

def transplant(tgt_p, src_p, text, out_p):
    words = words_of(text); yt, ys = load(tgt_p), load(src_p)
    st_, ss_ = align(yt, words), align(ys, words)
    bt, bs = paired_breakpoints(st_, ss_, len(yt) / SR, len(ys) / SR); n = len(bt)
    snd = parselmouth.Sound(ys, SR)
    man = call(snd, "To Manipulation", 0.01, 75, 500)
    # timing: scale each source interval to the target interval's length
    dt = call("Create DurationTier", "d", 0, snd.duration)
    for i in range(n - 1):
        a, b = bs[i], bs[i + 1]; ratio = max(0.25, min(4.0, (bt[i + 1] - bt[i]) / max(b - a, 1e-3)))
        call(dt, "Add point", a + 1e-4, ratio); call(dt, "Add point", b - 1e-4, ratio)
    call([man, dt], "Replace duration tier")
    # melody: target pitch → source timeline, in the source's register
    ptt = parselmouth.Sound(yt, SR).to_pitch(time_step=0.01, pitch_floor=75, pitch_ceiling=500)
    pts = snd.to_pitch(time_step=0.01, pitch_floor=75, pitch_ceiling=500)
    ft, tt = fix_octaves(ptt.selected_array["frequency"]), ptt.xs(); fs = fix_octaves(pts.selected_array["frequency"])
    k = np.median(fs[fs > 0]) / np.median(ft[ft > 0])
    ptier = call("Create PitchTier", "p", 0, snd.duration)
    for t, f in zip(tt, ft):
        if f <= 0: continue
        src_t = float(np.interp(t, bt, bs)); call(ptier, "Add point", src_t, float(f * k))
    call([man, ptier], "Replace pitch tier")
    res = call(man, "Get resynthesis (overlap-add)").values[0]
    # loudness: per-word gain toward the target's word-to-word shape
    sr_ = align(res.astype(np.float32), words)
    tstat, rstat = word_stats(yt, st_, len(words)), word_stats(res, sr_, len(words))
    off = np.median([t["loud_db"] - r["loud_db"] for t, r in zip(tstat, rstat)])
    g = np.ones(len(res))
    for w, (t, r) in enumerate(zip(tstat, rstat)):
        s, e = int(r["start"] * SR), int((r["start"] + r["dur"]) * SR)
        g[s:e] = 10 ** (np.clip(t["loud_db"] - r["loud_db"] - off, -6, 6) / 20)
    g = np.convolve(g, np.hanning(int(0.06 * SR)) / np.hanning(int(0.06 * SR)).sum(), mode="same")
    res = res * g; res = res / (np.abs(res).max() + 1e-9) * 0.9
    sf.write(out_p, res, SR)
    rep = dict(words=words, register_ratio=round(float(k), 3),
               target=tstat, take=word_stats(ys, ss_, len(words)), result=word_stats(res, align(res.astype(np.float32), words), len(words)))
    json.dump(rep, open(out_p[:-4] + ".json", "w"), ensure_ascii=False, indent=1)
    return rep

if __name__ == "__main__":
    r = transplant(*sys.argv[1:5])
    for i, w in enumerate(r["words"]):
        t, s, o = r["target"][i], r["take"][i], r["result"][i]
        print(f"{w:>10}  dur {t['dur']:.2f}/{s['dur']:.2f}->{o['dur']:.2f}  pitch {t['pitch_st']:.1f}/{s['pitch_st']:.1f}->{o['pitch_st']:.1f}  move {t['move_st']:+.1f}/{s['move_st']:+.1f}->{o['move_st']:+.1f}")
