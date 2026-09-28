"""Original score + sound design for the promo, synthesized from scratch.

Music: a Khaleeji-flavoured party groove in D Hijaz (doum/tak drums,
hand-claps, riq shimmer, bass, a plucked oud-like Karplus-Strong lead, pads),
arranged in sections that follow the story beats in build/timings.json.

SFX: triggered from build/cues.json (exported by the compositor). The
countdown ticks, action hit, hold, reveal, vote, caught and escaped sounds
recreate the game's own Web Audio recipes (client/src/audio/gameAudio.ts),
layered with restrained cinematic sweetening.

Writes build/music.wav and build/sfx.wav (48 kHz stereo float).
"""
import json, os
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, fftconvolve

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
SR = 48000
rs = np.random.RandomState(1234)

TM = json.load(open(os.path.join(BUILD, "timings.json")))
CU = json.load(open(os.path.join(BUILD, "cues.json")))
DUR = CU["duration"] + 1.0
N = int(DUR * SR)
beat_of = {b["id"]: b for b in TM["beats"]}
chunk_of = {c["id"]: c for c in TM["chunks"]}
cues = CU["cues"]
T_ACTION = next(c["t"] for c in cues if c["type"] == "action")
T_CAUGHT = next(c["t"] for c in cues if c["type"] == "caught")
T_LOGO = next(c["t"] for c in cues if c["type"] == "logo")

# ------------------------------------------------------------------ utils --
def tt(d):
    return np.arange(int(d * SR)) / SR

def env_exp(d, tau, attack=0.002):
    t = tt(d)
    e = np.exp(-t / tau)
    a = int(attack * SR)
    if a > 0:
        e[:a] *= np.linspace(0, 1, a)
    return e

def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], btype="band", fs=SR, output="sos"), x)

def lp(x, f, order=2):
    return sosfilt(butter(order, f, btype="low", fs=SR, output="sos"), x)

def hp(x, f, order=2):
    return sosfilt(butter(order, f, btype="high", fs=SR, output="sos"), x)

def add(buf, x, t, gain=1.0, pan=0.0):
    i = int(round(t * SR))
    if i >= len(buf) or i + len(x) <= 0:
        return
    if i < 0:
        x = x[-i:]; i = 0
    x = x[: len(buf) - i]
    l = gain * np.cos((pan + 1) * np.pi / 4) * np.sqrt(2)
    r = gain * np.sin((pan + 1) * np.pi / 4) * np.sqrt(2)
    buf[i:i + len(x), 0] += x * l
    buf[i:i + len(x), 1] += x * r

def sweep(f0, f1, d, wave="sine"):
    t = tt(d)
    f = f0 * (f1 / f0) ** (t / d) if f0 > 0 and f1 > 0 else np.linspace(f0, f1, len(t))
    ph = 2 * np.pi * np.cumsum(f) / SR
    if wave == "tri":
        return 2 / np.pi * np.arcsin(np.sin(ph))
    return np.sin(ph)

def note(n):  # midi → Hz
    return 440.0 * 2 ** ((n - 69) / 12)

def reverb_ir(seconds=1.8, decay=0.45, seed=3):
    r = np.random.RandomState(seed)
    t = tt(seconds)
    e = np.exp(-t / decay)
    ir = np.stack([r.randn(len(t)) * e, r.randn(len(t)) * e], 1)
    ir[:, 0] = lp(ir[:, 0], 6000); ir[:, 1] = lp(ir[:, 1], 6000)
    ir /= np.sqrt((ir ** 2).sum(0))
    return ir

def apply_reverb(x, ir, wet):
    y = np.stack([fftconvolve(x[:, k], ir[:, k])[: len(x)] for k in range(2)], 1)
    return x + wet * y

# ------------------------------------------------------------ instruments --
def doum(vel=1.0):
    d = 0.5
    x = sweep(120, 52, d) * env_exp(d, 0.2) * 0.9
    click = np.zeros(len(x)); c = int(0.004 * SR)
    click[:c] = rs.randn(c) * np.linspace(1, 0, c) * 0.25
    return (x + click) * vel

def tak(vel=1.0):
    d = 0.14
    n = bp(rs.randn(int(d * SR)), 1800, 5200) * env_exp(d, 0.03)
    tone = np.sin(2 * np.pi * 380 * tt(d)) * env_exp(d, 0.035)
    return (0.55 * n + 0.5 * tone) * vel

def clap(vel=1.0):
    d = 0.3
    x = np.zeros(int(d * SR))
    for off in (0, 0.011, 0.023):
        i = int(off * SR)
        m = len(x) - i
        seg = bp(rs.randn(m), 900, 2800) * np.exp(-np.arange(m) / SR / (0.012 if off < 0.02 else 0.085))
        x[i:] += seg
    return x * 0.5 * vel

def riq(vel=1.0):
    d = 0.09
    return hp(rs.randn(int(d * SR)), 6500) * env_exp(d, 0.02) * 0.22 * vel

_PLUCKS = {}


def pluck(f, d=1.2, bright=0.55, vel=1.0):
    """Karplus–Strong string with a soft, oud-like body (cached per note)."""
    key = (round(f, 2), round(d, 3), bright)
    if key not in _PLUCKS:
        _PLUCKS[key] = _pluck(f, d, bright)
    return _PLUCKS[key] * vel


def _pluck(f, d, bright):
    n = int(d * SR)
    L = max(2, int(SR / f))
    buf = (rs.rand(L) * 2 - 1) * 0.8
    buf = lp(buf, 400 + bright * 5000)
    out = np.zeros(n)
    idx = 0
    prev = 0.0
    k = 0.994
    for i in range(n):
        v = buf[idx]
        nv = k * 0.5 * (v + prev)
        prev = v
        buf[idx] = nv
        out[i] = v
        idx = (idx + 1) % L
    out = lp(out, 3800)
    a = int(0.003 * SR); out[:a] *= np.linspace(0, 1, a)
    return out

def bass(f, d, vel=1.0):
    t = tt(d)
    x = np.sin(2 * np.pi * f * t) + 0.35 * np.sin(2 * np.pi * 2 * f * t) + 0.12 * np.sign(np.sin(2 * np.pi * f * t))
    e = np.minimum(1, t / 0.01) * np.exp(-t / (d * 0.9))
    r = int(0.03 * SR); e[-r:] *= np.linspace(1, 0, r)
    return lp(x * e, 700) * 0.55 * vel

def pad(freqs, d, bright=900):
    t = tt(d)
    x = np.zeros(len(t))
    for f in freqs:
        for det in (-0.12, 0.0, 0.13):
            ph = rs.rand() * 2 * np.pi
            x += (2 * ((f * (1 + det / 100) * t + ph / (2 * np.pi)) % 1) - 1)
    x = lp(x / (3 * len(freqs)), bright)
    fade = min(1.2, d / 3)
    e = np.minimum(1, t / fade) * np.minimum(1, (d - t) / fade)
    return x * e

# --------------------------------------------------------------- sections --
BPM = 104
BEAT = 60 / BPM
S16 = BEAT / 4
D_HIJAZ = [62, 63, 66, 67, 69, 70, 72, 74]  # D Eb F# G A Bb C D
ROOTS = [38, 39, 38, 36]                      # bass per bar: D Eb D C

def section_bounds():
    B = lambda k: beat_of[k]["start"]
    return [
        ("intro", 0.0, B("title")),
        ("grooveA", B("title"), B("secret")),
        ("dark", B("secret"), B("ready")),
        ("build", B("ready"), T_ACTION),
        ("grooveA", T_ACTION, B("reveal")),
        ("suspense", B("reveal"), B("vote")),
        ("light", B("vote"), T_CAUGHT),
        ("grooveFull", T_CAUGHT, beat_of["win"]["start"]),
        ("sly", beat_of["win"]["start"], B("cta")),
        ("finale", B("cta"), DUR),
    ]

drums = np.zeros((N, 2)); claps = np.zeros((N, 2)); low = np.zeros((N, 2)); lead = np.zeros((N, 2)); pads = np.zeros((N, 2)); fx = np.zeros((N, 2))

DOUM, TAK = doum(), tak()
LEAD_HOOK = [(0, 69, 2), (2, 70, 1), (3, 69, 1), (4, 66, 2), (6, 67, 1), (7, 66, 1), (8, 63, 3), (12, 62, 4)]  # (16th, midi, len)

for name, a, b in section_bounds():
    if b - a <= 0.05:
        continue
    bars = int(np.ceil((b - a) / (BEAT * 4))) + 1
    for bar in range(bars):
        t_bar = a + bar * BEAT * 4
        root = ROOTS[bar % 4]
        for step in range(16):
            t = t_bar + step * S16
            if t >= b - 0.02:
                break
            swing = 0.018 if step % 2 else 0.0
            ts = t + swing
            full = name in ("grooveA", "grooveFull", "finale")
            if name == "intro":
                if step in (0, 8):
                    add(drums, doum(0.35), ts, 0.8)
                if step % 4 == 0:
                    add(drums, riq(0.5), ts, 0.6, 0.3)
            elif name == "build":
                pass
            elif name == "suspense":
                if step == 0:
                    add(drums, doum(0.8), ts, 0.9)
                if step == 10:
                    add(drums, doum(0.45), ts, 0.7)
                if step % 4 == 2:
                    add(drums, riq(0.5), ts, 0.5, -0.3)
            else:
                if step in (0, 6, 8) or (full and step == 14 and bar % 2):
                    add(drums, doum(1.0 if step == 0 else 0.8), ts, 0.95)
                if step in (4, 12):
                    add(drums, tak(0.9), ts, 0.6, 0.15)
                if step in (3, 11) and name != "dark":
                    add(drums, tak(0.4), ts, 0.4, -0.2)
                if step % 2 == 0:
                    add(drums, riq(0.8 if step % 4 == 2 else 0.5), ts, 0.7, 0.35)
                if name in ("grooveA", "grooveFull", "finale", "light", "sly") and step in (10, 14) + ((7,) if full else ()):
                    add(claps, clap(1.0 if step == 10 else 0.8), ts, 0.9, 0.1 * (1 if step == 14 else -1))
            # bass
            if name in ("grooveA", "grooveFull", "finale", "dark", "light", "sly"):
                if step in (0, 6, 8, 14 if name != "dark" else 99):
                    f = note(root + (12 if step == 14 else 0))
                    if name == "sly":
                        f = note([38, 37, 36, 35][bar % 4] + (7 if step == 8 else 0))
                    add(low, bass(f, S16 * (3 if step in (0, 8) else 2)), ts, 0.85 if name != "dark" else 0.7)
        # lead hook every other bar in grooves; sparse question motif in suspense
        if name in ("grooveA", "grooveFull", "finale") and bar % 2 == 1:
            for s16, m, ln in LEAD_HOOK:
                t = t_bar + s16 * S16
                if t < b - 0.1:
                    add(lead, pluck(note(m), ln * S16 + 0.5, 0.6, 0.55), t, 0.7, -0.25)
        if name in ("intro", "dark") and bar % 2 == 0:
            for s16, m in ((0, 62), (3, 63), (6, 62), (10, 66 if name == "dark" else 69)):
                t = t_bar + s16 * S16
                if t < b - 0.1:
                    add(lead, pluck(note(m), 1.4, 0.35, 0.5), t, 0.6, 0.2)
        if name == "suspense" and bar % 2 == 0:
            for s16, m in ((0, 69), (6, 70), (12, 69)):
                t = t_bar + s16 * S16
                if t < b - 0.1:
                    add(lead, pluck(note(m), 1.5, 0.3, 0.45), t, 0.55, 0.2)
        if name == "sly":
            for s16, m in ((0, 74), (3, 73), (6, 72), (9, 71), (12, 70)):
                t = t_bar + s16 * S16
                if t < b - 0.1:
                    add(lead, pluck(note(m), 0.7, 0.5, 0.5), t, 0.6, -0.2)
    # pads per section
    chord = {"intro": [50, 57, 62], "dark": [50, 51, 57], "suspense": [50, 57, 58], "build": [50, 57, 62, 63]}.get(name, [50, 57, 62, 66])
    bright = {"intro": 700, "dark": 600, "suspense": 800, "build": 500}.get(name, 1200)
    add(pads, pad([note(m) for m in chord], b - a + 0.8, bright), a - 0.1, 0.9 if name in ("intro", "dark", "suspense", "build") else 0.5)

# build: heartbeat accelerating + riser into the action hit
a, b = beat_of["ready"]["start"], T_ACTION
t = a
gap = 0.75
while t < b - 0.2:
    add(drums, doum(0.7), t, 0.9)
    add(drums, doum(0.45), t + 0.16, 0.8)
    t += gap
    gap = max(0.42, gap * 0.93)
rise = b - a
x = hp(rs.randn(int(rise * SR)), 1500) * np.linspace(0, 1, int(rise * SR)) ** 2.5 * 0.18
x = x * (0.6 + 0.4 * np.sin(np.linspace(0, 60, len(x))) ** 2)
add(fx, x, a, 1.0)
add(fx, sweep(80, 320, rise) * np.linspace(0, 1, int(rise * SR)) ** 2 * 0.12, a, 1.0)

music = drums * 0.9 + claps * 0.75 + low * 0.9 + lead * 0.8 + pads * 0.55
# section dynamics: breathe down for the secret, the countdown and the suspense
SECTION_GAIN = {"intro": 0.55, "dark": 0.62, "build": 0.7, "suspense": 0.55, "light": 0.85, "sly": 0.8}
g = np.ones(N)
for name, a, b in section_bounds():
    g[int(a * SR):int(b * SR)] = SECTION_GAIN.get(name, 1.0)
k = int(0.25 * SR)
g = np.convolve(np.pad(g, (k, k), mode="edge"), np.ones(k) / k, mode="same")[k:-k]
music *= g[:, None]
music += fx
music = apply_reverb(music, reverb_ir(1.6, 0.35), 0.18)
# glue: gentle bus saturation, then normalise
music = np.tanh(music * 1.4) / 1.4
music /= np.abs(music).max() + 1e-9
music *= 0.9
# final ring-out after the logo hit: fade the groove, leave the pad
fade_start = T_LOGO + 1.2
fi = int(fade_start * SR)
if fi < N:
    r = np.linspace(1, 0, N - fi) ** 1.5
    music[fi:] *= r[:, None]

# --------------------------------------------------------------------- SFX --
sfx = np.zeros((N, 2))

def game_tone(f, d, peak, wave="sine", delay=0.0, f_end=None):
    """Port of gameAudio.ts tone(): linear attack ≤18 ms, linear release."""
    t = tt(d)
    if f_end is None:
        ph = 2 * np.pi * f * t
    else:
        ph = 2 * np.pi * np.cumsum(np.linspace(f, f_end, len(t))) / SR
    x = 2 / np.pi * np.arcsin(np.sin(ph)) if wave == "tri" else np.sin(ph)
    atk = min(0.018, d * 0.24)
    e = np.where(t < atk, t / atk, 1 - (t - atk) / (d - atk))
    y = np.zeros(int((delay + d) * SR))
    y[int(delay * SR):int(delay * SR) + len(x)] = x * e * peak
    return y

def whoosh(d=0.45, lo=300, hi=4000, g=0.5):
    n = rs.randn(int(d * SR))
    t = tt(d)
    out = np.zeros(len(n))
    seg = 1024
    for i in range(0, len(n), seg):
        c = lo * (hi / lo) ** (i / len(n))
        out[i:i + seg] = bp(n[max(0, i - 2048):i + seg], max(40, c * 0.6), min(20000, c * 1.6))[-len(n[i:i + seg]):]
    e = np.sin(np.pi * t / d) ** 2
    return out * e * g

def boom(g=1.0):
    d = 1.6
    x = sweep(70, 30, d) * env_exp(d, 0.45) * 0.9 + lp(rs.randn(int(d * SR)), 200) * env_exp(d, 0.12) * 0.5
    return x * g

def impact(g=1.0):
    return boom(g) + np.concatenate([clap(1.2), np.zeros(int(1.6 * SR) - len(clap()))]) * 0.4 * g

for c in cues:
    t, k = c["t"], c["type"]
    if k == "tick":
        f = {5: 320, 4: 380, 3: 450, 2: 530, 1: 640}[c["step"]]
        x = game_tone(f, 0.095, 0.18 if c["step"] == 1 else 0.14, "tri")
        x2 = game_tone(f * 2, 0.07, 0.04)
        add(sfx, np.concatenate([x, np.zeros(max(0, len(x2) - len(x)))])[: max(len(x), len(x2))] + np.pad(x2, (0, max(0, len(x) - len(x2)))), t, 3.2)
    elif k == "action":
        x = game_tone(165, 0.2, 0.22, "sine", 0, 95) + np.pad(game_tone(930, 0.085, 0.1, "tri"), (0, int(0.2 * SR) - int(0.085 * SR)))
        add(sfx, x, t, 3.0)
        add(sfx, impact(0.9), t, 1.0)
    elif k == "hold":
        add(sfx, game_tone(145, 0.14, 0.075, "sine", 0, 125), t, 3.0)
    elif k == "reveal":
        a1 = game_tone(500, 0.18, 0.11); a2 = game_tone(660, 0.22, 0.1, "tri", 0.075)
        L = max(len(a1), len(a2)); x = np.pad(a1, (0, L - len(a1))) + np.pad(a2, (0, L - len(a2)))
        add(sfx, x, t, 3.0)
        add(sfx, whoosh(0.8, 2000, 9000, 0.25), t - 0.2, 1.0, 0.3)
    elif k == "vote":
        n = c.get("n", 1)
        add(sfx, game_tone(760 + min(max(n - 1, 0), 3) * 35, 0.075, 0.052), t, 4.5, 0.2 * ((n % 3) - 1))
    elif k == "caught":
        a1 = game_tone(440, 0.28, 0.12, "tri"); a2 = game_tone(554, 0.28, 0.115, "tri", 0.12); a3 = game_tone(659, 0.32, 0.11, "sine", 0.24)
        L = max(map(len, (a1, a2, a3)))
        x = sum(np.pad(a, (0, L - len(a))) for a in (a1, a2, a3))
        add(sfx, x, t + 0.05, 3.2)
        add(sfx, impact(1.0), t, 1.0)
    elif k == "escaped":
        a1 = game_tone(620, 0.23, 0.1, "tri"); a2 = game_tone(520, 0.23, 0.095, "tri", 0.12); a3 = game_tone(430, 0.25, 0.09, "sine", 0.24)
        L = max(map(len, (a1, a2, a3)))
        add(sfx, sum(np.pad(a, (0, L - len(a))) for a in (a1, a2, a3)), t, 3.2)
    elif k in ("join", "ready"):
        add(sfx, game_tone(820, 0.09, 0.05), t, 4.0)
    elif k == "whoosh":
        add(sfx, whoosh(0.5, 250, 5000, 0.3), t - 0.15, 1.0, rs.uniform(-0.4, 0.4))
    elif k == "swish":
        add(sfx, whoosh(0.3, 800, 8000, 0.22), t - 0.1, 1.0, rs.uniform(-0.4, 0.4))
    elif k == "pop":
        add(sfx, sweep(320, 1100, 0.07) * env_exp(0.07, 0.03) * 0.25, t, 1.0, rs.uniform(-0.3, 0.3))
    elif k == "tap":
        x = hp(rs.randn(int(0.02 * SR)), 2500) * env_exp(0.02, 0.004) * 0.3 + np.sin(2 * np.pi * 180 * tt(0.02)) * env_exp(0.02, 0.008) * 0.25
        add(sfx, x, t, 1.0)
    elif k == "flip":
        for o in (0, 0.09):
            add(sfx, bp(rs.randn(int(0.04 * SR)), 1500, 6000) * env_exp(0.04, 0.01) * 0.25, t + o, 1.0)
        add(sfx, whoosh(0.25, 1500, 6000, 0.12), t, 1.0)
    elif k in ("impostor", "mask"):
        d = 1.2
        x = (sweep(55, 45, d) * 0.5 + pluck(note(63), d, 0.3) * 0.6 + pluck(note(62), d, 0.3) * 0.5) * env_exp(d, 0.45)
        add(sfx, x, t, 0.9 if k == "impostor" else 0.6)
        add(sfx, whoosh(0.6, 3000, 300, 0.2), t - 0.3, 1.0)
    elif k == "question":
        add(sfx, pluck(note(67), 0.6, 0.6) * 0.5, t, 0.8, 0.2)
        add(sfx, pluck(note(70), 0.8, 0.6) * 0.5, t + 0.16, 0.8, 0.2)
    elif k == "hesitate":
        d = 0.5
        f = np.linspace(300, 430, int(d * SR)) + 18 * np.sin(np.linspace(0, 30, int(d * SR)))
        x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.sin(np.pi * tt(d) / d) * 0.12
        add(sfx, x, t, 1.0)
    elif k == "impact":
        add(sfx, impact(0.9), t, 1.0)
        add(sfx, whoosh(0.7, 4000, 200, 0.25), t - 0.55, 1.0)
    elif k == "majority":
        add(sfx, game_tone(880, 0.25, 0.08, "tri") + np.pad(game_tone(1320, 0.1, 0.05), (0, int(0.15 * SR))), t, 3.0)
    elif k == "point":
        n = c.get("n", 1)
        for j in range(2):
            add(sfx, game_tone(note(74 + (n - 1) * 3 + j * 7), 0.12, 0.08, "tri"), t + j * 0.07, 3.0, 0.2)
    elif k == "crown":
        for j, m in enumerate((81, 86, 90, 93)):
            add(sfx, game_tone(note(m), 0.25, 0.05, "sine"), t + j * 0.06, 3.0, -0.3 + j * 0.2)
    elif k == "sly":
        for j, m in enumerate((74, 73, 72)):
            add(sfx, pluck(note(m), 0.5, 0.5) * 0.4, t + j * 0.12, 0.8, -0.2)
    elif k == "suspense":
        d = 2.0
        add(sfx, pad([note(38), note(50)], d, 400) * 0.4, t - 0.6, 1.0)
    elif k == "party":
        for j in range(6):
            add(sfx, clap(0.8), t + j * 0.09, 0.5, rs.uniform(-0.5, 0.5))
    elif k == "logo":
        add(sfx, impact(1.1), t, 1.0)
        for j, m in enumerate((62, 69, 74, 78, 81)):
            add(sfx, pluck(note(m), 2.5, 0.7) * 0.4, t + j * 0.05, 0.9, -0.4 + j * 0.2)

sfx = apply_reverb(sfx, reverb_ir(1.4, 0.3, 9), 0.22)
sfx /= max(1.0, np.abs(sfx).max() / 0.95)

sf.write(os.path.join(BUILD, "music.wav"), music.astype(np.float32), SR)
sf.write(os.path.join(BUILD, "sfx.wav"), sfx.astype(np.float32), SR)
print(f"music + sfx: {DUR:.2f}s")
