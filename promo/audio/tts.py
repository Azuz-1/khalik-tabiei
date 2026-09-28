"""Arabic voiceover for the promo.

Reads script/narration.json, synthesizes every chunk's hidden voweled `say`
text with a local open-source Piper/VITS Saudi voice (via sherpa-onnx), trims
and joins the chunks with the scripted gaps, and writes:

  build/vo/narration.wav   full voiceover (48 kHz mono)
  build/timings.json       absolute start/end of every chunk + beat

With --check it also transcribes each chunk with a local Whisper model and
prints a pronunciation report comparing the ASR text to the caption.
"""
import json, os, re, sys, difflib
import numpy as np
import soundfile as sf
from scipy.signal import resample_poly

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
MODELS = os.path.join(ROOT, ".models")
BUILD = os.path.join(ROOT, "build")
SR = 48000


def load_tts(voice):
    import sherpa_onnx
    d = os.path.join(MODELS, voice)
    onnx = [f for f in os.listdir(d) if f.endswith(".onnx")][0]
    cfg = sherpa_onnx.OfflineTtsConfig(
        model=sherpa_onnx.OfflineTtsModelConfig(
            vits=sherpa_onnx.OfflineTtsVitsModelConfig(
                model=os.path.join(d, onnx),
                tokens=os.path.join(d, "tokens.txt"),
                data_dir=os.path.join(d, "espeak-ng-data"),
                noise_scale=0.72,      # a little more life than the 0.667 default
                noise_scale_w=0.85,
                length_scale=1.0,
            ),
            num_threads=4,
        )
    )
    return sherpa_onnx.OfflineTts(cfg)


def synth(tts, text, speed, seed_tries=1):
    audio = tts.generate(text, sid=0, speed=speed)
    x = np.asarray(audio.samples, dtype=np.float32)
    x = resample_poly(x, SR, audio.sample_rate).astype(np.float32)
    return x


def trim(x, thresh_db=-42, pad_ms=(25, 90)):
    """Trim leading/trailing silence, keeping a little natural tail."""
    frame = int(0.01 * SR)
    env = np.array([np.sqrt(np.mean(x[i:i + frame] ** 2) + 1e-12) for i in range(0, len(x) - frame, frame)])
    db = 20 * np.log10(env + 1e-9)
    on = np.where(db > thresh_db)[0]
    if not len(on):
        return x
    a = max(0, on[0] * frame - int(pad_ms[0] / 1000 * SR))
    b = min(len(x), (on[-1] + 1) * frame + int(pad_ms[1] / 1000 * SR))
    y = x[a:b].copy()
    fade = int(0.012 * SR)
    y[:fade] *= np.linspace(0, 1, fade)
    y[-fade:] *= np.linspace(1, 0, fade)
    return y


def norm_ar(s):
    s = re.sub(r"[ً-ْٰـ]", "", s)          # tashkeel + tatweel
    s = re.sub(r"[إأآا]", "ا", s).replace("ى", "ي").replace("ة", "ه").replace("ئ", "ي").replace("ؤ", "و")
    s = re.sub(r"[^ء-ي0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def load_asr():
    import sherpa_onnx
    d = os.path.join(MODELS, "sherpa-onnx-whisper-turbo")
    return sherpa_onnx.OfflineRecognizer.from_whisper(
        encoder=f"{d}/turbo-encoder.int8.onnx", decoder=f"{d}/turbo-decoder.int8.onnx",
        tokens=f"{d}/turbo-tokens.txt", language="ar", task="transcribe", num_threads=4)


def transcribe(rec, x):
    a = resample_poly(x, 16000, SR).astype(np.float32)
    a = np.concatenate([np.zeros(8000, np.float32), a, np.zeros(16000, np.float32)])
    s = rec.create_stream()
    s.accept_waveform(16000, a)
    rec.decode_stream(s)
    return s.result.text


def dnsmos_p808(x):
    try:
        from speechmos import dnsmos
    except Exception:
        return 3.5
    a = resample_poly(x, 16000, SR).astype(np.float32)
    while len(a) < 16000 * 2:
        a = np.concatenate([a, a])
    return float(dnsmos.run(a, 16000)["p808_mos"])


def main():
    args = sys.argv[1:]
    check = "--check" in args
    takes = int(next((a.split("=")[1] for a in args if a.startswith("--takes=")), "1"))
    voice_override = next((a.split("=")[1] for a in args if a.startswith("--voice=")), None)
    fresh = "--fresh" in args
    script = json.load(open(os.path.join(ROOT, "script", "narration.json")))
    voice = voice_override or script["voice"]
    vo_dir = os.path.join(BUILD, "vo" if not voice_override else f"vo_{voice}")
    os.makedirs(vo_dir, exist_ok=True)
    manifest_path = os.path.join(vo_dir, "takes.json")
    manifest = {} if fresh or not os.path.exists(manifest_path) else json.load(open(manifest_path))
    tts = load_tts(voice)
    rec = load_asr() if (check or takes > 1) else None

    t = float(script.get("lead_in", 0.8))
    pieces = [np.zeros(int(t * SR), np.float32)]
    timings = {"beats": [], "chunks": []}
    scores = []
    for beat in script["beats"]:
        b0 = t
        for i, ch in enumerate(beat["chunks"]):
            cid = f'{beat["id"]}.{i}'
            key = f'{voice}|{ch["say"]}|{ch.get("speed", 1.0)}'
            path = os.path.join(vo_dir, f"{cid}.wav")
            cached = manifest.get(cid)
            if cached and cached.get("key") == key and os.path.exists(path):
                x, _ = sf.read(path, dtype="float32")
                ratio, heard, mos = cached["asr"], cached["heard"], cached["mos"]
            else:
                best = None
                for k in range(max(1, takes)):
                    y = trim(synth(tts, ch["say"], ch.get("speed", 1.0)))
                    y *= 0.9 / (np.abs(y).max() + 1e-9)
                    h = transcribe(rec, y) if rec else ""
                    r = difflib.SequenceMatcher(None, norm_ar(ch["cap"]), norm_ar(h)).ratio() if rec else 1.0
                    m = dnsmos_p808(y) if takes > 1 else 3.5
                    score = r + 0.12 * (m - 3.5)
                    if best is None or score > best[0]:
                        best = (score, y, r, h, m)
                _, x, ratio, heard, mos = best
                sf.write(path, x, SR)
                manifest[cid] = {"key": key, "asr": ratio, "heard": heard, "mos": mos}
            dur = len(x) / SR
            timings["chunks"].append({"id": cid, "beat": beat["id"], "cap": ch["cap"], "start": round(t, 3), "end": round(t + dur, 3)})
            pieces.append(x)
            t += dur
            gap = float(ch.get("gap", 0.2))
            pieces.append(np.zeros(int(gap * SR), np.float32))
            t += gap
            if rec:
                scores.append(ratio)
                flag = "  " if ratio >= 0.8 else "!!"
                print(f"{flag} asr {ratio:.2f} mos {mos:.2f} {cid:10s} cap: {ch['cap']}\n{'':30s} asr: {heard}")
        timings["beats"].append({"id": beat["id"], "start": round(b0, 3), "end": round(t, 3)})
    json.dump(manifest, open(manifest_path, "w"), ensure_ascii=False, indent=1)
    y = np.concatenate(pieces)
    sf.write(os.path.join(vo_dir, "narration.wav"), y, SR)
    timings["duration"] = round(len(y) / SR, 3)
    if not voice_override:
        json.dump(timings, open(os.path.join(BUILD, "timings.json"), "w"), ensure_ascii=False, indent=1)
    print(f"{voice}: narration {timings['duration']:.2f}s, {len(timings['chunks'])} chunks")
    if scores:
        mos_all = [manifest[c["id"]]["mos"] for c in timings["chunks"]]
        print(f"mean ASR similarity {np.mean(scores):.3f}, mean DNSMOS p808 {np.mean(mos_all):.2f}")


if __name__ == "__main__":
    main()
