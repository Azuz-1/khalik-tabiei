"""Local copies of the owner-designed ElevenLabs voices on our engine (VoxCPM2 + Fasee7 Najdi LoRA, CPU).
Mode A: reference_wav_path only (timbre).  Mode B: reference + prompt continuation (timbre + delivery).
Texts = the owner-validated hidden TTS texts in segments/R_picks (same recipe as voice R).
Usage: python gen_local.py OUT_DIR [voices=F4,M2] [lines=01,05,08,12] [modes=A,B] [seeds=1,2]"""
import os, sys, json, torch, soundfile as sf
from huggingface_hub import snapshot_download
from voxcpm import VoxCPM
from voxcpm.model.voxcpm2 import LoRAConfig
H = os.path.dirname(os.path.abspath(__file__)); R = os.path.join(H, "..", "segments", "R_picks")
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
arg = lambda i, d: (sys.argv[i] if len(sys.argv) > i else d).split(",")
voices, lines, modes, seeds = arg(2, "F4,M2"), arg(3, "01,05,08,12"), arg(4, "A,B"), [int(s) for s in arg(5, "1,2")]
torch.set_num_threads(os.cpu_count())
lora = snapshot_download("Wittify/Fasee7-Najdi-Small", allow_patterns=["*.json", "lora_weights.safetensors"])
m = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, optimize=False, device="cpu",
                           lora_config=LoRAConfig(**json.load(open(f"{lora}/lora_config.json"))["lora_config"]), lora_weights_path=lora)
sr = m.tts_model.sample_rate
ptext = json.load(open(os.path.join(H, "ref", "prompt_text.json")))["prompt_text"]
for v in voices:
    ref, prm = os.path.join(H, "ref", f"{v}_ref.wav"), os.path.join(H, "ref", f"{v}_prompt.wav")
    for n in lines:
        text = json.load(open(os.path.join(R, f"{n}.json")))["phrases"][0]
        for mode in modes:
            for seed in seeds:
                fn = os.path.join(out, f"{v}_{n}_{mode}_s{seed}.wav")
                if os.path.exists(fn): continue
                torch.manual_seed(seed * 100 + 80)
                kw = dict(reference_wav_path=ref)
                t = text
                if mode == "B":  # continuation mode speaks a "(style…)" prefix aloud, so drop it
                    kw.update(prompt_wav_path=prm, prompt_text=ptext); t = text.split(")", 1)[1].strip() if text.startswith("(") else text
                x = m.generate(text=t, cfg_value=2.0, inference_timesteps=20, **kw)
                sf.write(fn, x, sr)
                json.dump(dict(phrases=[t], gaps_ms=[], seed=seed, engine="VoxCPM2+Fasee7", voice=v, mode=mode), open(fn[:-4] + ".json", "w"), ensure_ascii=False)
                print("done", os.path.basename(fn), flush=True)
