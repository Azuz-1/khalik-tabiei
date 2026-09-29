"""Generate an original (fictional) face with the free FLUX.1-schnell demo. Usage: python make_face.py OUT.png SEED"""
import sys, shutil
from gradio_client import Client
PROMPT = ("Photorealistic vertical portrait of a fictional young Saudi woman in her mid twenties, warm friendly smile, "
          "bright expressive eyes, playful confident look as if about to explain a fun party game to friends, "
          "wearing a soft beige hijab and a modern black abaya, natural light makeup, looking at the camera, "
          "head and shoulders framing, cozy modern living room softly blurred behind her, warm evening light, "
          "shot on a 50mm lens, natural skin texture, high detail")
out, seed = sys.argv[1], int(sys.argv[2])
c = Client("black-forest-labs/FLUX.1-schnell", verbose=False)
r = c.predict(prompt=PROMPT, seed=seed, randomize_seed=False, width=768, height=1024, num_inference_steps=4, api_name="/infer")
shutil.copy(r[0] if isinstance(r, (list, tuple)) else r, out); print("ok", out)
