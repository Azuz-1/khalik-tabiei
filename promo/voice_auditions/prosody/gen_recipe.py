"""Engine R recipe (owner-approved on segment 8, cal3): one phrase per line, calm conversational
style instruction, «…» at the owner's measured pause points, «.» on explanatory payoffs, 3 seeds.
Pause points come from the owner's reading (reference/owner_targets.json).
Usage: python gen_recipe.py OUT_DIR SEG [SEG...]"""
import os, sys, json, torch, soundfile as sf
from huggingface_hub import snapshot_download
from voxcpm import VoxCPM
from voxcpm.model.voxcpm2 import LoRAConfig
RECIPE = {
 # owner: «السؤال» 390 ms «تقدر»↗ 320 ms «خلك طبيعي»↘
 12: "(calm, conversational, asking a friendly question)الحين السؤال… تِقْدَر؟… خَلِّك طبيعي.",
 # owner: «ثلاثة اثنين» 550 ms «واحد»↗ (peak) 240 ms «ارفع يدك»↘ low-key
 5: "(calm, playful countdown, relaxed)ثلاثة… اثنين… واحد… اِرْفَع يَدَك.",
 # owner: «المطلوب»↗ short juncture, «يشك»↗ accent, «بالثاني» low
 7: "(calm, conversational, playfully suspicious)بعدها يِنكَشِف المطلوب… وكل واحد يبدأ يِشِكْ بالثاني.",
 # owner: «المتخفي»↗ … «نقاط» 500 ms «وإذا قدر يفلت»↗ 190 ms «هو اللي يكسب»
 10: "(calm, conversational, explaining the rules)إذا عرفت المُتَخَفّي تَكْسَب نقاط… وإذا قِدَر يِفْلِت، هو اللي يَكْسَب.",
 8: "(calm, conversational, explaining the rules)تبدون بالتصويت على الشخص اللي شاكِّين فيه… وإذا أغلبْكُم اختار المُتَخَفّي… إنْمَسَكْ.",
}
out = sys.argv[1]; segs = [int(s) for s in sys.argv[2:]]; os.makedirs(out, exist_ok=True); torch.set_num_threads(os.cpu_count())
lora = snapshot_download("Wittify/Fasee7-Najdi-Small", allow_patterns=["*.json", "lora_weights.safetensors"])
m = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, optimize=False, device="cpu",
                           lora_config=LoRAConfig(**json.load(open(f"{lora}/lora_config.json"))["lora_config"]), lora_weights_path=lora)
sr = m.tts_model.sample_rate; anchor = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../segments/G/anchor.wav")
for seg in segs:
    for seed in (1, 2, 3):
        torch.manual_seed(seed * 100 + 80)  # same seeding as calib_seg08 approach B (cal3 = seed 3)
        x = m.generate(text=RECIPE[seg], reference_wav_path=anchor, cfg_value=2.0, inference_timesteps=20)
        fn = os.path.join(out, f"{seg:02d}_s{seed}.wav"); sf.write(fn, x, sr)
        json.dump(dict(phrases=[RECIPE[seg]], gaps_ms=[], seed=seed, engine="R", recipe="one-phrase+style+…"), open(fn[:-4] + ".json", "w"), ensure_ascii=False)
        print("done", os.path.basename(fn), flush=True)
