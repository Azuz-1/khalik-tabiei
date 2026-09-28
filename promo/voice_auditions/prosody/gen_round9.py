"""Round 9: re-takes where timing predictor and pronunciation screen disagreed or nothing matched the owner.
 2: same text, seeds 4-5.  4: «…» -> «،» (owner pauses only 120 ms there), seeds 1-3.
 9: split before «وكل جولة غير» (owner pauses 630 ms there; one-phrase takes gave <=190 ms), gap 500 ms
    (+~120 ms engine edge silence kept by retrim_gaps.py), seeds 1-3."""
import os, sys, json, torch, soundfile as sf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from huggingface_hub import snapshot_download
from voxcpm import VoxCPM
from voxcpm.model.voxcpm2 import LoRAConfig
from common import join
J = [(2, s, ["(calm, friendly, introducing a game)هذي «خَلِّك طبيعي»… لعبة جماعية، وواحد منكم ما يَدري وش المطلوب."], []) for s in (4, 5)]
J += [(4, s, ["(calm, conversational, slightly secretive)كل واحد يشوف المطلوب بجواله، إلا المُتَخَفّي ما يطلع له شيء."], []) for s in (1, 2, 3)]
J += [(9, s, ["(calm, conversational, lively)مرة ترفع يدك، مرة تِأَشِّر، ومرة تِوَرِّي رقم بصابعك…", "(calm, conversational)وكل جولة غير."], [500]) for s in (1, 2, 3)]
out = sys.argv[1]; os.makedirs(out, exist_ok=True); torch.set_num_threads(os.cpu_count())
lora = snapshot_download("Wittify/Fasee7-Najdi-Small", allow_patterns=["*.json", "lora_weights.safetensors"])
m = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, optimize=False, device="cpu",
                           lora_config=LoRAConfig(**json.load(open(f"{lora}/lora_config.json"))["lora_config"]), lora_weights_path=lora)
sr = m.tts_model.sample_rate; anchor = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../segments/G/anchor.wav")
for seg, seed, phrases, gaps in J:
    xs = []
    for k, p in enumerate(phrases):
        torch.manual_seed(seed * 100 + 80 + k)
        xs.append(m.generate(text=p, reference_wav_path=anchor, cfg_value=2.0, inference_timesteps=20))
    fn = os.path.join(out, f"{seg:02d}_s{seed}.wav"); sf.write(fn, join(xs, gaps, sr), sr)
    json.dump(dict(phrases=phrases, gaps_ms=gaps, seed=seed, engine="R"), open(fn[:-4] + ".json", "w"), ensure_ascii=False)
    print("done", os.path.basename(fn), flush=True)
