"""Candidate engine: VoxCPM2 (openbmb, Apache-2.0) + Fasee7-Najdi-Small LoRA (Wittify, Apache-2.0).
Voice: casual young Saudi female designed with VoxCPM2 voice design (sample G anchor; no real person).
Native controls: style instruction "(...)" prepended to text with reference audio (VoxCPM2 "controllable
cloning"), cfg_value, inference_timesteps, seed. Default: no style, cfg 2.0, 20 steps (model card).
adj = per-segment style instruction (below). Usage: python gen_vox.py OUT_DIR [--order 12_t1 ...]"""
import os, sys, json, argparse, soundfile as sf, torch
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from huggingface_hub import snapshot_download
from voxcpm import VoxCPM
from voxcpm.model.voxcpm2 import LoRAConfig
from variants import T
from common import join
STYLE = {1: ["playful, curious, surprised, casual, not over-acted"],
         7: ["playfully suspicious, conversational"],
         8: ["conversational, building tension toward the end"],
         12: ["calm, slightly slower", "genuine curious question", "confident, relaxed, settled falling ending"]}
ANCHOR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../segments/G/anchor.wav")
ap = argparse.ArgumentParser(); ap.add_argument("out"); ap.add_argument("--seed", type=int, default=1)
ap.add_argument("--order", nargs="*")
a = ap.parse_args(); os.makedirs(a.out, exist_ok=True); torch.set_num_threads(int(os.environ.get("THREADS", os.cpu_count())))
lora = snapshot_download("Wittify/Fasee7-Najdi-Small", allow_patterns=["*.json", "lora_weights.safetensors"])
m = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, optimize=False, device="cpu",
                           lora_config=LoRAConfig(**json.load(open(f"{lora}/lora_config.json"))["lora_config"]), lora_weights_path=lora)
sr = m.tts_model.sample_rate
keys = sorted(T) if not a.order else [(int(k[:2]), int(k[-1])) for k in a.order]
for (seg, n) in keys:
    t = T[(seg, n)]; fn = os.path.join(a.out, f"{seg:02d}_t{n}.wav")
    if os.path.exists(fn): continue
    styles = STYLE[seg] if t["kind"] == "adj" else [None] * len(t["phrases"])
    if len(styles) != len(t["phrases"]): styles = [styles[0]] * len(t["phrases"])
    xs, texts = [], []
    for k, (p, st) in enumerate(zip(t["phrases"], styles)):
        torch.manual_seed(a.seed * 100 + seg * 10 + k)
        txt = (f"({st})" if st else "") + p.replace("«", "").replace("»", ""); texts.append(txt)
        xs.append(m.generate(text=txt, reference_wav_path=ANCHOR, cfg_value=2.0, inference_timesteps=20))
    sf.write(fn, join(xs, t["gaps_ms"], sr), sr)
    json.dump(dict(t, engine="voxcpm2+fasee7", engine_text=texts, cfg_value=2.0, timesteps=20, seed=a.seed), open(fn[:-4] + ".json", "w"), ensure_ascii=False)
    print("done", os.path.basename(fn), flush=True)
