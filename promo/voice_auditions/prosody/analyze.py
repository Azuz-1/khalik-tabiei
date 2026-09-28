"""Acoustic diagnostics for prosody takes (SECONDARY evidence only; listening decides).

Per take: word timings from MMS forced alignment of the INTENDED text
(torchaudio MMS_FA + uroman; Whisper word edges proved unreliable on Arabic TTS),
Whisper large-v3-turbo transcript as a secondary intelligibility check, pyin F0 (semitones re take median),
per-word prominence (z-scored F0 peak + RMS peak + duration/char), pauses >=120 ms,
and segment-specific hypothesis checks. Writes <take>.png (F0 contour with words)
and appends a row to results.jsonl.
Usage: python analyze.py TAKE_DIR [TAKE_DIR...]
"""
import sys, os, re, json, glob, numpy as np, librosa
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
import arabic_reshaper; from bidi.algorithm import get_display
from faster_whisper import WhisperModel
import torch, torchaudio, uroman
from torchaudio.pipelines import MMS_FA
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from variants import BASE
FA = MMS_FA.get_model(with_star=False).eval(); TOK = MMS_FA.get_tokenizer(); ALN = MMS_FA.get_aligner()
UR = uroman.Uroman()

def intended_text(wav):
    j = wav[:-4] + ".json"
    if os.path.exists(j):
        d = json.load(open(j))
        t = " ".join(d["phrases"]) if "phrases" in d else " ".join(p["text"] for p in d["parts"])
        return re.sub(r"\([^)]*\)", " ", t)  # drop VoxCPM style instructions
    return BASE[int(os.path.basename(wav)[:2])]

def align(y, sr, text):
    words = [w for w in (norm(t) for t in text.split()) if w]
    rom = []
    for w in words:
        r = "".join(c for c in UR.romanize_string(w).lower() if c in MMS_FA.get_dict())
        rom.append(r or "a")
    with torch.inference_mode():
        em, _ = FA(torch.tensor(y)[None])
        spans = ALN(em[0], TOK(rom))
    ratio = len(y) / em.shape[1] / sr
    return [dict(w=w, s=sp[0].start * ratio, e=sp[-1].end * ratio) for w, sp in zip(words, spans)]

ASR = WhisperModel("large-v3-turbo", device="cpu", compute_type="int8")
HOP = 0.01
DIAC = re.compile(r"[ً-ْـ]")
def norm(t): return re.sub("[إأآ]", "ا", DIAC.sub("", t)).replace("ة", "ه").replace("ى", "ي").strip(" ،,.!؟?…«»")

def ar(t): return get_display(arabic_reshaper.reshape(t))

def find(words, *keys):
    for i, w in enumerate(words):
        n = norm(w["w"])
        if any(k in n for k in keys): return i
    return None

def analyze(wav):
    y, sr = librosa.load(wav, sr=16000)
    f0, vo, _ = librosa.pyin(y, fmin=70, fmax=450, sr=sr, hop_length=int(HOP * sr))
    med = np.nanmedian(f0[vo]); st = 12 * np.log2(f0 / med)          # semitones re median
    rms = librosa.feature.rms(y=y, hop_length=int(HOP * sr))[0]; db = 20 * np.log10(rms / rms.max() + 1e-9)
    segs, _ = ASR.transcribe(wav, language="ar", beam_size=5)
    asr = " ".join(s.text.strip() for s in segs)
    words = align(y, sr, intended_text(wav))
    fr = lambda t: min(int(t / HOP), len(st) - 1)
    for w in words:
        a, b = fr(w["s"]), max(fr(w["e"]), fr(w["s"]) + 1)
        v = st[a:b][~np.isnan(st[a:b])]
        w["f0max"] = float(v.max()) if len(v) else np.nan
        w["f0mean"] = float(v.mean()) if len(v) else np.nan
        w["rms"] = float(db[a:b].max()); w["dur"] = w["e"] - w["s"]
        w["dpc"] = w["dur"] / max(len(norm(w["w"])), 1)
    def z(k):
        x = np.array([w[k] for w in words], float); m, s = np.nanmean(x), np.nanstd(x) or 1
        return (x - m) / s
    if words:
        prom = np.nan_to_num(z("f0max")) + np.nan_to_num(z("rms")) + np.nan_to_num(z("dpc"))
        for w, p in zip(words, prom): w["prom"] = float(p)
    # pauses: frames below -35 dB for >=120 ms, excluding edges
    sil = db < -35; pauses = []; i = 0; n = len(sil)
    first = np.argmax(~sil); last = n - np.argmax(~sil[::-1])
    i = first
    while i < last:
        if sil[i]:
            j = i
            while j < last and sil[j]: j += 1
            if (j - i) * HOP >= 0.12: pauses.append((round(i * HOP, 2), round((j - i) * HOP * 1000)))
            i = j
        else: i += 1
    def slope(t0, t1):  # semitone change over voiced frames in [t0,t1] (linear fit * span)
        a, b = fr(t0), fr(t1); v = st[a:b]; idx = np.where(~np.isnan(v))[0]
        if len(idx) < 5: return None
        p = np.polyfit(idx * HOP, v[idx], 1); return round(float(p[0] * (idx[-1] - idx[0]) * HOP), 1)
    def vo_(w):
        a, b = fr(w["s"]), max(fr(w["e"]), fr(w["s"]) + 1); v = st[a:b]; return v[~np.isnan(v)]
    def terminal(w):
        """(rise, fall) in st: rise = end - min; fall = start - end (30% windows)."""
        v = vo_(w)
        if len(v) < 6: return (None, None)
        k = max(2, int(len(v) * .3)); st0, en = np.median(v[:k]), np.median(v[-k:])
        return round(float(en - v.min()), 1), round(float(st0 - en), 1)
    def gap_before(i):
        # Whisper word edges absorb silence, so use measured pauses between the
        # previous word's start and this word's end.
        if not i: return None
        lo, hi = words[i - 1]["s"], words[i]["e"]
        c = [pm for p0, pm in pauses if lo <= p0 <= hi]
        return max(c) if c else 0
    rank = sorted(range(len(words)), key=lambda k: -words[k].get("prom", 0))
    R = dict(take=os.path.basename(wav), dur=round(len(y) / sr, 2), asr=asr,
             pauses=pauses, top3=[norm(words[k]["w"]) for k in rank[:3]])
    seg = int(os.path.basename(wav)[:2])
    pos = lambda i: rank.index(i) + 1 if i is not None else None
    if seg == 1:
        R["rank_تخيل"] = pos(find(words, "تخيل")); R["rank_الوحيد"] = pos(find(words, "الوحيد"))
        R["end_fall_st"] = terminal(words[-1])[1]
    if seg == 5:
        i = find(words, "ارفع", "رفع", "افع"); R["pause_before_ارفع_ms"] = gap_before(i)
        j = find(words, "يدك", "يدّك", "ايدك", "يديك"); R["rank_يدك"] = pos(j); R["rank_ارفع"] = pos(i)
        R["end_fall_st"] = terminal(words[-1])[1]
    if seg == 7:
        R["rank_يشك"] = pos(find(words, "يشك", "شك")); R["rank_بالثاني"] = pos(find(words, "بالثاني", "ثاني"))
        R["end_fall_st"] = terminal(words[-1])[1]
    if seg == 8:
        i = find(words, "انمسك", "مسك"); R["انمسك_heard"] = i is not None
        R["pause_before_انمسك_ms"] = gap_before(i); R["rank_انمسك"] = pos(i)
        j = find(words, "المتخفي", "متخفي"); R["المتخفي_rise_st"] = terminal(words[j])[0] if j is not None else None
        R["انمسك_fall_st"] = terminal(words[i])[1] if i is not None else None
        k = find(words, "وإذا", "واذا"); R["pause_before_وإذا_ms"] = gap_before(k)
    if seg == 10:
        i = find(words, "يفلت", "فلت"); R["rank_يفلت"] = pos(i); R["rank_نقاط"] = pos(find(words, "نقاط", "نقاض"))
        k = find(words, "قدر", "كدر", "جدر", "قد", "گدر"); R["word_قدر_asr"] = words[k]["w"] if k is not None else None
    if seg == 12:
        i = find(words, "تقدر", "تكدر", "تجدر", "قدر", "تگدر"); j = find(words, "خلك", "خليك", "هلك")
        R["تقدر_rise_st"] = terminal(words[i])[0] if i is not None else None
        R["pause_تقدر→خلك_ms"] = gap_before(j)
        R["طبيعي_end_fall_st"] = terminal(words[-1])[1]
    # plot
    t = np.arange(len(st)) * HOP
    fig, ax = plt.subplots(figsize=(10, 2.6)); ax.plot(t, st, lw=1.5)
    for w in words:
        ax.axvspan(w["s"], w["e"], color="0.92"); ax.text((w["s"] + w["e"]) / 2, 7, ar(norm(w["w"])), ha="center", fontsize=9)
    for p0, pm in pauses: ax.text(p0, -8, f"{pm}ms", fontsize=7, color="tab:red")
    ax.set_ylim(-10, 9); ax.set_ylabel("st re median"); ax.set_xlabel("s"); ax.set_title(R["take"], fontsize=9)
    fig.tight_layout(); fig.savefig(wav[:-4] + ".png", dpi=90); plt.close(fig)
    return R

if __name__ == "__main__":
    for d in sys.argv[1:]:
        done = set()
        rp = os.path.join(d, "results.jsonl")
        if os.path.exists(rp): done = {json.loads(l)["take"] for l in open(rp)}
        for wav in sorted(glob.glob(os.path.join(d, "*.wav"))):
            if os.path.basename(wav) in done: continue
            r = analyze(wav)
            with open(rp, "a") as f: f.write(json.dumps(r, ensure_ascii=False) + "\n")
            print(json.dumps(r, ensure_ascii=False), flush=True)
