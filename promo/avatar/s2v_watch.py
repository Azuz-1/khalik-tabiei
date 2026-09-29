import sys, time, shutil
from gradio_client import Client, handle_file
face, audio, out = sys.argv[1:4]; t = time.time()
print("start", flush=True)
c = Client("Wan-AI/Wan2.2-S2V", verbose=False); print("client", round(time.time() - t), flush=True)
j = c.submit(ref_img=handle_file(face), audio=handle_file(audio), resolution="480P", api_name="/predict"); print("submitted", round(time.time() - t), flush=True)
while not j.done():
    s = j.status(); print(round(time.time() - t), s.code, s.rank, s.queue_size, s.eta, flush=True); time.sleep(30)
try:
    r = j.result(); src = r["video"] if isinstance(r, dict) else r; shutil.copy(src, out); print("ok", out, round(time.time() - t), flush=True)
except Exception as e: print("ERR", repr(e)[:500], flush=True)
