"""Round 6 (owner notes): segment 10 pronunciation variants and segment 12 wording/pronunciation variants,
R recipe (one phrase + calm style + «…» at the owner's pause points), seeds 1-2. Usage: python gen_round6.py OUT_DIR"""
import os, sys, json, torch, soundfile as sf
from huggingface_hub import snapshot_download
from voxcpm import VoxCPM
from voxcpm.model.voxcpm2 import LoRAConfig
S10 = "(calm, conversational, explaining the rules)إذا عرفت {M} تَكْسَب نقاط… وإذا گِدَر يِفْلِت، هو اللي يَكْسَب."
S12 = "(calm, conversational, asking a friendly question)الحين السؤال… {Q}؟… خَلِّك طبيعي."
V = {"10a": S10.format(M="المُتَخَفّي"), "10b": S10.format(M="المتخفي"), "10c": S10.format(M="المِتْخَفّي"),
     "12a": S12.format(Q="تِگْدَر"), "12b": S12.format(Q="تِگْدَر تخدعهم"), "12c": S12.format(Q="تِگْدَر تسايرهم")}
out = sys.argv[1]; os.makedirs(out, exist_ok=True); torch.set_num_threads(os.cpu_count())
lora = snapshot_download("Wittify/Fasee7-Najdi-Small", allow_patterns=["*.json", "lora_weights.safetensors"])
m = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, optimize=False, device="cpu",
                           lora_config=LoRAConfig(**json.load(open(f"{lora}/lora_config.json"))["lora_config"]), lora_weights_path=lora)
sr = m.tts_model.sample_rate; anchor = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../segments/G/anchor.wav")
for k, text in V.items():
    for seed in (1, 2):
        torch.manual_seed(seed * 100 + 80)
        x = m.generate(text=text, reference_wav_path=anchor, cfg_value=2.0, inference_timesteps=20)
        fn = os.path.join(out, f"{k[:2]}{k[2]}_s{seed}.wav"); sf.write(fn, x, sr)
        json.dump(dict(phrases=[text], gaps_ms=[], seed=seed, engine="R", variant=k), open(fn[:-4] + ".json", "w"), ensure_ascii=False)
        print("done", os.path.basename(fn), flush=True)
