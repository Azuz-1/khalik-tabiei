"""Round-2 listening fixes for segment 8 (owner notes 2026-09-28):
 K 8-t1: vowels wrong -> «أغلبْكُم» (not أغلبَكُم), «إنْمَسَكْ» (owner's own pronunciation).
 V 8-t2: «اختار» heard as «اخطار»; «تبدون» د heavy (front end gave MSA «tbduːna»).
Engine V (Nabra): 3 variants; engine R (VoxCPM, owner's pick this round): 3 variants.
Usage: python fix_seg08.py V OUT | python fix_seg08.py R OUT"""
import os, sys, json, numpy as np, soundfile as sf
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from common import join
eng, out = sys.argv[1], sys.argv[2]; os.makedirs(out, exist_ok=True)
A = "تبدون بالتصويت على الشخص اللي شاكِّين فيه… وإذا أغلبْكُم اختار المُتَخَفّي،"
if eng == "V":
    # V spellings: تِبْدُون -> tibduːn (no MSA -na); اِنْمَسَكْ -> ʔinmasak (keeps the initial «إن» vowel)
    P = {"08_fix1": dict(desc="تِبْدُون + أغلبْكُم, payoff isolated (320 ms) as اِنْمَسَكْ",
                         phrases=[A.replace("تبدون", "تِبْدُون"), "اِنْمَسَكْ!"], gaps_ms=[320]),
         "08_fix2": dict(desc="fix1 + «إخْتار» syllabification (ʔχtaːr) against the heard «ط»",
                         phrases=[A.replace("تبدون", "تِبْدُون").replace("اختار", "إخْتار"), "اِنْمَسَكْ!"], gaps_ms=[320]),
         "08_fix3": dict(desc="fix1 spellings, payoff kept in the sentence",
                         phrases=[A.replace("تبدون", "تِبْدُون") + " اِنْمَسَكْ!"], gaps_ms=[])}
    from huggingface_hub import snapshot_download
    sys.path.insert(0, snapshot_download("oddadmix/Nabra-Saudi-82M", allow_patterns=["*.py", "*.json", "af_msa.pt", "nabra_saudi_82m_v0.pth", "kokoro_patched/**"]))
    from load_model import load
    _, pipe, voice = load(device="cpu"); sr = 24000
    gen = lambda p, k, seed: np.concatenate([r[2].numpy() for r in pipe(p, voice=voice, speed=1.0)])
else:
    P = {"08_fix1": dict(desc="owner spellings, payoff in the sentence", phrases=[A + " إنْمَسَكْ!"], gaps_ms=[], seed=1),
         "08_fix2": dict(desc="owner spellings, payoff isolated (250 ms) as إنْمَسَكْ", phrases=[A, "إنْمَسَكْ!"], gaps_ms=[250], seed=1),
         "08_fix3": dict(desc="fix2 with seed 2", phrases=[A, "إنْمَسَكْ!"], gaps_ms=[250], seed=2)}
    import torch
    from huggingface_hub import snapshot_download
    from voxcpm import VoxCPM
    from voxcpm.model.voxcpm2 import LoRAConfig
    torch.set_num_threads(os.cpu_count())
    lora = snapshot_download("Wittify/Fasee7-Najdi-Small", allow_patterns=["*.json", "lora_weights.safetensors"])
    m = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, optimize=False, device="cpu",
                               lora_config=LoRAConfig(**json.load(open(f"{lora}/lora_config.json"))["lora_config"]), lora_weights_path=lora)
    sr = m.tts_model.sample_rate
    anchor = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../segments/G/anchor.wav")
    def gen(p, k, seed):
        torch.manual_seed(seed * 100 + 80 + k)
        return m.generate(text=p, reference_wav_path=anchor, cfg_value=2.0, inference_timesteps=20)
for name, d in P.items():
    xs = [gen(p, k, d.get("seed", 1)) for k, p in enumerate(d["phrases"])]
    fn = os.path.join(out, f"{name}.wav"); sf.write(fn, join(xs, d["gaps_ms"], sr), sr)
    json.dump(dict(d, engine=eng), open(fn[:-4] + ".json", "w"), ensure_ascii=False); print("done", name, flush=True)
