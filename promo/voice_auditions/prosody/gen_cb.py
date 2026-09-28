"""Candidate engine: NAMAA-Saudi-TTS (Saudi fine-tune of Chatterbox Multilingual T3; MIT), built-in default voice.
Native controls (Chatterbox README): exaggeration, cfg_weight, temperature, seed.
Default = README defaults exaggeration 0.5, cfg_weight 0.5 (temperature 0.8).
adj = README "expressive or dramatic" recipe: exaggeration 0.7, cfg_weight 0.3.
Usage: python gen_cb.py OUT_DIR [--order 12_t1 ...]"""
import os, sys, json, argparse, soundfile as sf, torch
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from huggingface_hub import snapshot_download
from safetensors.torch import load_file
from chatterbox import mtl_tts
from variants import T
from common import join
ap = argparse.ArgumentParser(); ap.add_argument("out"); ap.add_argument("--seed", type=int, default=1)
ap.add_argument("--order", nargs="*")
a = ap.parse_args(); os.makedirs(a.out, exist_ok=True); torch.set_num_threads(int(os.environ.get("THREADS", os.cpu_count())))
m = mtl_tts.ChatterboxMultilingualTTS.from_pretrained(device="cpu")
m.t3.load_state_dict(load_file(snapshot_download("NAMAA-Space/NAMAA-Saudi-TTS", allow_patterns=["t3_mtl23ls_v2.safetensors"]) + "/t3_mtl23ls_v2.safetensors", device="cpu")); m.t3.eval()
keys = sorted(T) if not a.order else [(int(k[:2]), int(k[-1])) for k in a.order]
for (seg, n) in keys:
    t = T[(seg, n)]; fn = os.path.join(a.out, f"{seg:02d}_t{n}.wav")
    if os.path.exists(fn): continue
    ex, cfg = (0.7, 0.3) if t["kind"] == "adj" else (0.5, 0.5)
    xs = []
    for k, p in enumerate(t["phrases"]):
        torch.manual_seed(a.seed * 100 + seg * 10 + k)
        xs.append(m.generate(p.replace("«", "").replace("»", ""), language_id="ar", exaggeration=ex, cfg_weight=cfg, temperature=0.8).squeeze(0).numpy())
    sf.write(fn, join(xs, t["gaps_ms"], m.sr), m.sr)
    json.dump(dict(t, engine="namaa-chatterbox", exaggeration=ex, cfg_weight=cfg, temperature=0.8, seed=a.seed), open(fn[:-4] + ".json", "w"), ensure_ascii=False)
    print("done", os.path.basename(fn), flush=True)
