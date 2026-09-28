"""Extract native prosody targets from the owner's reference reading (calibration only; the
recording is not used as a voice-cloning reference). Forced-aligns the spoken wording (MMS_FA),
then per line: word timings, inter-word pauses, F0 (semitones re speaker median), word prominence
(z F0 peak + RMS peak + dur/char, within line), and terminal rise/fall.
Usage: python analyze_ref.py REF16k.wav OUT_DIR"""
import sys, os, re, json, numpy as np, librosa, torch, uroman
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
import arabic_reshaper; from bidi.algorithm import get_display
from torchaudio.pipelines import MMS_FA
LINES = {
 1: "تخيل كلهم يرفعون يدهم وأنت الوحيد اللي ما تدري وش السالفة",
 2: "هذي خلك طبيعي لعبة جماعية وواحد منكم ما يدري وش المطلوب",
 3: "تدخلون من جوالاتكم بدون تحميل ولا تسجيل",
 4: "كل واحد يشوف المطلوب بجواله إلا المتخفي ما يطلع له شيء",
 5: "ثلاثة اثنين واحد ارفع يدك",
 6: "هنا لازم المتخفي يحاول يقلدكم ويحاول ما يفضح نفسه",
 7: "بعدها ينكشف المطلوب وكل واحد يبدأ يشك بالثاني",
 8: "تبدون بالتصويت على الشخص اللي شاكين فيه وإذا أغلبكم اختار المتخفي انمسك",
 9: "مرة ترفع يدك مرة تأشر ومرة توري رقم بصابعك وكل جولة غير",
 10: "إذا عرفت المتخفي تكسب نقاط وإذا قدر يفلت هو اللي يكسب",
 11: "وبالنهاية أكثر واحد جمع نقاط هو الفايز",
 12: "الحين السؤال تقدر خلك طبيعي"}
HOP = 0.01
def norm(t): return re.sub("[إأآ]", "ا", re.sub(r"[ً-ْـ]", "", t)).replace("ة", "ه").replace("ى", "ي")
wav, out = sys.argv[1], sys.argv[2]; os.makedirs(out, exist_ok=True)
y, sr = librosa.load(wav, sr=16000)
UR = uroman.Uroman(); FA = MMS_FA.get_model(with_star=False).eval(); TOK = MMS_FA.get_tokenizer(); ALN = MMS_FA.get_aligner()
words, line_of = [], []
for ln, t in LINES.items():
    for w in t.split(): words.append(w); line_of.append(ln)
rom = ["".join(c for c in UR.romanize_string(norm(w)).lower() if c in MMS_FA.get_dict()) or "a" for w in words]
with torch.inference_mode():
    em, _ = FA(torch.tensor(y)[None]); spans = ALN(em[0], TOK(rom))
ratio = len(y) / em.shape[1] / sr
W = [dict(w=w, line=l, s=sp[0].start * ratio, e=sp[-1].end * ratio) for w, l, sp in zip(words, line_of, spans)]
f0, vo, _ = librosa.pyin(y, fmin=70, fmax=400, sr=sr, hop_length=int(HOP * sr))
med = np.nanmedian(f0[vo]); st = 12 * np.log2(f0 / med)
rms = librosa.feature.rms(y=y, hop_length=int(HOP * sr))[0]; db = 20 * np.log10(rms / rms.max() + 1e-9)
fr = lambda t: min(int(t / HOP), len(st) - 1)
def voiced(a, b):
    v = st[fr(a):max(fr(b), fr(a) + 1)]; return v[~np.isnan(v)]
for w in W:
    v = voiced(w["s"], w["e"]); w["f0max"] = float(v.max()) if len(v) else np.nan
    w["rms"] = float(db[fr(w["s"]):max(fr(w["e"]), fr(w["s"]) + 1)].max()); w["dur"] = w["e"] - w["s"]
    w["dpc"] = w["dur"] / max(len(norm(w["w"])), 1)
    if len(v) >= 6:
        k = max(2, int(len(v) * .3)); w["rise"] = round(float(np.median(v[-k:]) - v.min()), 1); w["fall"] = round(float(np.median(v[:k]) - np.median(v[-k:])), 1)
THR = float(np.percentile(db, 10) + 6)  # adaptive: phone-recording noise floor (~-25 dB) + 6 dB
def silence_between(a, b):  # longest run below THR between a and b (ms)
    s = db[fr(a):fr(b)] < THR; best = cur = 0
    for x in s: cur = cur + 1 if x else 0; best = max(best, cur)
    return int(best * HOP * 1000)
res = {"speaker_median_f0_hz": round(float(med), 1), "silence_threshold_db": round(THR, 1), "lines": {}}
for ln, t in LINES.items():
    L = [w for w in W if w["line"] == ln]
    z = lambda k: (lambda x: (x - np.nanmean(x)) / (np.nanstd(x) or 1))(np.array([w[k] for w in L], float))
    prom = np.nan_to_num(z("f0max")) + np.nan_to_num(z("rms")) + np.nan_to_num(z("dpc"))
    order = [L[i]["w"] for i in np.argsort(-prom)]
    gaps = [(L[i]["w"], L[i + 1]["w"], silence_between(L[i]["e"] - 0.05, L[i + 1]["s"] + 0.05)) for i in range(len(L) - 1)]
    nxt = [w for w in W if w["line"] == ln + 1]
    res["lines"][ln] = dict(text=t, start=round(L[0]["s"], 2), end=round(L[-1]["e"], 2), dur=round(L[-1]["e"] - L[0]["s"], 2),
        words_per_sec=round(len(L) / (L[-1]["e"] - L[0]["s"]), 2), prominence_order=order[:4],
        pauses_ms=[g for g in gaps if g[2] >= 60], pause_after_line_ms=silence_between(L[-1]["e"] - 0.05, nxt[0]["s"] + 0.05) if nxt else None,
        words=[dict(w=w["w"], s=round(w["s"], 2), e=round(w["e"], 2), rise=w.get("rise"), fall=w.get("fall")) for w in L])
    fig, ax = plt.subplots(figsize=(10, 2.6)); a, b = L[0]["s"] - 0.2, L[-1]["e"] + 0.3
    tt = np.arange(fr(a), fr(b)) * HOP; ax.plot(tt, st[fr(a):fr(b)], lw=1.5)
    for w in L: ax.axvspan(w["s"], w["e"], color="0.92"); ax.text((w["s"] + w["e"]) / 2, 7, get_display(arabic_reshaper.reshape(w["w"])), ha="center", fontsize=9)
    ax.set_ylim(-10, 9); ax.set_title(f"owner line {ln}"); fig.tight_layout(); fig.savefig(f"{out}/owner_line{ln:02d}.png", dpi=90); plt.close(fig)
json.dump(res, open(f"{out}/owner_targets.json", "w"), ensure_ascii=False, indent=1)
for ln, r in res["lines"].items():
    print(ln, r["dur"], "s |", r["words_per_sec"], "w/s | pauses:", [(a_, b_, ms) for a_, b_, ms in r["pauses_ms"]], "| after:", r["pause_after_line_ms"], "| top:", r["prominence_order"])
