"""Final mix for phone speakers: the narrator's voice (already lightly cleaned
by voice.py) on top, music ducked well underneath while they talk, game SFX
in between. No extra voice processing here. A gentle peak limiter, then a
linear gain to about -15 LUFS → build/mix.wav."""
import json, os, subprocess
import numpy as np
import soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
SR = 48000
FF = os.environ.get("FFMPEG", "ffmpeg")


def follower(x, attack=0.02, release=0.3):
    ax = np.abs(x); out = np.zeros_like(ax); e = 0.0; blk = 48
    ca, cr = np.exp(-blk / (attack * SR)), np.exp(-blk / (release * SR))
    for i in range(0, len(ax), blk):
        m = ax[i:i + blk].max(); c = ca if m > e else cr
        e = c * e + (1 - c) * m; out[i:i + blk] = e
    return out


def fit(x, n):
    return np.pad(x, [(0, n - len(x))] + [(0, 0)] * (x.ndim - 1))[:n]


vo, _ = sf.read(os.path.join(BUILD, "vo", "narration.wav"), dtype="float64")
music, _ = sf.read(os.path.join(BUILD, "music.wav"), dtype="float64")
sfx, _ = sf.read(os.path.join(BUILD, "sfx.wav"), dtype="float64")
N = max(len(vo), len(music), len(sfx))
vo, music, sfx = fit(vo, N), fit(music, N), fit(sfx, N)

key = follower(vo)
talk = np.clip(key / (0.25 * (np.abs(vo).max() + 1e-9)), 0, 1)
k = int(0.12 * SR); talk = np.convolve(talk, np.ones(k) / k, "same")
music_gain = 0.30 * 10 ** (-10 * talk / 20)   # ~-10 dB more while speaking
sfx_gain = 0.55 * 10 ** (-4 * talk / 20)

mix = music * music_gain[:, None] + sfx * sfx_gain[:, None] + vo[:, None]
pre = os.path.join(BUILD, "mix_pre.wav")
sf.write(pre, (mix / (np.abs(mix).max() / 0.8)).astype(np.float32), SR)

p = subprocess.run([FF, "-hide_banner", "-i", pre, "-af", "alimiter=limit=0.85:attack=4:release=60:level=disabled,ebur128", "-f", "null", "-"], capture_output=True, text=True)
lufs = float(p.stderr.rsplit("I:", 1)[1].split("LUFS")[0])
gain = -15.0 - lufs
subprocess.run([FF, "-y", "-hide_banner", "-loglevel", "error", "-i", pre, "-af",
                f"alimiter=limit=0.85:attack=4:release=60:level=disabled,volume={gain:.2f}dB,alimiter=limit=0.89:attack=2:release=40:level=disabled",
                "-ar", str(SR), os.path.join(BUILD, "mix.wav")], check=True)
print(f"mix → build/mix.wav (pre {lufs:.1f} LUFS, gain {gain:+.1f} dB)")
