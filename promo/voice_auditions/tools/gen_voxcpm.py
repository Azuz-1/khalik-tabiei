"""Voice E: Fasee7-Najdi-Small (Wittify, Apache-2.0) — a Najdi LoRA on
OpenBMB VoxCPM2 (Apache-2.0).

No real-person reference audio. The voice is *designed* from a text
description (VoxCPM2 voice design: "(description)text") on a short anchor
line that is not part of the script; that synthetic anchor is then used as
the reference voice for all 12 segments so the narrator stays consistent.

Usage: python gen_voxcpm.py OUT_DIR [--seed N] [--design "(...)"] [--anchor-text T] [segment numbers...]
Text: the approved hidden script (hidden_script.HIDDEN) verbatim.
"""
import os, sys, json, argparse, numpy as np, soundfile as sf, torch
from huggingface_hub import snapshot_download
from voxcpm import VoxCPM
from voxcpm.model.voxcpm2 import LoRAConfig
from hidden_script import HIDDEN

DESIGN = "(A young adult Saudi man, warm, friendly and playful, relaxed and confident, conversational)"
ANCHOR = "هلا والله! اليوم عندي لكم لعبة حلوة مرة، تعالوا أعلمكم عليها."

ap = argparse.ArgumentParser()
ap.add_argument("out"); ap.add_argument("segs", nargs="*", type=int)
ap.add_argument("--seed", type=int, default=21)
ap.add_argument("--no-lora", action="store_true")
ap.add_argument("--design", default=DESIGN, help="VoxCPM2 voice-design description, in parentheses")
ap.add_argument("--anchor-text", default=ANCHOR)
a = ap.parse_intermixed_args(); os.makedirs(a.out, exist_ok=True)
torch.set_num_threads(os.cpu_count())

lora_dir = snapshot_download("Wittify/Fasee7-Najdi-Small", allow_patterns=["*.json", "lora_weights.safetensors"])
kw = {}
if not a.no_lora:
    kw = dict(lora_config=LoRAConfig(**json.load(open(f"{lora_dir}/lora_config.json"))["lora_config"]),
              lora_weights_path=lora_dir)
model = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, optimize=False, device="cpu", **kw)
sr = model.tts_model.sample_rate
gen = dict(cfg_value=2.0, inference_timesteps=20)

anchor_wav = os.path.join(a.out, "anchor.wav")
if not os.path.exists(anchor_wav):
    torch.manual_seed(a.seed)
    sf.write(anchor_wav, model.generate(text=a.design + a.anchor_text, **gen), sr); print("anchor done", flush=True)

for i in a.segs or range(1, 13):
    torch.manual_seed(a.seed + i)
    text = HIDDEN[i - 1].replace("«", "").replace("»", "")
    x = model.generate(text=text, reference_wav_path=anchor_wav, **gen)
    sf.write(os.path.join(a.out, f"{i:02d}.wav"), x, sr)
    print("done", i, flush=True)
