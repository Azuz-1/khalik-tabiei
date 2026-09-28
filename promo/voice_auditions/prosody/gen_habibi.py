"""Candidate engine: Habibi-TTS Specialized SAU (F5-TTS DiT; SWivid; CC-BY-NC-SA-4.0 = non-commercial).
Judged "the strongest Saudi dialect baseline so far" by native listening in AihmedML/SaudiVoice-TTS.
Zero-shot model: needs a reference clip. We do NOT use its bundled real-speaker assets; the reference
is our synthetic male anchor (round-2 E: VoxCPM2 voice design, no real person), transcript known.
Native controls: cfg_strength, nfe_step, sway_sampling, speed, seed. Defaults: nfe 32, cfg 2.0, speed 1.0.
adj = cfg_strength 1.5 (less guidance -> more prosodic variation; F5 docs/community tip).
Segment 12 take 3 = per-beat speed 0.9 / 1.0 / 0.95 with cfg 1.5.
Usage: python gen_habibi.py OUT_DIR [--seed N]"""
import os, sys, json, argparse, numpy as np, soundfile as sf, torch
from importlib.resources import files
from cached_path import cached_path
from omegaconf import OmegaConf
from hydra.utils import get_class
from f5_tts.infer.utils_infer import load_model, load_vocoder, infer_process
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from variants import T
from common import join
REF = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../segments/E/anchor.wav")
REF_TEXT = "هلا والله! اليوم عندي لكم لعبة حلوة مرة، تعالوا أعلمكم عليها."
import re
# Class-A: Habibi was trained "without requiring text diacritization" (paper); hidden tashkeel is
# out-of-distribution and garbled words (e.g. تَخَيَّل -> heard «اخ خيال»). Strip tashkeel, keep letters (incl. گ).
def fix(p): return re.sub(r"[\u064B-\u0652]", "", p).replace("«", "").replace("»", "")
NFE = 16  # 32 is the default; 16 used for the time budget (applied to every take equally)
ap = argparse.ArgumentParser(); ap.add_argument("out"); ap.add_argument("--seed", type=int, default=1)
ap.add_argument("--only", nargs="*", type=int)
a = ap.parse_args(); os.makedirs(a.out, exist_ok=True); torch.set_num_threads(os.cpu_count())
cfg = OmegaConf.load(str(files("f5_tts").joinpath("configs/F5TTS_v1_Base.yaml")))
model = load_model(get_class(f"f5_tts.model.{cfg.model.backbone}"), cfg.model.arch,
                   str(cached_path("hf://SWivid/Habibi-TTS/Specialized/SAU/model_200000.safetensors")),
                   mel_spec_type="vocos", vocab_file=str(cached_path("hf://SWivid/Habibi-TTS/Specialized/SAU/vocab.txt")), device="cpu")
voc = load_vocoder(vocoder_name="vocos", device="cpu")
for (seg, n), t in sorted(T.items()):
    if a.only and seg not in a.only: continue
    adj = t["kind"] == "adj"
    cfgs = 1.5 if adj else 2.0
    sp = ([0.9, 1.0, 0.95] if (adj and seg == 12) else [1.0] * len(t["phrases"]))
    xs = []
    for k, (p, s) in enumerate(zip(t["phrases"], sp)):
        torch.manual_seed(a.seed * 100 + seg * 10 + k)
        w, sr, _ = infer_process(REF, REF_TEXT, fix(p), model, voc, mel_spec_type="vocos",
                                 nfe_step=NFE, cfg_strength=cfgs, sway_sampling_coef=-1.0, speed=s, device="cpu")
        xs.append(np.asarray(w, np.float32))
    fn = os.path.join(a.out, f"{seg:02d}_t{n}.wav"); sf.write(fn, join(xs, t["gaps_ms"], sr), sr)
    json.dump(dict(t, engine="habibi-sau", cfg_strength=cfgs, nfe_step=NFE, speed=sp, seed=a.seed, engine_text=[fix(p) for p in t["phrases"]]), open(fn[:-4] + ".json", "w"), ensure_ascii=False)
    print("done", os.path.basename(fn), flush=True)
