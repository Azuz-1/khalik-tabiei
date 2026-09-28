"""R recipe for the remaining segments (owner-approved method). «…» placed at the owner's measured pause
points (reference/owner_targets.json); «المُتَخَفّي» spelled as in owner-picked 10 A; «بصابعك» = the owner's spoken form.
Seeds 1-3. Usage: python gen_rest.py OUT_DIR [SEG...]"""
import os, sys, json, torch, soundfile as sf
from huggingface_hub import snapshot_download
from voxcpm import VoxCPM
from voxcpm.model.voxcpm2 import LoRAConfig
R = {
 1: "(calm, playful, curious, conversational)تَخَيَّل كلهم يرفعون يِدْهُم… وأنت الوحيد اللي ما تَدري وش السالفة!",   # owner: 230 ms after «يدهم»
 2: "(calm, friendly, introducing a game)هذي «خَلِّك طبيعي»… لعبة جماعية، وواحد منكم ما يَدري وش المطلوب.",       # 260 ms after «طبيعي»
 3: "(casual, quick, conversational)تدخلون من جوالاتكم، بدون تحميل ولا تسجيل.",                                # 100 ms after «جوالاتكم»
 4: "(calm, conversational, slightly secretive)كل واحد يشوف المطلوب بجواله… إلا المُتَخَفّي ما يطلع له شيء.",       # 120 ms after «بجواله»
 6: "(calm, conversational, playful)هنا لازم المُتَخَفّي يحاول يقلّدكم… ويحاول ما يَفْضَح نفسه.",                   # 240 ms after «يقلدكم»
 9: "(calm, conversational, lively)مرة ترفع يدك، مرة تِأَشِّر، ومرة تِوَرِّي رقم بصابعك… وكل جولة غير.",             # 120 ms, 640 ms after «بصابعك»
 11: "(calm, conversational, satisfied conclusion)وبالنهاية… أكثر واحد جمع نقاط هو الفايز.",                    # 130 ms after «وبالنهاية»
}
out = sys.argv[1]; segs = [int(s) for s in sys.argv[2:]] or list(R); os.makedirs(out, exist_ok=True); torch.set_num_threads(os.cpu_count())
lora = snapshot_download("Wittify/Fasee7-Najdi-Small", allow_patterns=["*.json", "lora_weights.safetensors"])
m = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, optimize=False, device="cpu",
                           lora_config=LoRAConfig(**json.load(open(f"{lora}/lora_config.json"))["lora_config"]), lora_weights_path=lora)
sr = m.tts_model.sample_rate; anchor = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../segments/G/anchor.wav")
for seg in segs:
    for seed in (1, 2, 3):
        torch.manual_seed(seed * 100 + 80)
        x = m.generate(text=R[seg], reference_wav_path=anchor, cfg_value=2.0, inference_timesteps=20)
        fn = os.path.join(out, f"{seg:02d}_s{seed}.wav"); sf.write(fn, x, sr)
        json.dump(dict(phrases=[R[seg]], gaps_ms=[], seed=seed, engine="R", recipe="one-phrase+style+…"), open(fn[:-4] + ".json", "w"), ensure_ascii=False)
        print("done", os.path.basename(fn), flush=True)
