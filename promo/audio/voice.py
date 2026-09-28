"""Human voiceover pipeline for the short cut.

Input: the narrator's own recordings in promo/voice/ (any format: m4a, opus,
mp3, wav…; one long take or one file per segment, retakes allowed).

  1. decode → 48 kHz mono
  2. find utterances, transcribe them (local Whisper) only to *locate* each of
     the 12 script segments and spot retakes
  3. choose one take per segment (complete + most lively delivery; see
     choose_take) — the report lists every take so choices can be overridden
     in script/short.json → "takes": {"s3": 2}
  4. light cleaning only: gentle broadband denoise if the room is noisy,
     80 Hz high-pass, soft de-ess, 2:1 compression. No pitch or timing
     manipulation other than shortening long pauses.
  5. assemble with natural gaps → build/vo/narration.wav
  6. caption phrase timing from the speaker's real pauses → build/timings.json

  python3 audio/voice.py              # real recordings
  python3 audio/voice.py --placeholder  # estimated timings, silent audio
"""
import difflib, glob, json, os, re, subprocess, sys
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, resample_poly

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
SR = 48000
FF = os.environ.get("FFMPEG", "ffmpeg")
SCRIPT = json.load(open(os.path.join(ROOT, "script", "short.json")))
SEGS = SCRIPT["segments"]


def norm_ar(s):
    s = re.sub(r"[ً-ْٰـ]", "", s)
    s = re.sub(r"[إأآا]", "ا", s).replace("ى", "ي").replace("ة", "ه").replace("ئ", "ي").replace("ؤ", "و")
    s = re.sub(r"[^ء-ي0-9 ]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def seg_text(seg):
    return " ".join(seg["phrases"])


def decode(path):
    raw = subprocess.run([FF, "-v", "error", "-i", path, "-ac", "1", "-ar", str(SR), "-f", "f32le", "-"], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).astype(np.float64)


def frame_db(x, hop=0.01):
    h = int(hop * SR)
    n = len(x) // h
    e = np.sqrt((x[: n * h].reshape(n, h) ** 2).mean(1) + 1e-12)
    return 20 * np.log10(e)


def speech_mask(x):
    """Energy VAD relative to this recording's own noise floor."""
    db = frame_db(x)
    floor = np.percentile(db, 10)
    peak = np.percentile(db, 97)
    thr = floor + max(10, (peak - floor) * 0.28)
    m = db > thr
    # 120 ms hangover so word-internal dips don't split words
    k = 12
    m = np.convolve(m.astype(float), np.ones(k), "same") > 0
    return m, floor, peak


def utterances(x, min_gap=0.55):
    m, _, _ = speech_mask(x)
    idx = np.where(m)[0]
    if not len(idx):
        return []
    out, s, p = [], idx[0], idx[0]
    for i in idx[1:]:
        if (i - p) * 0.01 > min_gap:
            out.append((s * 0.01, (p + 1) * 0.01))
            s = i
        p = i
    out.append((s * 0.01, (p + 1) * 0.01))
    return [(a, b) for a, b in out if b - a > 0.25]


def load_asr():
    import sherpa_onnx
    d = os.path.join(ROOT, ".models", "sherpa-onnx-whisper-turbo")
    return sherpa_onnx.OfflineRecognizer.from_whisper(
        encoder=f"{d}/turbo-encoder.int8.onnx", decoder=f"{d}/turbo-decoder.int8.onnx",
        tokens=f"{d}/turbo-tokens.txt", language="ar", task="transcribe", num_threads=4)


def transcribe(rec, x):
    a = resample_poly(x, 16000, SR).astype(np.float32)
    a = np.concatenate([np.zeros(8000, np.float32), a, np.zeros(16000, np.float32)])
    s = rec.create_stream(); s.accept_waveform(16000, a); rec.decode_stream(s)
    return s.result.text


def liveliness(x):
    """Pitch movement (semitone spread) — a rough proxy for an animated read."""
    fr, hop = int(0.04 * SR), int(0.01 * SR)
    f0 = []
    for i in range(0, len(x) - fr, hop * 2):
        y = x[i:i + fr]; y = y - y.mean()
        if np.sqrt((y ** 2).mean()) < 0.01:
            continue
        c = np.correlate(y, y, "full")[fr - 1:]
        lo, hi = int(SR / 350), int(SR / 70)
        k = np.argmax(c[lo:hi]) + lo
        if c[k] > 0.45 * c[0]:
            f0.append(SR / k)
    if len(f0) < 5:
        return 0.0
    st = 12 * np.log2(np.array(f0) / np.median(f0))
    return float(np.percentile(st, 90) - np.percentile(st, 10))


# ---------------------------------------------------------------- cleaning --
def clean(x):
    db = frame_db(x)
    floor = np.percentile(db, 10)
    if floor > -58:  # audible room noise → gentle, speech-preserving reduction
        try:
            import noisereduce as nr
            x = nr.reduce_noise(y=x, sr=SR, stationary=True, prop_decrease=0.55, n_fft=2048)
        except Exception as e:  # noqa: BLE001
            print("noisereduce unavailable:", e)
    x = sosfilt(butter(2, 80, "high", fs=SR, output="sos"), x)
    return x


def polish(x):
    """De-ess + gentle compression via ffmpeg, then peak-normalise."""
    tmp_in = os.path.join(BUILD, "vo", "_in.wav"); tmp_out = os.path.join(BUILD, "vo", "_out.wav")
    sf.write(tmp_in, x.astype(np.float32), SR)
    chain = ",".join([
        "deesser=i=0.35:m=0.5:f=0.5:s=o",
        "acompressor=threshold=-22dB:ratio=2:attack=15:release=180:knee=6:makeup=2",
    ])
    subprocess.run([FF, "-y", "-v", "error", "-i", tmp_in, "-af", chain, tmp_out], check=True)
    y, _ = sf.read(tmp_out, dtype="float64")
    return y / (np.abs(y).max() + 1e-9) * 0.89


def tighten(x, max_pause=0.42, keep=0.30):
    """Shorten only long internal pauses; natural short pauses and breaths stay."""
    m, _, _ = speech_mask(x)
    on = np.where(m)[0]
    if not len(on):
        return x
    a = max(0, on[0] * 480 - int(0.06 * SR)); b = min(len(x), (on[-1] + 1) * 480 + int(0.14 * SR))
    x = x[a:b]
    m = m[a // 480:(b + 479) // 480]
    out, i, n = [], 0, len(m)
    fade = int(0.012 * SR)
    while i < n:
        if not m[i]:
            j = i
            while j < n and not m[j]:
                j += 1
            gap = (j - i) * 0.01
            if gap > max_pause and 0 < i and j < n:
                s0, s1 = i * 480, j * 480
                half = int(keep * SR / 2)
                seg_a = x[s0:s0 + half].copy(); seg_b = x[s1 - half:s1].copy()
                seg_a[-fade:] *= np.linspace(1, 0, fade); seg_b[:fade] *= np.linspace(0, 1, fade)
                out.append((s0, s1, np.concatenate([seg_a, seg_b])))
            i = j
        else:
            i += 1
    if not out:
        return x
    parts, last = [], 0
    for s0, s1, rep in out:
        parts.append(x[last:s0]); parts.append(rep); last = s1
    parts.append(x[last:])
    return np.concatenate(parts)


def raw_mask(x):
    """Unsmoothed speech mask (10 ms frames) for locating short word gaps."""
    db = frame_db(x)
    floor = np.percentile(db, 10); peak = np.percentile(db, 97)
    m = db > floor + max(10, (peak - floor) * 0.3)
    return np.convolve(m.astype(float), np.ones(3), "same") > 0  # 30 ms smoothing only


def pauses(x, min_gap=0.08):
    """(start, end) of every internal pause, in seconds."""
    m = raw_mask(x)
    res, i, n = [], 0, len(m)
    while i < n:
        if not m[i]:
            j = i
            while j < n and not m[j]:
                j += 1
            if 0 < i and j < n and (j - i) * 0.01 >= min_gap:
                res.append((i * 0.01, j * 0.01))
            i = j
        else:
            i += 1
    return res


def phrase_times(x, phrases):
    """Caption phrase spans from the speaker's real pauses: each phrase starts
    at its speech onset and ends where the following pause begins."""
    dur = len(x) / SR
    lens = np.array([len(norm_ar(p).replace(" ", "")) + 1 for p in phrases], float)
    cum = np.cumsum(lens)[:-1] / lens.sum()
    ps = pauses(x)
    cuts, used = [], set()
    for f in cum:
        target = f * dur
        cand = [(abs((a + b) / 2 - target) - 0.3 * (b - a), k) for k, (a, b) in enumerate(ps) if k not in used and abs((a + b) / 2 - target) < 0.35 * dur]
        if cand:
            k = min(cand)[1]; used.add(k); cuts.append(ps[k])
        else:
            cuts.append((target, target))
    cuts.sort()
    m = raw_mask(x); on = np.where(m)[0]
    first = on[0] * 0.01 if len(on) else 0.0
    last = (on[-1] + 1) * 0.01 if len(on) else dur
    starts = [first] + [b for a, b in cuts]
    ends = [a for a, b in cuts] + [last]
    return list(zip(starts, ends))


# ------------------------------------------------------------------- takes --
def find_takes(files):
    rec = load_asr()
    utts = []
    for f in files:
        x = decode(f)
        for a, b in utterances(x):
            y = x[int(a * SR):int(b * SR)]
            utts.append({"file": os.path.basename(f), "a": a, "b": b, "x": y, "text": transcribe(rec, y)})
            print(f"  {os.path.basename(f)} {a:6.2f}-{b:6.2f}  {utts[-1]['text']}")
    takes = {s["id"]: [] for s in SEGS}
    for s in SEGS:
        ref = norm_ar(seg_text(s))
        for i in range(len(utts)):
            for L in (1, 2, 3):
                span = utts[i:i + L]
                if len(span) < L or len({u["file"] for u in span}) > 1:
                    continue
                if span[-1]["a"] - span[0]["b"] > 2.5 * L:
                    continue
                hyp = norm_ar(" ".join(u["text"] for u in span))
                r = difflib.SequenceMatcher(None, ref, hyp).ratio()
                if r > 0.5:
                    f = span[0]["file"]
                    x = decode(os.path.join(os.environ.get("VOICE_DIR", os.path.join(ROOT, "voice")), f))[int(span[0]["a"] * SR):int(span[-1]["b"] * SR)]
                    takes[s["id"]].append({"file": f, "a": span[0]["a"], "b": span[-1]["b"], "match": r, "heard": " ".join(u["text"] for u in span), "x": x})
    for sid in takes:  # drop spans that are sub/supersets of a better span
        ts = sorted(takes[sid], key=lambda t: -t["match"])
        keep = []
        for t in ts:
            if all(not (t["file"] == k["file"] and t["a"] < k["b"] and k["a"] < t["b"]) for k in keep):
                keep.append(t)
        takes[sid] = sorted(keep, key=lambda t: (t["file"], t["a"]))
    return takes


def choose_take(cands, override=None):
    """Complete takes first; among those prefer the most animated delivery,
    then the later take (people usually settle into it)."""
    if override is not None:
        return cands[override - 1]
    best = max(c["match"] for c in cands)
    ok = [c for c in cands if c["match"] >= best - 0.12]
    for c in ok:
        c["live"] = liveliness(c["x"])
    return max(ok, key=lambda c: (round(c["live"], 1), c["file"], c["a"]))


# --------------------------------------------------------------------- main --
def main():
    os.makedirs(os.path.join(BUILD, "vo"), exist_ok=True)
    placeholder = "--placeholder" in sys.argv
    lead = SCRIPT.get("lead_in", 0.12)
    t = lead
    pieces = [np.zeros(int(lead * SR))]
    timings = {"beats": [], "chunks": [], "placeholder": placeholder}
    report = []
    if placeholder:
        for s in SEGS:
            dur = sum(len(norm_ar(p)) for p in s["phrases"]) / SCRIPT.get("est_cps", 14.5) + 0.25 * (len(s["phrases"]) - 1)
            dur = max(dur, s.get("min", 0))
            x = np.zeros(int(dur * SR))
            spans = [(dur * k / len(s["phrases"]), dur * (k + 1) / len(s["phrases"])) for k in range(len(s["phrases"]))]
            lens = np.array([len(norm_ar(p)) + 2 for p in s["phrases"]], float)
            e = np.concatenate([[0], np.cumsum(lens) / lens.sum() * dur])
            spans = [(e[k], e[k + 1]) for k in range(len(s["phrases"]))]
            t = add_segment(s, x, spans, t, pieces, timings)
    else:
        vdir = os.environ.get("VOICE_DIR", os.path.join(ROOT, "voice"))
        files = sorted(f for f in glob.glob(os.path.join(vdir, "*")) if not f.endswith((".md", ".txt", ".json")) and not os.path.basename(f).startswith("."))
        if not files:
            sys.exit("no recordings in promo/voice/")
        print("utterances:")
        takes = find_takes(files)
        overrides = SCRIPT.get("takes", {})
        for s in SEGS:
            cands = takes[s["id"]]
            if not cands:
                report.append(f"{s['id']}: MISSING — no take matched «{seg_text(s)}»")
                x = np.zeros(int(1.0 * SR)); spans = [(0, 1.0)] * len(s["phrases"])
                t = add_segment(s, x, spans, t, pieces, timings)
                continue
            c = choose_take(cands, overrides.get(s["id"]))
            x = polish(tighten(clean(c["x"])))
            spans = phrase_times(x, s["phrases"])
            report.append(f"{s['id']}: take {cands.index(c) + 1}/{len(cands)} from {c['file']} @{c['a']:.1f}s (match {c['match']:.2f}, pitch range {c.get('live', 0):.1f} st)\n      heard: {c['heard']}")
            t = add_segment(s, x, spans, t, pieces, timings)
    y = np.concatenate(pieces)
    tail = SCRIPT.get("tail", 1.3)
    y = np.concatenate([y, np.zeros(int(tail * SR))])
    sf.write(os.path.join(BUILD, "vo", "narration.wav"), y.astype(np.float32), SR)
    timings["duration"] = round(len(y) / SR, 3)
    json.dump(timings, open(os.path.join(BUILD, "timings.json"), "w"), ensure_ascii=False, indent=1)
    open(os.path.join(BUILD, "voice_report.txt"), "w").write("\n".join(report))
    print("\n".join(report))
    print(f"narration {'(placeholder) ' if placeholder else ''}{timings['duration']:.2f}s")


def add_segment(s, x, spans, t, pieces, timings):
    b0 = t
    for k, (p, (a, b)) in enumerate(zip(s["phrases"], spans)):
        timings["chunks"].append({"id": f"{s['id']}.{k}", "beat": s["id"], "cap": s.get("caps", s["phrases"])[k], "start": round(t + a, 3), "end": round(t + b, 3)})
    pieces.append(x)
    t += len(x) / SR
    gap = s.get("gap", 0.22)
    pieces.append(np.zeros(int(gap * SR)))
    t += gap
    timings["beats"].append({"id": s["id"], "start": round(b0, 3), "end": round(t, 3)})
    return t


if __name__ == "__main__":
    main()
