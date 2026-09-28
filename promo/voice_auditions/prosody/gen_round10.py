"""Round 10 class-A fixes. 3: «تدْخلون» / «تِدْخلون» (sukun on د, against the heard shadda), seeds 1-2.
6: «المتختفي» heard -> current «المُتَخَفّي» on new seeds 4-5, and plain «المتخفي» seeds 1-2. Same R recipe."""
import os, sys, json, torch, soundfile as sf
from huggingface_hub import snapshot_download
from voxcpm import VoxCPM
from voxcpm.model.voxcpm2 import LoRAConfig
S3 = "(casual, quick, conversational){W} من جوالاتكم، بدون تحميل ولا تسجيل."
S6 = "(calm, conversational, playful)هنا لازم {M} يحاول يقلّدكم… ويحاول ما يَفْضَح نفسه."
J = [("03a", S3.format(W="تدْخلون"), 1), ("03a", S3.format(W="تدْخلون"), 2),
     ("03b", S3.format(W="تِدْخلون"), 1), ("03b", S3.format(W="تِدْخلون"), 2),
     ("06a", S6.format(M="المُتَخَفّي"), 4), ("06a", S6.format(M="المُتَخَفّي"), 5),
     ("06b", S6.format(M="المتخفي"), 1), ("06b", S6.format(M="المتخفي"), 2)]
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
