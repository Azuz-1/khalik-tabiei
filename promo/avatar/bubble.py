"""Overlay a talking-face clip as a small circle (bottom-right) on a part of the promo video.
Usage: python bubble.py FACE.mp4 VIDEO.mp4 START_S OUT.mp4 [diameter=300] [x=750] [y=1540]
The face clip's audio is ignored; the video's own mix (music + Voice 4) is kept, so lips follow the same narration."""
import os, subprocess, sys
import numpy as np
from PIL import Image, ImageDraw
import imageio_ffmpeg

FF = imageio_ffmpeg.get_ffmpeg_exe()
face, video, start, out = sys.argv[1], sys.argv[2], float(sys.argv[3]), sys.argv[4]
d = int(sys.argv[5]) if len(sys.argv) > 5 else 300
x = int(sys.argv[6]) if len(sys.argv) > 6 else 750
y = int(sys.argv[7]) if len(sys.argv) > 7 else 1540
ring = 6
mask = os.path.join(os.path.dirname(os.path.abspath(out)), "_mask.png")
m = Image.new("L", (d * 4, d * 4), 0); ImageDraw.Draw(m).ellipse((0, 0, d * 4 - 1, d * 4 - 1), fill=255)
m.resize((d, d), Image.LANCZOS).save(mask)
dur = float(subprocess.run([FF, "-i", face], capture_output=True, text=True).stderr.split("Duration: ")[1].split(",")[0].split(":")[2])
fc = (f"[1:v]crop='min(iw,ih)':'min(iw,ih)',scale={d}:{d},format=rgba[f];[2:v]format=gray[m];[f][m]alphamerge[fa];"
      f"color=c=white:s={d + 2 * ring}x{d + 2 * ring}:d={dur}[ringbg];[3:v]format=gray[m2];[ringbg][m2]alphamerge[ringa];"
      f"[0:v][ringa]overlay={x - ring}:{y - ring}:shortest=1[v1];[v1][fa]overlay={x}:{y}:shortest=1[v]")
m2 = mask.replace(".png", "_ring.png"); Image.open(mask).resize((d + 2 * ring, d + 2 * ring), Image.LANCZOS).save(m2)
subprocess.run([FF, "-y", "-loglevel", "error", "-ss", str(start), "-t", f"{dur:.3f}", "-i", video, "-i", face,
                "-loop", "1", "-i", mask, "-loop", "1", "-i", m2, "-filter_complex", fc, "-map", "[v]", "-map", "0:a",
                "-c:v", "libx264", "-crf", "18", "-preset", "medium", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", out], check=True)
os.remove(mask); os.remove(m2); print("ok", out, f"{dur:.2f}s")
