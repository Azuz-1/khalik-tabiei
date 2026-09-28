"""Music bed + sound design for the short cut.

Music: modern, minimal game-ad bed in F minor, 116 BPM — soft sine kick,
light snap, sparse hats, sidechained sub bass, warm FM electric-piano chords
and a sparse mallet motif. Sections follow the narration beats
(build/timings.json); drums drop out for the secret / countdown / reveal, and
the bed falls silent for a beat right before «ارفعوا!», «انمسك!» and the logo.

SFX: triggered from build/cues.json. Countdown, action, hold, reveal, vote,
caught, join are ports of the game's own Web Audio recipes
(client/src/audio/gameAudio.ts).

Writes build/music.wav and build/sfx.wav (48 kHz stereo float).
"""
import json, os
import numpy as np
import soundfile as sf
from scipy.signal import butter, sosfilt, fftconvolve

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
SR = 48000
rs = np.random.RandomState(7)

TM = json.load(open(os.path.join(BUILD, "timings.json")))
CU = json.load(open(os.path.join(BUILD, "cues.json")))
DUR = CU["duration"] + 0.6
N = int(DUR * SR)
beat = {b["id"]: b for b in TM["beats"]}
chunk = {c["id"]: c for c in TM["chunks"]}
cues = CU["cues"]
def cue_t(kind):
    return next((c["t"] for c in cues if c["type"] == kind), None)
T_ACTION, T_CAUGHT, T_LOGO = cue_t("action"), cue_t("caught"), cue_t("logo")

# ------------------------------------------------------------------ utils --
def n_(d): return int(round(d * SR))
def tt(d): return np.arange(n_(d)) / SR
def lp(x, f, o=2): return sosfilt(butter(o, f, "low", fs=SR, output="sos"), x)
def hp(x, f, o=2): return sosfilt(butter(o, f, "high", fs=SR, output="sos"), x)
def bp(x, a, b, o=2): return sosfilt(butter(o, [a, b], "band", fs=SR, output="sos"), x)
def midi(m): return 440.0 * 2 ** ((m - 69) / 12)

def add(buf, x, t, g=1.0, pan=0.0):
    i = n_(t)
    if i >= len(buf) or i + len(x) <= 0: return
    if i < 0: x = x[-i:]; i = 0
    x = x[: len(buf) - i]
    buf[i:i + len(x), 0] += x * g * np.cos((pan + 1) * np.pi / 4) * np.sqrt(2)
    buf[i:i + len(x), 1] += x * g * np.sin((pan + 1) * np.pi / 4) * np.sqrt(2)

def env(d, a=0.003, tau=0.2, rel=0.02):
    t = tt(d); e = np.exp(-t / tau)
    ai = max(1, n_(a)); e[:ai] *= np.linspace(0, 1, ai)
    ri = max(1, n_(rel)); e[-ri:] *= np.linspace(1, 0, ri)
    return e

def room(seconds=1.2, decay=0.28, seed=3):
    r = np.random.RandomState(seed); t = tt(seconds)
    ir = np.stack([r.randn(len(t)), r.randn(len(t))], 1) * np.exp(-t / decay)[:, None]
    ir = np.stack([lp(ir[:, 0], 5000), lp(ir[:, 1], 5000)], 1)
    return ir / np.sqrt((ir ** 2).sum(0))

def reverb(x, ir, wet):
    return x + wet * np.stack([fftconvolve(x[:, k], ir[:, k])[: len(x)] for k in range(2)], 1)

# ------------------------------------------------------------ instruments --
def kick(v=1.0):
    d = 0.45; t = tt(d)
    f = 48 + 110 * np.exp(-t / 0.035)
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * env(d, 0.001, 0.16, 0.05)
    x = np.tanh(1.6 * x) / np.tanh(1.6)
    c = n_(0.0015); x[:c] += hp(rs.randn(c), 3000) * 0.15
    return x * v

def snap(v=1.0):
    d = 0.12
    n = bp(rs.randn(n_(d)), 1800, 5200) * env(d, 0.0005, 0.022, 0.01)
    tone = np.sin(2 * np.pi * 1150 * tt(d)) * env(d, 0.0005, 0.012, 0.01)
    return (0.8 * n + 0.25 * tone) * v

def hat(v=1.0, open_=False):
    d = 0.18 if open_ else 0.05
    return hp(rs.randn(n_(d)), 7500, 3) * env(d, 0.0005, 0.06 if open_ else 0.012, 0.01) * 0.5 * v

def sub(f, d, v=1.0):
    t = tt(d)
    x = np.sin(2 * np.pi * f * t) + 0.18 * np.sin(4 * np.pi * f * t)
    e = np.minimum(1, t / 0.008) * np.exp(-t / max(0.2, d * 0.8))
    r = n_(0.03); e[-r:] *= np.linspace(1, 0, r)
    return lp(np.tanh(1.3 * x * e), 400) * 0.6 * v

_EP = {}
def ep(m, d=1.8, v=1.0):
    """Clean FM electric-piano note (Rhodes-like tine), cached."""
    key = (m, round(d, 2))
    if key not in _EP:
        f = midi(m); t = tt(d)
        idx = 1.6 * np.exp(-t / 0.35)
        mod = np.sin(2 * np.pi * f * t) * idx
        x = np.sin(2 * np.pi * f * t + mod) * np.exp(-t / 1.1)
        x += 0.25 * np.sin(2 * np.pi * 2 * f * t) * np.exp(-t / 0.25)
        a = n_(0.006); x[:a] *= np.linspace(0, 1, a)
        r = n_(0.08); x[-r:] *= np.linspace(1, 0, r)
        _EP[key] = lp(x, 3200)
    return _EP[key] * v

def mallet(m, v=1.0):
    f = midi(m); d = 0.6; t = tt(d)
    x = np.sin(2 * np.pi * f * t) * np.exp(-t / 0.22) + 0.35 * np.sin(2 * np.pi * 3.9 * f * t) * np.exp(-t / 0.05)
    a = n_(0.002); x[:a] *= np.linspace(0, 1, a)
    return x * v

def pad(ms, d, cutoff=900):
    t = tt(d); x = np.zeros(len(t))
    for m in ms:
        f = midi(m)
        for det in (-0.08, 0.08):
            x += np.sin(2 * np.pi * f * (1 + det / 100) * t) + 0.3 * np.sin(2 * np.pi * 2 * f * (1 + det / 100) * t)
    x = lp(x / (2.6 * len(ms)), cutoff)
    fade = min(0.8, d / 3)
    return x * np.minimum(1, t / fade) * np.minimum(1, np.maximum(0, d - t) / fade)

# -------------------------------------------------------------- structure --
BPM = 116
BT = 60 / BPM
CHORDS = [  # voicings (midi) and bass root — Fm9 · Dbmaj7 · Abmaj7 · Eb6
    ([56, 60, 63, 67], 41), ([56, 60, 61, 65], 37), ([55, 60, 63, 68], 44), ([55, 58, 60, 63], 39),
]
MOTIF = [(0, 72), (1.5, 75), (2, 77), (3, 75)]  # beats, midi — F minor pentatonic

def B(i): return beat[i]["start"]
def silence_before(t, d=0.22):
    return (t - d, t) if t else None

SECTIONS = [
    # name,      start,       end,        drums, bass, keys, motif, pad
    ("hook",     0.0,         B("s2"),    0,     0,    1,    0,     1),
    ("groove",   B("s2"),     B("s4"),    1,     1,    1,    0,     0),
    ("secret",   B("s4"),     B("s5"),    0,     2,    1,    0,     1),
    ("count",    B("s5"),     T_ACTION,   0,     0,    0,    0,     1),
    ("groove",   T_ACTION,    B("s7"),    2,     1,    1,    1,     0),
    ("reveal",   B("s7"),     B("s8"),    0,     2,    1,    0,     1),
    ("vote",     B("s8"),     T_CAUGHT,   3,     2,    1,    0,     0),
    ("groove",   T_CAUGHT,    B("s11"),   2,     1,    1,    1,     0),
    ("build",    B("s11"),    B("s12"),   4,     1,    1,    1,     0),
    ("question", B("s12"),    T_LOGO,     0,     0,    1,    0,     1),
    ("end",      T_LOGO,      DUR,        0,     0,    0,    0,     0),
]
STOPS = [silence_before(T_ACTION), silence_before(T_CAUGHT), silence_before(T_LOGO, 0.3)]

drums = np.zeros((N, 2)); bass = np.zeros((N, 2)); keys = np.zeros((N, 2)); mot = np.zeros((N, 2)); pads = np.zeros((N, 2)); fx = np.zeros((N, 2))
kicks = []

for name, a, b, dr, bs, ky, mo, pd in SECTIONS:
    if b - a < 0.05:
        continue
    nbeats = int(np.ceil((b - a) / BT)) + 1
    for k in range(nbeats):
        tb = a + k * BT
        if tb >= b - 0.03:
            break
        bar, pos = divmod(k, 4)
        ch, root = CHORDS[bar % 4]
        # drums
        if dr in (1, 2, 4):
            if pos in (0, 2) or (dr == 4):
                add(drums, kick(1.0 if pos == 0 else 0.85), tb, 1.0); kicks.append(tb)
            if pos in (1, 3):
                add(drums, snap(0.8), tb, 0.55, 0.05)
            add(drums, hat(0.55 + 0.15 * (pos % 2)), tb + BT / 2, 0.5, 0.3)
            if dr in (2, 4):
                add(drums, hat(0.3), tb + BT / 4, 0.4, -0.3)
                add(drums, hat(0.25), tb + 3 * BT / 4, 0.4, -0.3)
        elif dr == 3:  # heartbeat for the vote
            if pos == 0:
                add(drums, kick(0.8), tb, 1.0); add(drums, kick(0.5), tb + 0.18, 1.0); kicks += [tb, tb + 0.18]
            add(drums, hat(0.4), tb + BT / 2, 0.45, 0.3)
        # bass
        if bs == 1 and pos in (0, 2):
            add(bass, sub(midi(root), BT * (1.5 if pos == 0 else 1.0)), tb, 1.0)
            if pos == 2:
                add(bass, sub(midi(root + 12), BT * 0.45, 0.5), tb + 1.5 * BT, 1.0)
        elif bs == 2 and pos == 0:
            add(bass, sub(midi(root), BT * 3.5, 0.8), tb, 1.0)
        # keys: one soft chord per bar (stabs on the offbeat in grooves)
        if ky and pos == 0:
            for j, m in enumerate(ch):
                add(keys, ep(m, BT * 3.8, 0.5), tb + 0.012 * j, 0.55, -0.35 + 0.23 * j)
        if ky and dr in (2, 4) and pos == 2:
            for j, m in enumerate(ch[1:]):
                add(keys, ep(m + 12, 0.5, 0.25), tb + BT / 2, 0.35, 0.3 - 0.2 * j)
        # motif every other bar
        if mo and pos == 0 and bar % 2 == 1:
            for off, m in MOTIF:
                if tb + off * BT < b - 0.05:
                    add(mot, mallet(m, 0.5), tb + off * BT, 0.5, 0.25)
    if pd:
        ms = {"hook": [53, 60, 63, 68], "secret": [53, 56, 61], "count": [41, 48], "reveal": [53, 56, 60], "question": [53, 56, 60, 63]}.get(name, [53, 60, 63])
        add(pads, pad(ms, b - a + 0.5, 700 if name in ("secret", "count") else 1100), a - 0.05, 0.8)
    if name == "count":  # rising tension into «ارفعوا!»
        d = b - a
        x = hp(rs.randn(n_(d)), 1200) * np.linspace(0, 1, n_(d)) ** 2.5 * 0.09
        add(fx, x, a, 1.0, 0.0)
    if name == "build":
        d = b - a
        x = hp(rs.randn(n_(d)), 2000) * np.linspace(0, 1, n_(d)) ** 3 * 0.07
        add(fx, x, a, 1.0)

# sidechain: bass and keys duck under each kick
duck = np.ones(N)
for kt in kicks:
    i = n_(kt); d = n_(0.16)
    if i < N:
        seg = 1 - 0.55 * np.exp(-np.arange(min(d, N - i)) / SR / 0.06)
        duck[i:i + len(seg)] = np.minimum(duck[i:i + len(seg)], seg)
bass *= duck[:, None]; keys *= (0.5 + 0.5 * duck)[:, None]

music = drums * 0.9 + bass * 0.9 + keys * 0.55 + mot * 0.5 + pads * 0.4 + fx
music = reverb(music, room(1.2, 0.25), 0.12)
# silent beats before the big moments
for s in STOPS:
    if not s: continue
    a, b = n_(s[0]), n_(s[1])
    ramp = n_(0.03)
    music[a:a + ramp] *= np.linspace(1, 0, ramp)[:, None]
    music[a + ramp:b] = 0
# final: logo chord + kick, then ring out
if T_LOGO:
    for j, m in enumerate([53, 60, 63, 67, 72]):
        add(music, ep(m, 3.0, 0.6), T_LOGO + 0.01 * j, 0.6, -0.4 + 0.2 * j)
    add(music, kick(1.0), T_LOGO, 1.0)
music = np.tanh(music * 1.2) / 1.2
music /= np.abs(music).max() + 1e-9
music *= 0.9
tail = n_(0.8)
music[-tail:] *= np.linspace(1, 0, tail)[:, None]

# --------------------------------------------------------------------- SFX --
sfx = np.zeros((N, 2))

def game_tone(f, d, peak, wave="sine", delay=0.0, f_end=None):
    """Port of gameAudio.ts tone(): ≤18 ms linear attack, linear release."""
    t = tt(d)
    ph = 2 * np.pi * (f * t if f_end is None else np.cumsum(np.linspace(f, f_end, len(t))) / SR)
    x = 2 / np.pi * np.arcsin(np.sin(ph)) if wave == "tri" else np.sin(ph)
    atk = min(0.018, d * 0.24)
    e = np.where(t < atk, t / atk, 1 - (t - atk) / (d - atk))
    y = np.zeros(n_(delay + d)); y[n_(delay):n_(delay) + len(x)] = x * e * peak
    return y

def mixdown(*parts):
    L = max(len(p) for p in parts)
    return sum(np.pad(p, (0, L - len(p))) for p in parts)

def soft_hit(g=1.0):
    d = 1.0
    return (kick(1.0)[: n_(d)] if n_(d) <= len(kick()) else np.pad(kick(), (0, n_(d) - len(kick())))) * g

def swish(d=0.28, g=0.12):
    x = bp(rs.randn(n_(d)), 1500, 7000) * np.sin(np.pi * tt(d) / d) ** 2
    return x * g

for c in cues:
    t, k = c["t"], c["type"]
    if k == "tick":
        f = {5: 320, 4: 380, 3: 450, 2: 530, 1: 640}[c["step"]]
        add(sfx, game_tone(f, 0.095, 0.18 if c["step"] == 1 else 0.14, "tri"), t, 5.5)
    elif k == "action":
        add(sfx, mixdown(game_tone(165, 0.2, 0.22, "sine", 0, 95), game_tone(930, 0.085, 0.1, "tri")), t, 4.5)
        add(sfx, kick(1.0), t, 0.9)
    elif k == "hold":
        add(sfx, game_tone(145, 0.14, 0.075, "sine", 0, 125), t, 5.0)
    elif k == "reveal":
        add(sfx, mixdown(game_tone(500, 0.18, 0.11), game_tone(660, 0.22, 0.1, "tri", 0.075)), t, 6.0)
    elif k == "vote":
        n = c.get("n", 1)
        add(sfx, game_tone(760 + min(max(n - 1, 0), 3) * 35, 0.075, 0.052), t, 16.0, 0.15 * ((n % 3) - 1))
    elif k == "caught":
        add(sfx, mixdown(game_tone(440, 0.28, 0.12, "tri"), game_tone(554, 0.28, 0.115, "tri", 0.12), game_tone(659, 0.32, 0.11, "sine", 0.24)), t + 0.03, 5.5)
        add(sfx, kick(1.0), t, 1.0)
    elif k == "join":
        add(sfx, game_tone(820, 0.09, 0.05), t, 9.0)
    elif k == "point":
        n = c.get("n", 1)
        add(sfx, mixdown(game_tone(midi(76 + 2 * (n - 1)), 0.12, 0.08, "tri"), game_tone(midi(83 + 2 * (n - 1)), 0.1, 0.05, "sine", 0.06)), t, 11.0)
    elif k == "crown":
        for j, m in enumerate((84, 88, 91, 96)):
            add(sfx, game_tone(midi(m), 0.25, 0.045), t + j * 0.055, 8.0, -0.3 + 0.2 * j)
    elif k in ("mask", "impostor"):
        d = 0.9
        add(sfx, np.sin(2 * np.pi * np.cumsum(np.linspace(110, 70, n_(d))) / SR) * env(d, 0.05, 0.35, 0.2) * 0.35, t, 1.0)
        add(sfx, mallet(61, 0.35) + np.pad(mallet(60, 0.3), (0, 0)), t + 0.02, 0.6, 0.2)
    elif k == "flip":
        add(sfx, swish(0.18, 0.08), t, 1.0)
    elif k == "tap":
        x = hp(rs.randn(n_(0.015)), 3000) * env(0.015, 0.0005, 0.003, 0.003) * 0.25
        add(sfx, x, t, 1.0)
    elif k == "question":
        add(sfx, mallet(79, 0.35), t, 0.7, 0.3); add(sfx, mallet(82, 0.35), t + 0.13, 0.7, 0.3)
    elif k == "swish":
        add(sfx, swish(0.25, 0.07), t - 0.08, 1.0, rs.uniform(-0.3, 0.3))
    elif k == "whoosh":
        add(sfx, swish(0.3, 0.09), t - 0.1, 1.0)
    elif k == "sly":
        for j, m in enumerate((79, 78, 77)):
            add(sfx, mallet(m, 0.3), t + j * 0.1, 0.7, -0.2)
    elif k == "impact":
        add(sfx, kick(1.0), t, 0.9)
    elif k == "logo":
        add(sfx, mixdown(game_tone(440, 0.28, 0.1, "tri"), game_tone(554, 0.28, 0.1, "tri", 0.1), game_tone(659, 0.34, 0.1, "sine", 0.2)), t + 0.05, 6.0)

sfx = reverb(sfx, room(1.0, 0.22, 9), 0.15)
sfx /= max(1.0, np.abs(sfx).max() / 0.95)
sf.write(os.path.join(BUILD, "music.wav"), music.astype(np.float32), SR)
sf.write(os.path.join(BUILD, "sfx.wav"), sfx.astype(np.float32), SR)
print(f"music + sfx: {DUR:.2f}s")
