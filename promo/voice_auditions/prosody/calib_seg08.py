"""Segment 8 on engine R (VoxCPM2 + Fasee7), calibrated to the owner's native reading:
 target: pause before «وإذا» ~220 ms; «المتخفي» continuation rise ~+4 st; juncture ~280 ms;
 «إنْمَسَكْ» low-key FALL (~2.9 st), not the most prominent word (explanatory, not exclaimed).
Approach A: two phrases, payoff with a calm style instruction and «.» (no «!»); inserted gap 160 ms
            (the engine keeps ~60 ms of its own edge silence on each side after retrim -> ~280 ms).
Approach B: one phrase, «…» juncture, calm conversational style instruction.
3 seeds each. Usage: python calib_seg08.py OUT_DIR"""
import os, sys, json, torch, soundfile as sf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from huggingface_hub import snapshot_download
from voxcpm import VoxCPM
from voxcpm.model.voxcpm2 import LoRAConfig
from common import join
out = sys.argv[1]; os.makedirs(out, exist_ok=True); torch.set_num_threads(os.cpu_count())
lora = snapshot_download("Wittify/Fasee7-Najdi-Small", allow_patterns=["*.json", "lora_weights.safetensors"])
m = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, optimize=False, device="cpu",
                           lora_config=LoRAConfig(**json.load(open(f"{lora}/lora_config.json"))["lora_config"]), lora_weights_path=lora)
sr = m.tts_model.sample_rate; anchor = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../segments/G/anchor.wav")
FIRST = "تبدون بالتصويت على الشخص اللي شاكِّين فيه… وإذا أغلبْكُم اختار المُتَخَفّي،"
V = {"A": dict(phrases=[FIRST, "(calm, matter-of-fact, explaining)إنْمَسَكْ."], gaps_ms=[160]),
     "B": dict(phrases=["(calm, conversational, explaining the rules)" + FIRST.replace("المُتَخَفّي،", "المُتَخَفّي… إنْمَسَكْ.")], gaps_ms=[])}
for name, d in V.items():
    for seed in (1, 2, 3):
        xs = []
        for k, p in enumerate(d["phrases"]):
            torch.manual_seed(seed * 100 + 80 + k)
            xs.append(m.generate(text=p, reference_wav_path=anchor, cfg_value=2.0, inference_timesteps=20))
        fn = os.path.join(out, f"08{name}_s{seed}.wav"); sf.write(fn, join(xs, d["gaps_ms"], sr), sr)
        json.dump(dict(d, seed=seed, engine="R"), open(fn[:-4] + ".json", "w"), ensure_ascii=False); print("done", os.path.basename(fn), flush=True)
