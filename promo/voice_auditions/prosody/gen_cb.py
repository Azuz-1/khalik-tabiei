"""Engine CB: NAMAA-Saudi-TTS (Chatterbox Multilingual T3 fine-tune), built-in default voice.
No style instructions: prosody variables are exaggeration/cfg_weight (model-native), phrase
split and pause. Usage: python gen_cb.py OUT_DIR --seeds 1 2 [--only ..] [--ids ..] [--ex 0.5 --cfg 0.4 --tag x]"""
import os, sys, json, argparse, soundfile as sf, torch
sys.path.insert(0, os.path.dirname(__file__))
from huggingface_hub import snapshot_download
from safetensors.torch import load_file
from chatterbox import mtl_tts
from variants import V
from common import join

ap = argparse.ArgumentParser(); ap.add_argument("out")
ap.add_argument("--seeds", nargs="+", type=int, default=[1, 2])
ap.add_argument("--only", nargs="*", type=int); ap.add_argument("--ids", nargs="*")
ap.add_argument("--ex", type=float, default=0.5); ap.add_argument("--cfg", type=float, default=0.4)
ap.add_argument("--tag", default="")
a = ap.parse_args(); os.makedirs(a.out, exist_ok=True); torch.set_num_threads(os.cpu_count())
m = mtl_tts.ChatterboxMultilingualTTS.from_pretrained(device="cpu")
m.t3.load_state_dict(load_file(snapshot_download("NAMAA-Space/NAMAA-Saudi-TTS", allow_patterns=["t3_mtl23ls_v2.safetensors"]) + "/t3_mtl23ls_v2.safetensors", device="cpu")); m.t3.eval()
for v in V:
    if a.only and v["seg"] not in a.only: continue
    if a.ids and f'{v["seg"]}{v["id"]}' not in a.ids: continue
    for sd in a.seeds:
        fn = os.path.join(a.out, f'{v["seg"]:02d}{v["id"]}{a.tag}_s{sd}.wav')
        if os.path.exists(fn): continue
        xs = []
        for k, p in enumerate(v["parts"]):
            torch.manual_seed(sd * 100 + k)
            xs.append(m.generate(p["text"], language_id="ar", exaggeration=a.ex, cfg_weight=a.cfg, temperature=0.8).squeeze(0).numpy())
        sf.write(fn, join(xs, v["gaps_ms"], m.sr), m.sr)
        json.dump(dict(v, seed=sd, engine="cb", exaggeration=a.ex, cfg_weight=a.cfg), open(fn[:-4] + ".json", "w"), ensure_ascii=False)
        print("done", os.path.basename(fn), flush=True)
