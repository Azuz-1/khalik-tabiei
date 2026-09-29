"""Say a line with a local voice (free, offline after the first model download).

    python say.py "الحين السؤال… تِگْدَر تخدعهم؟" --voice F4 --takes 3
    python say.py lines.txt --voice M2            # one line per row

Voices: F4 = copy of the owner's ElevenLabs "Voice 4" (female), M2 = copy of "Voice 2" (male),
        R  = the original designed voice of the first video.
Writes out/<voice>_<nn>_t<k>.wav — listen and keep the best take (takes differ a lot; 3 is a good default).
Write lines the way RECIPE.md §2–3 says: «…» where you pause, «.» on calm payoffs,
hidden spellings such as «گ» for Najdi ق, «يِدّك», «إنْمَسَكْ.».
Needs ~10 GB RAM and runs at about 1 minute per take on a laptop CPU; much faster with a GPU (--device cuda).
Setup once: pip install voxcpm soundfile huggingface_hub"""
import argparse, json, os, torch, soundfile as sf
from huggingface_hub import snapshot_download
from voxcpm import VoxCPM
from voxcpm.model.voxcpm2 import LoRAConfig

H = os.path.dirname(os.path.abspath(__file__))
VOICES = {"F4": os.path.join(H, "ref", "F4_ref.wav"), "M2": os.path.join(H, "ref", "M2_ref.wav"),
          "R": os.path.join(H, "..", "segments", "G", "anchor.wav")}
STYLE = "(calm, conversational, playful)"  # default style prefix when a line has none

ap = argparse.ArgumentParser()
ap.add_argument("text", help="a line of Arabic text, or a .txt file with one line per row")
ap.add_argument("--voice", default="F4", choices=VOICES)
ap.add_argument("--takes", type=int, default=3)
ap.add_argument("--mode", default="A", choices=["A", "B"], help="A: copy the voice's sound; B: also continue its delivery")
ap.add_argument("--out", default=os.path.join(H, "out"))
ap.add_argument("--device", default="cuda" if torch.cuda.is_available() else "cpu")
a = ap.parse_args()

lines = [l.strip() for l in open(a.text, encoding="utf-8")] if a.text.endswith(".txt") else [a.text]
lines = [l if l.startswith("(") else STYLE + l for l in lines if l]
os.makedirs(a.out, exist_ok=True); torch.set_num_threads(os.cpu_count())
lora = snapshot_download("Wittify/Fasee7-Najdi-Small", allow_patterns=["*.json", "lora_weights.safetensors"])
m = VoxCPM.from_pretrained("openbmb/VoxCPM2", load_denoiser=False, optimize=False, device=a.device,
                           lora_config=LoRAConfig(**json.load(open(f"{lora}/lora_config.json"))["lora_config"]), lora_weights_path=lora)
kw = dict(reference_wav_path=VOICES[a.voice])
B = a.mode == "B" and a.voice != "R"
if B:  # continuation mode reads a "(style…)" prefix aloud, so it is removed below
    kw.update(prompt_wav_path=os.path.join(H, "ref", f"{a.voice}_prompt.wav"),
              prompt_text=json.load(open(os.path.join(H, "ref", "prompt_text.json")))["prompt_text"])
for i, line in enumerate(lines, 1):
    for k in range(1, a.takes + 1):
        torch.manual_seed(k * 100 + 80)
        x = m.generate(text=line.split(")", 1)[1].strip() if B and line.startswith("(") else line, cfg_value=2.0, inference_timesteps=20, **kw)
        fn = os.path.join(a.out, f"{a.voice}_{i:02d}_t{k}.wav"); sf.write(fn, x, m.tts_model.sample_rate)
        print(fn, flush=True)
