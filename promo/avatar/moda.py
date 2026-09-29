"""Talking face via the free MoDA demo (Hugging Face ZeroGPU). Usage: python moda.py FACE AUDIO OUT.mp4 [emotion=Happiness]"""
import sys, shutil, time
from gradio_client import Client, handle_file
face, audio, out = sys.argv[1:4]; emo = sys.argv[4] if len(sys.argv) > 4 else "Happiness"; t = time.time()
r = Client("multimodalart/MoDA-fast-talking-head", verbose=False).predict(source_image_path=handle_file(face), driving_audio_path=handle_file(audio),
        emotion_name=emo, cfg_scale=1.2, api_name="/generate_motion")
shutil.copy(r["video"] if isinstance(r, dict) else r, out); print("ok", out, round(time.time() - t), "s", flush=True)
