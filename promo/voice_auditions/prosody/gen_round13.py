"""Round 13: line 6 re-takes (same text/style as round 12, «يگلّدكم»), seeds 34-84."""
import os, sys, json, torch, soundfile as sf
from huggingface_hub import snapshot_download
from voxcpm import VoxCPM
from voxcpm.model.voxcpm2 import LoRAConfig
L6 = "(calm, conversational, playful)هنا لازم المُتَخَفّي يحاول يگلّدكم… ويحاول ما يَفْضَح نفسه."
out = sys.argv[1]; os.makedirs(out, exist_ok=True); torch.set_num_threads(os.cpu_count())
lora = snapshot_download("Wittify/Fasee7-Najdi-Small", allow_patterns=["*.json", "lora_weights.safetensors"])
m = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, optimize=False, device="cpu",
                           lora_config=LoRAConfig(**json.load(open(f"{lora}/lora_config.json"))["lora_config"]), lora_weights_path=lora)
sr = m.tts_model.sample_rate; anchor = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../segments/G/anchor.wav")
for seed in (34, 44, 54, 64, 74, 84):
    torch.manual_seed(seed * 100 + 80)
    x = m.generate(text=L6, reference_wav_path=anchor, cfg_value=2.0, inference_timesteps=20)
    fn = os.path.join(out, f"06_s{seed}.wav"); sf.write(fn, x, sr)
    json.dump(dict(phrases=[L6], gaps_ms=[], seed=seed, engine="R"), open(fn[:-4] + ".json", "w"), ensure_ascii=False)
    print("done", os.path.basename(fn), flush=True)
