"""Engine VOX: VoxCPM2 + Fasee7 Najdi LoRA, casual female voice (sample G anchor).
Style instructions use VoxCPM2 controllable cloning: "(style)text" + reference audio.
Usage: python gen_vox.py OUT_DIR --seeds 1 2 [--only 5 12] [--ids 5b 12c]"""
import os, sys, json, argparse, soundfile as sf, torch
sys.path.insert(0, os.path.dirname(__file__))
from huggingface_hub import snapshot_download
from voxcpm import VoxCPM
from voxcpm.model.voxcpm2 import LoRAConfig
from variants import V
from common import join

ap = argparse.ArgumentParser(); ap.add_argument("out")
ap.add_argument("--seeds", nargs="+", type=int, default=[1, 2])
ap.add_argument("--only", nargs="*", type=int); ap.add_argument("--ids", nargs="*")
ap.add_argument("--anchor", default=os.path.join(os.path.dirname(__file__), "../segments/G/anchor.wav"))
a = ap.parse_args(); os.makedirs(a.out, exist_ok=True); torch.set_num_threads(os.cpu_count())
lora = snapshot_download("Wittify/Fasee7-Najdi-Small", allow_patterns=["*.json", "lora_weights.safetensors"])
m = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, optimize=False, device="cpu",
                           lora_config=LoRAConfig(**json.load(open(f"{lora}/lora_config.json"))["lora_config"]),
                           lora_weights_path=lora)
sr = m.tts_model.sample_rate
for v in V:
    if a.only and v["seg"] not in a.only: continue
    if a.ids and f'{v["seg"]}{v["id"]}' not in a.ids: continue
    for sd in a.seeds:
        fn = os.path.join(a.out, f'{v["seg"]:02d}{v["id"]}_s{sd}.wav')
        if os.path.exists(fn): continue
        xs = []
        for k, p in enumerate(v["parts"]):
            torch.manual_seed(sd * 100 + k)
            text = (f'({p["style"]})' if p["style"] else "") + p["text"]
            xs.append(m.generate(text=text, reference_wav_path=a.anchor, cfg_value=2.0, inference_timesteps=20))
        sf.write(fn, join(xs, v["gaps_ms"], sr), sr)
        json.dump(dict(v, seed=sd, engine="vox"), open(fn[:-4] + ".json", "w"), ensure_ascii=False)
        print("done", os.path.basename(fn), flush=True)
