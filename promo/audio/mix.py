"""Final mix: voice processing, music ducking under narration, SFX, and
EBU R128 loudness normalisation (-14 LUFS, -1 dBTP) → build/mix.wav."""
import json, os, subprocess
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, fftconvolve

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
SR = 48000

def peq(x, f0, gain_db, q=1.0):
    A = 10 ** (gain_db / 40); w = 2 * np.pi * f0 / SR; al = np.sin(w) / (2 * q)
    b = [1 + al * A, -2 * np.cos(w), 1 - al * A]; a = [1 + al / A, -2 * np.cos(w), 1 - al / A]
    from scipy.signal import lfilter
    return lfilter(np.array(b) / a[0], np.array(a) / a[0], x)

def envelope(x, attack=0.005, release=0.12):
    ax = np.abs(x); out = np.zeros_like(ax)
    a1 = np.exp(-1 / (attack * SR)); r1 = np.exp(-1 / (release * SR)); e = 0.0
    # vectorised-ish one-pole follower in blocks of 1 ms
    blk = 48
    for i in range(0, len(ax), blk):
        m = ax[i:i + blk].max()
        c = a1 if m > e else r1
        e = c ** blk * e + (1 - c ** blk) * m
        out[i:i + blk] = e
    return out

def compress(x, thresh_db=-20, ratio=3.0, makeup_db=4):
    env = envelope(x, 0.003, 0.08)
    lvl = 20 * np.log10(env + 1e-9)
    over = np.maximum(0, lvl - thresh_db)
    g = 10 ** ((-over * (1 - 1 / ratio) + makeup_db) / 20)
    return x * g

vo, sr = sf.read(os.path.join(BUILD, "vo", "narration.wav"), dtype="float64")
assert sr == SR
vo = sosfilt(butter(2, 85, "high", fs=SR, output="sos"), vo)
vo = peq(vo, 250, -2.0, 0.9)      # less box
vo = peq(vo, 3200, 3.0, 0.8)      # presence / clarity on phones
vo = peq(vo, 9500, -2.5, 0.7)     # tame synthetic fizz
vo = compress(vo, -22, 3.0, 5)
# small room so the voice sits in the same space as the music
r = np.random.RandomState(5); t = np.arange(int(0.45 * SR)) / SR
ir = r.randn(len(t)) * np.exp(-t / 0.09); ir = sosfilt(butter(2, 5000, "low", fs=SR, output="sos"), ir); ir /= np.sqrt((ir ** 2).sum())
vo = vo + 0.07 * fftconvolve(vo, ir)[: len(vo)]
vo /= np.abs(vo).max() + 1e-9

music, _ = sf.read(os.path.join(BUILD, "music.wav"), dtype="float64")
sfx, _ = sf.read(os.path.join(BUILD, "sfx.wav"), dtype="float64")
N = max(len(music), len(sfx), len(vo))
def fit(x, n):
    return np.pad(x, [(0, n - len(x))] + [(0, 0)] * (x.ndim - 1))
music, sfx, vo = fit(music, N), fit(sfx, N), fit(vo, N)

# sidechain ducking: music dips ~9 dB while the narrator speaks
key = envelope(vo, 0.02, 0.35)
duck_db = -12.0 * np.clip(key / 0.08, 0, 1)
duck = 10 ** (duck_db / 20)
# smooth the gain curve so there is no pumping
k = int(0.08 * SR); duck = np.convolve(duck, np.ones(k) / k, mode="same")

MUSIC, SFX, VOICE = 0.34, 0.55, 1.0
sfx_duck = 10 ** (-5.0 * np.clip(key / 0.12, 0, 1) / 20)
sfx_duck = np.convolve(sfx_duck, np.ones(k) / k, mode="same")
mix = music * (MUSIC * duck)[:, None] + sfx * (SFX * sfx_duck)[:, None] + (vo * VOICE)[:, None]
mix /= np.abs(mix).max() / 0.9
pre = os.path.join(BUILD, "mix_pre.wav")
sf.write(pre, mix.astype(np.float32), SR)

# two-pass loudnorm for streaming platforms
ff = os.environ.get("FFMPEG", "ffmpeg")
p = subprocess.run([ff, "-hide_banner", "-i", pre, "-af", "loudnorm=I=-14:TP=-1.0:LRA=9:print_format=json", "-f", "null", "-"], capture_output=True, text=True)
js = json.loads(p.stderr[p.stderr.rindex("{"):p.stderr.rindex("}") + 1])
af = (f"loudnorm=I=-14:TP=-1.0:LRA=9:measured_I={js['input_i']}:measured_TP={js['input_tp']}:"
      f"measured_LRA={js['input_lra']}:measured_thresh={js['input_thresh']}:offset={js['target_offset']}:linear=true")
subprocess.run([ff, "-y", "-hide_banner", "-loglevel", "error", "-i", pre, "-af", af, "-ar", str(SR), os.path.join(BUILD, "mix.wav")], check=True)
print("mix → build/mix.wav", {k: js[k] for k in ("input_i", "input_tp", "input_lra")})
