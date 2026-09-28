"""Voice D: Lahgtna-OmniVoice-v2 (oddadmix) — OmniVoice fine-tuned for Arabic
dialects incl. Saudi, run with the `lahgtna-omnivoice` package and its Saudi
language id "sa" ("Saudi Lahgtna").

No real-person reference audio. A voice is *designed* from attributes
(OmniVoice "instruct"), rendered once on a short anchor line that is not
part of the script, and that synthetic anchor is then used as the voice
prompt for all 12 segments so the narrator stays the same person.

Usage: python gen_omnivoice.py OUT_DIR [--seed N] [segment numbers...]
Text: the approved hidden script (hidden_script.HIDDEN) verbatim.
"""
import os, sys, argparse, numpy as np, soundfile as sf, torch
from omnivoice import OmniVoice, OmniVoiceGenerationConfig
from hidden_script import HIDDEN

CKPT = "oddadmix/lahgtna-omnivoice-v2"
INSTRUCT = "male, young adult, moderate pitch"
ANCHOR = "هلا والله! اليوم عندي لكم لعبة حلوة مرة، تعالوا أعلمكم عليها."
LANG = "sa"  # "Saudi Lahgtna" id in the lahgtna-omnivoice package (not the generic "ars")

ap = argparse.ArgumentParser()
ap.add_argument("out"); ap.add_argument("segs", nargs="*", type=int)
ap.add_argument("--seed", type=int, default=11)
a = ap.parse_intermixed_args(); os.makedirs(a.out, exist_ok=True)
torch.set_num_threads(os.cpu_count())

model = OmniVoice.from_pretrained(CKPT, device_map="cpu", dtype=torch.float32)
sr = model.sampling_rate
cfg = OmniVoiceGenerationConfig(num_step=32, guidance_scale=2.0)

anchor_wav = os.path.join(a.out, "anchor.wav")
if not os.path.exists(anchor_wav):
    torch.manual_seed(a.seed)
    x = model.generate(text=ANCHOR, language=LANG, instruct=INSTRUCT, generation_config=cfg)[0]
    sf.write(anchor_wav, x, sr); print("anchor done", flush=True)
prompt = model.create_voice_clone_prompt(ref_audio=anchor_wav, ref_text=ANCHOR)

for i in a.segs or range(1, 13):
    torch.manual_seed(a.seed + i)
    text = HIDDEN[i - 1].replace("«", "").replace("»", "")
    x = model.generate(text=text, language=LANG, voice_clone_prompt=prompt, generation_config=cfg)[0]
    sf.write(os.path.join(a.out, f"{i:02d}.wav"), x, sr)
    print("done", i, flush=True)
