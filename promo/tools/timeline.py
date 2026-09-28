"""Wordless cut: build build/timings.json from script/silent.json.

Same shape the compositor uses for narrated cuts (beats + chunks), but each
chunk is an on-screen text card with a designed reading time instead of a
spoken phrase. Also writes a silent build/vo/narration.wav so the audio tools
run unchanged."""
import json, os
import numpy as np
import soundfile as sf

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BUILD = os.path.join(ROOT, "build")
S = json.load(open(os.path.join(ROOT, "script", "silent.json")))

t = S.get("lead_in", 0.1)
out = {"beats": [], "chunks": [], "wordless": True}
for seg in S["segments"]:
    b0 = t
    for k, (text, dur) in enumerate(seg["cards"]):
        out["chunks"].append({"id": f"{seg['id']}.{k}", "beat": seg["id"], "cap": text, "start": round(t, 3), "end": round(t + dur, 3)})
        t += dur
    out["beats"].append({"id": seg["id"], "start": round(b0, 3), "end": round(t, 3)})
t += S.get("tail", 0.4)
out["duration"] = round(t, 3)
os.makedirs(os.path.join(BUILD, "vo"), exist_ok=True)
json.dump(out, open(os.path.join(BUILD, "timings.json"), "w"), ensure_ascii=False, indent=1)
sf.write(os.path.join(BUILD, "vo", "narration.wav"), np.zeros(int(t * 48000), np.float32), 48000)
print(f"wordless timeline {t:.2f}s, {len(out['chunks'])} cards")
