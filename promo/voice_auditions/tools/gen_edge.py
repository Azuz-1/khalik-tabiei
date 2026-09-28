"""Voice A: Microsoft Edge neural TTS (ar-SA-HamedNeural) via edge-tts.

Usage: python gen_edge.py OUT_DIR [segment numbers...]
Writes OUT_DIR/NN.wav (24 kHz mono). Mild rate/pitch only.
"""
import asyncio, subprocess, sys, os
import ssl
import numpy as np, soundfile as sf
import edge_tts, edge_tts.communicate, imageio_ffmpeg
# Behind a TLS-intercepting proxy: trust the system/proxy CA bundle if set.
if os.environ.get("SSL_CERT_FILE"):
    edge_tts.communicate._SSL_CTX = ssl.create_default_context(cafile=os.environ["SSL_CERT_FILE"])
from script import CAPTIONS

VOICE = "ar-SA-HamedNeural"
# Hidden spellings fed to the engine (captions stay as in script.py).
SPOKEN = {
    1: "تخيّل كلهم يرفعون يدهم، وأنت الوحيد اللي ما تدري وش السالفة!",
    2: "هذي، خَلِّك طَبيعي، لعبة جماعية، وواحد فيكم ما يدري وش المطلوب.",
    3: "تدخلون من جوالاتكم، بدون تحميل ولا تسجيل.",
    4: "كل واحد يشوف المطلوبْ بسرّه، إلا المتخفّي.",
    5: "ثلاثة، اثنين، واحد، ارفعوا!",
    6: "هنا لازم المتخفي يسايركم، ويحاول ما يفضح نفسه.",
    7: "بعدها ينكشف المطلوب، وكل واحد يبدأ يشك بالثاني.",
    8: ["تصوّتون للشخص اللي شاكّين فيه، وإذا أغلبكم اختاره،", "اِنْمَسَك."],  # payoff word as its own phrase
    9: "مرة ترفع يدك، مرة تأشّر، ومرة تورّي رقم بأصابعك، وكل جولة غير.",
    10: "إذا عرفت المتخفّيْ تكسب نقاط، وإذا قدر يفلت، هو اللي يكسب.",
    11: "وبالنهاية، أكثر واحد جمع نقاط هو الفايز.",
    12: "الحين السؤال، تقدر؟ خَلِّك طَبيعي!",
}
# Engine sees "،" instead of "…" (Edge renders "…" as ~1 s dead air), except the
# deliberate beat before «انمسك» in 8; captions unchanged.
# Per-segment prosody. Hamed's default Arabic pace is slow (~52 s of speech for
# this script), so the engine's own rate is raised moderately; pitch kept mild.
PROSODY = {i: ("+15%", "+2Hz") for i in SPOKEN}
PROSODY.update({5: ("+10%", "+3Hz"), 9: ("+20%", "+2Hz"), 10: ("+18%", "+2Hz"), 12: ("+10%", "+2Hz")})

async def one(i, out):
    rate, pitch = PROSODY[i]
    parts = SPOKEN[i] if isinstance(SPOKEN[i], list) else [SPOKEN[i]]
    audio = []
    for k, text in enumerate(parts):
        mp3 = os.path.join(out, f"{i:02d}_{k}.mp3"); wav = mp3[:-4] + ".wav"
        await edge_tts.Communicate(text, VOICE, rate=rate, pitch=pitch).save(mp3)
        subprocess.run([imageio_ffmpeg.get_ffmpeg_exe(), "-y", "-loglevel", "error", "-i", mp3,
                        "-ac", "1", "-ar", "24000", wav], check=True)
        x, sr = sf.read(wav, dtype="float32"); os.remove(mp3); os.remove(wav)
        if len(parts) > 1:  # trim edge silence of sub-phrases, keep a short natural beat
            idx = np.where(np.abs(x) > 10 ** (-45 / 20) * np.abs(x).max())[0]
            x = x[max(idx[0] - 1200, 0):idx[-1] + 1200]
            if k < len(parts) - 1: x = np.concatenate([x, np.zeros(int(0.25 * sr), np.float32)])
        audio.append(x)
    sf.write(os.path.join(out, f"{i:02d}.wav"), np.concatenate(audio), 24000)

async def main():
    out = sys.argv[1]; os.makedirs(out, exist_ok=True)
    segs = [int(a) for a in sys.argv[2:]] or list(SPOKEN)
    for i in segs:
        await one(i, out); print("done", i)

asyncio.run(main())
