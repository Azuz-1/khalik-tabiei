"""Round 12 (owner notes on the confirmed narration): class-A spelling fixes for lines 1, 3, 5, 6.
Same style instruction as the owner's pick; the pick's seed plus two more. Usage: python gen_round12.py OUT_DIR"""
import os, sys, json, torch, soundfile as sf
from huggingface_hub import snapshot_download
from voxcpm import VoxCPM
from voxcpm.model.voxcpm2 import LoRAConfig
J = []
L1 = "(calm, playful, curious, conversational)تَخَيَّل كلهم يرفعون يِدّهُم… وأنت الوحيد اللي ما تَدري وش السالفة!"
J += [("01", L1, s) for s in (2, 12, 22)]
L3a = "(casual, quick, conversational)تدْخلون من جوالاتكم، بدون تحميل، ولا تسجيل."
L3b = "(casual, quick, conversational)تدْخلون من جوالاتكم، بدون تحميل… ولا تسجيل."
J += [("03a", L3a, s) for s in (2, 12)] + [("03b", L3b, s) for s in (2, 12)]
L5 = "(calm, playful countdown, relaxed)ثلاثة… اثنين… واحد… اِرْفَع يِدّكْ."
J += [("05", L5, s) for s in (2, 12, 22)]
L6 = "(calm, conversational, playful)هنا لازم المُتَخَفّي يحاول يگلّدكم… ويحاول ما يَفْضَح نفسه."
J += [("06", L6, s) for s in (4, 14, 24)]
out = sys.argv[1]; os.makedirs(out, exist_ok=True); torch.set_num_threads(os.cpu_count())
lora = snapshot_download("Wittify/Fasee7-Najdi-Small", allow_patterns=["*.json", "lora_weights.safetensors"])
m = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, optimize=False, device="cpu",
                           lora_config=LoRAConfig(**json.load(open(f"{lora}/lora_config.json"))["lora_config"]), lora_weights_path=lora)
sr = m.tts_model.sample_rate; anchor = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../segments/G/anchor.wav")
for k, text, seed in J:
    torch.manual_seed(seed * 100 + 80)
    x = m.generate(text=text, reference_wav_path=anchor, cfg_value=2.0, inference_timesteps=20)
    fn = os.path.join(out, f"{k}_s{seed}.wav"); sf.write(fn, x, sr)
    json.dump(dict(phrases=[text], gaps_ms=[], seed=seed, engine="R", variant=k), open(fn[:-4] + ".json", "w"), ensure_ascii=False)
    print("done", os.path.basename(fn), flush=True)
