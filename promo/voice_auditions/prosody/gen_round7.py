"""Round 7: segment 12 wording (owner). Same R recipe/seeding as round 6.
 12b2 = «تِگْدَر تخدعهم؟» on seed 2 (= the seed/settings of the owner-liked C take)
 12n1 = new line «الحين السؤال… تِگْدَر تضحك عليهم؟… خَلِّك طبيعي.» (seeds 1, 2)
 12n2 = new line «طيب… لو كنت أنت المُتَخَفّي؟… خَلِّك طبيعي.» (seeds 1, 2)"""
import os, sys, json, torch, soundfile as sf
from huggingface_hub import snapshot_download
from voxcpm import VoxCPM
from voxcpm.model.voxcpm2 import LoRAConfig
ST = "(calm, conversational, asking a friendly question)"
JOBS = [("12b", ST + "الحين السؤال… تِگْدَر تخدعهم؟… خَلِّك طبيعي.", 2),
        ("12n1", ST + "الحين السؤال… تِگْدَر تضحك عليهم؟… خَلِّك طبيعي.", 1),
        ("12n1", ST + "الحين السؤال… تِگْدَر تضحك عليهم؟… خَلِّك طبيعي.", 2),
        ("12n2", ST + "طيب… لو كنت أنت المُتَخَفّي؟… خَلِّك طبيعي.", 1),
        ("12n2", ST + "طيب… لو كنت أنت المُتَخَفّي؟… خَلِّك طبيعي.", 2)]
out = sys.argv[1]; os.makedirs(out, exist_ok=True); torch.set_num_threads(os.cpu_count())
lora = snapshot_download("Wittify/Fasee7-Najdi-Small", allow_patterns=["*.json", "lora_weights.safetensors"])
m = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, optimize=False, device="cpu",
                           lora_config=LoRAConfig(**json.load(open(f"{lora}/lora_config.json"))["lora_config"]), lora_weights_path=lora)
sr = m.tts_model.sample_rate; anchor = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../segments/G/anchor.wav")
for k, text, seed in JOBS:
    torch.manual_seed(seed * 100 + 80)
    x = m.generate(text=text, reference_wav_path=anchor, cfg_value=2.0, inference_timesteps=20)
    fn = os.path.join(out, f"{k}_s{seed}.wav"); sf.write(fn, x, sr)
    json.dump(dict(phrases=[text], gaps_ms=[], seed=seed, engine="R", variant=k), open(fn[:-4] + ".json", "w"), ensure_ascii=False)
    print("done", os.path.basename(fn), flush=True)
