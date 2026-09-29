"""Round 2: mode B with a line-matched prompt from the Voice 4 bank (ref/F4_prompt_bank.json). Female only.
Usage: python gen_bank.py OUT_DIR [lines=01,05,08,12] [seeds=1,2,3]"""
import os, sys, json, torch, soundfile as sf
from huggingface_hub import snapshot_download
from voxcpm import VoxCPM
from voxcpm.model.voxcpm2 import LoRAConfig
H = os.path.dirname(os.path.abspath(__file__)); R = os.path.join(H, "..", "segments", "R_picks")
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
lines = (sys.argv[2] if len(sys.argv) > 2 else "01,05,08,12").split(","); seeds = [int(s) for s in (sys.argv[3] if len(sys.argv) > 3 else "1,2,3").split(",")]
torch.set_num_threads(os.cpu_count())
lora = snapshot_download("Wittify/Fasee7-Najdi-Small", allow_patterns=["*.json", "lora_weights.safetensors"])
m = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, optimize=False, device="cpu",
                           lora_config=LoRAConfig(**json.load(open(f"{lora}/lora_config.json"))["lora_config"]), lora_weights_path=lora)
bank = json.load(open(os.path.join(H, "ref", "F4_prompt_bank.json")))
for n in lines:
    t = json.load(open(os.path.join(R, f"{n}.json")))["phrases"][0].split(")", 1)[1].strip()
    b = bank[n]
    for seed in seeds:
        fn = os.path.join(out, f"F4_{n}_bank_s{seed}.wav")
        if os.path.exists(fn): continue
        torch.manual_seed(seed * 100 + 80)
        x = m.generate(text=t, reference_wav_path=os.path.join(H, "ref", "F4_ref.wav"), prompt_wav_path=os.path.join(H, b["prompt_wav"]),
                       prompt_text=b["prompt_text"], cfg_value=2.0, inference_timesteps=20)
        sf.write(fn, x, m.tts_model.sample_rate)
        json.dump(dict(text=t, seed=seed, prompt_from_line=b["from_line"], mode="B-bank"), open(fn[:-4] + ".json", "w"), ensure_ascii=False)
        print("done", os.path.basename(fn), flush=True)
