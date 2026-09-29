"""Talking face via the free public Wan2.2-S2V demo (Hugging Face Space → Alibaba DashScope). Usage: python s2v.py FACE.png AUDIO.wav OUT.mp4 [480P|720P]"""
import sys, shutil, time
from gradio_client import Client, handle_file
face, audio, out = sys.argv[1:4]; res = sys.argv[4] if len(sys.argv) > 4 else "720P"
t = time.time()
r = Client("Wan-AI/Wan2.2-S2V", verbose=False).predict(ref_img=handle_file(face), audio=handle_file(audio), resolution=res, api_name="/predict")
src = r["video"] if isinstance(r, dict) else r
shutil.copy(src, out); print("ok", out, round(time.time() - t), "s")
