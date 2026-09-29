"""Lahgtna (oddadmix/lahgtna-chatterbox-v1, MIT): Chatterbox multilingual fine-tuned on dialect speech; dialect "sa" = Saudi.
Needs the author's code: git clone https://github.com/Oddadmix/lahgtna-chatterbox (commit 433cb74) and PYTHONPATH=<clone>.
Usage: VOICE=F4|M2 python gen_lahgtna.py OUT_DIR [lines=01,05,08,12] [seeds=1,2,3,4]"""
import json, os, re, sys, torch, torchaudio as ta
from pathlib import Path
from huggingface_hub import snapshot_download
from src.chatterbox.mtl_tts import ChatterboxMultilingualTTS
H = os.path.dirname(os.path.abspath(__file__)); R = os.path.join(H, "..", "segments", "R_picks")
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
lines = (sys.argv[2] if len(sys.argv) > 2 else "01,05,08,12").split(","); seeds = [int(s) for s in (sys.argv[3] if len(sys.argv) > 3 else "1,2,3,4").split(",")]
VOICE = os.environ.get("VOICE", "F4"); ref = os.path.join(H, "ref", f"{VOICE}_ref.wav")
torch.set_num_threads(os.cpu_count())
_load = torch.load  # checkpoints were saved on CUDA; this machine is CPU-only
torch.load = lambda *a, **k: _load(*a, **{**k, "map_location": k.get("map_location") or "cpu"})
ck = snapshot_download("oddadmix/lahgtna-chatterbox-v1", allow_patterns=["ve.pt", "t3_mtl23ls_v2.safetensors", "s3gen.pt", "grapheme_mtl_merged_expanded_v1.json", "conds.pt", "Cangjie5_TC.json"])
m = ChatterboxMultilingualTTS.from_checkpoint(str(ck) + "/", "cpu")
for n in lines:
    t = json.load(open(os.path.join(R, f"{n}.json")))["phrases"][0].split(")", 1)[1].strip()  # keeps the owner-validated tashkeel (Lahgtna supports it)
    for s in seeds:
        fn = os.path.join(out, f"LG{VOICE}_{n}_s{s}.wav")
        if os.path.exists(fn): continue
        torch.manual_seed(s * 100 + 80)
        w = m.generate(t, language_id="sa", audio_prompt_path=ref, exaggeration=0.5, cfg_weight=0.5, temperature=0.8, repetition_penalty=2.0)
        ta.save(fn, w, m.sr); json.dump(dict(model="lahgtna-sa", voice=VOICE, text=t, seed=s), open(fn[:-4] + ".json", "w"), ensure_ascii=False)
        print("done", os.path.basename(fn), flush=True)
