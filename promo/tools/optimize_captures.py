"""Convert raw Playwright PNG captures to high-quality WebP for the compositor."""
import glob, os
from PIL import Image
d = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "capture")
for p in sorted(glob.glob(os.path.join(d, "*.png"))):
    im = Image.open(p).convert("RGB")
    im.save(p[:-4] + ".webp", "WEBP", quality=93, method=6)
    os.remove(p)
print("converted", d)
