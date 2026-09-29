"""Free local test of two Saudi F5-TTS models, voiced with the Voice 4 sample (non-commercial licences: CC-BY-NC-SA-4.0).
  N2 = NAMAA-Space/NAMAA-Saudi-TTS-V2 (Najdi, Habibi-TTS fine-tune, 335M)
  S4 = khalidhabbash/Saudi-tts-v4    (Najdi/Hijazi/Khaliji broadcast speech, 163M)
Text = the owner-validated script with tashkeel removed (these engines learned undiacritised text); «گ» kept.
Usage: python gen_saudi_f5.py OUT_DIR [models=N2,S4] [lines=01,05,08,12] [seeds=1,2,3]"""
import json, os, re, sys, torch, soundfile as sf, yaml
from huggingface_hub import hf_hub_download, snapshot_download
from safetensors.torch import load_file
from f5_tts.model import CFM, DiT
from f5_tts.model.utils import get_tokenizer
from f5_tts.infer.utils_infer import load_model, load_vocoder, preprocess_ref_audio_text, infer_process as f5_infer

H = os.path.dirname(os.path.abspath(__file__)); R = os.path.join(H, "..", "segments", "R_picks")
TK = re.compile(r"[ً-ْ]")
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
arg = lambda i, d: (sys.argv[i] if len(sys.argv) > i else d).split(",")
models, lines, seeds = arg(2, "N2,S4"), arg(3, "01,05,08,12"), [int(s) for s in arg(4, "1,2,3")]
torch.set_num_threads(os.cpu_count())
VOICE = os.environ.get("VOICE", "F4")  # F4 = Voice 4 sample, M2 = Voice 2 (male) sample
ref_wav = os.path.join(H, "ref", f"{VOICE}_prompt.wav")
ref_txt = TK.sub("", json.load(open(os.path.join(H, "ref", "prompt_text.json")))["prompt_text"]).replace("«", "").replace("»", "")
def text(n): return TK.sub("", json.load(open(os.path.join(R, f"{n}.json")))["phrases"][0].split(")", 1)[1]).strip()

for mname in models:
    if mname == "N2":
        from habibi_tts.infer.utils_infer import infer_process as infer
        repo = "NAMAA-Space/NAMAA-Saudi-TTS-V2"
        model = load_model(DiT, dict(dim=1024, depth=22, heads=16, ff_mult=2, text_dim=512, conv_layers=4),
                           hf_hub_download(repo, "model_last.pt"), vocab_file=hf_hub_download(repo, "vocab.txt"), device="cpu").to(torch.float32).eval()
        voc = load_vocoder(); kw = dict(nfe_step=32)
    else:
        root = snapshot_download("khalidhabbash/Saudi-tts-v4"); cfg = yaml.safe_load(open(os.path.join(root, "inference_config.yaml")))
        vm, vs = get_tokenizer(os.path.join(root, "vocab.txt"), "custom"); mel = cfg["model"]["mel"]
        model = CFM(transformer=DiT(**cfg["model"]["architecture"], text_num_embeds=vs, mel_dim=mel["n_mel_channels"]), mel_spec_kwargs=mel, vocab_char_map=vm)
        model.load_state_dict(load_file(os.path.join(root, "model.safetensors"), device="cpu"), strict=True); model = model.float().eval()
        vd = snapshot_download(repo_id=cfg["vocos"]["repo_id"], revision=cfg["vocos"]["revision"], allow_patterns=("config.yaml", "pytorch_model.bin"))
        voc = load_vocoder(vocoder_name="vocos", is_local=True, local_path=vd, device="cpu"); infer = f5_infer
        ic = cfg["inference"]; kw = dict(mel_spec_type="vocos", nfe_step=ic["nfe_steps"], cfg_strength=ic["cfg_strength"], sway_sampling_coef=ic["sway_sampling_coefficient"], cross_fade_duration=ic["cross_fade_seconds"], device="cpu")
    ra, rt = preprocess_ref_audio_text(ref_wav, ref_txt)
    for n in lines:
        for s in seeds:
            fn = os.path.join(out, f"{mname}{VOICE}_{n}_s{s}.wav")
            if os.path.exists(fn): continue
            torch.manual_seed(s * 100 + 80)
            w, sr, _ = infer(ra, rt, text(n), model, voc, **kw)
            sf.write(fn, w, sr); json.dump(dict(model=mname, text=text(n), seed=s), open(fn[:-4] + ".json", "w"), ensure_ascii=False)
            print("done", os.path.basename(fn), flush=True)
    del model
