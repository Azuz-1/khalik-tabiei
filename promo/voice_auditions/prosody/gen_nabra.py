"""Candidate engine: Nabra-Saudi-82M (Kokoro/StyleTTS2, Apache-2.0), voice af_msa.
Native controls: speed only (Kokoro style vector is picked by phoneme count; no emotion control).
adj = speed change: 0.9 (more relaxed/deliberate); segment 12 take 3 = per-beat speeds 0.88/1.0/0.94.
Usage: python gen_nabra.py OUT_DIR"""
import os, sys, json, numpy as np, soundfile as sf
from huggingface_hub import snapshot_download
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from variants import T
from common import join
sys.path.insert(0, snapshot_download("oddadmix/Nabra-Saudi-82M", allow_patterns=["*.py", "*.json", "af_msa.pt", "nabra_saudi_82m_v0.pth", "kokoro_patched/**"]))
from load_model import load
# Class-A hidden spelling fixes for THIS engine's espeak front end (audio-verified, see REPORT.md):
#   تَخَيَّل -> "taχaiːl" (shadda mangled; heard «أخيل»)      => plain تخيل -> "taχajjal"
#   اِنْمَسَك -> "ʔinmasaka" (MSA case vowel; heard «المسكة») => اِنْمَسَكْ -> "ʔinmasak"
SPELL = {"تَخَيَّل": "تخيل", "اِنْمَسَك": "اِنْمَسَكْ"}
def fix(p):
    for a_, b_ in SPELL.items(): p = p.replace(a_, b_)
    return p.replace("«", "").replace("»", "")
# A/B pronunciation pairs (listener decides): segment 7 يِشِكْ (owner) vs يشِكّ (Najdi final-stress
# CVCC per phonology; G2P jʃikː), segment 5 يَدَك (-> jadaka) vs يَدَكْ (-> jadak).
PAIRS = {"07_pairA_يِشِكْ": "بعدها يِنكَشِف المطلوب… وكل واحد يبدأ يِشِكْ بالثاني.",
         "07_pairB_يشِكّ": "بعدها يِنكَشِف المطلوب… وكل واحد يبدأ يشِكّ بالثاني.",
         "05_pairA_يَدَك": "اِرْفَع يَدَك!", "05_pairB_يَدَكْ": "اِرْفَع يَدَكْ!"}
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
model, pipe, voice = load(device="cpu")
def speeds(t):
    if t["kind"] != "adj": return [1.0] * len(t["phrases"])
    if t["seg"] == 12: return [0.88, 1.0, 0.94]
    return [0.9] * len(t["phrases"])
for (seg, n), t in sorted(T.items()):
    sp = speeds(t)
    xs = [np.concatenate([r[2].numpy() for r in pipe(fix(p), voice=voice, speed=s)])
          for p, s in zip(t["phrases"], sp)]
    fn = os.path.join(out, f"{seg:02d}_t{n}.wav"); sf.write(fn, join(xs, t["gaps_ms"], 24000), 24000)
    json.dump(dict(t, engine="nabra", speed=sp, engine_text=[fix(p) for p in t["phrases"]]), open(fn[:-4] + ".json", "w"), ensure_ascii=False)
    print("done", os.path.basename(fn), flush=True)
pd = os.path.join(out, "pairs"); os.makedirs(pd, exist_ok=True)
for k, txt in PAIRS.items():
    sf.write(os.path.join(pd, k + ".wav"), np.concatenate([r[2].numpy() for r in pipe(txt, voice=voice, speed=1.0)]), 24000)
    print("done", k, flush=True)
