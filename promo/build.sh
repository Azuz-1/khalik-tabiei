#!/usr/bin/env bash
# Full promo build: voice → frames → score → mix → final MP4.
# Prereqs: tools/setup.sh has been run once (Python deps + local models).
set -euo pipefail
cd "$(dirname "$0")"
FF="${FFMPEG:-ffmpeg}"

python3 audio/tts.py --takes="${TAKES:-5}"   # Arabic VO (cached per line)
node render/render.mjs                         # frames → build/video.mp4 (+ build/cues.json)
python3 audio/score.py                         # original music + SFX from cues
python3 audio/mix.py                           # duck, EQ, loudness → build/mix.wav

mkdir -p out
DUR=$(python3 -c "import json;print(json.load(open('build/cues.json'))['duration'])")
"$FF" -y -hide_banner -loglevel error -i build/video.mp4 -i build/mix.wav \
  -t "$DUR" -map 0:v -map 1:a \
  -c:v libx264 -preset slow -crf "${CRF:-19}" -profile:v high -level 4.2 -pix_fmt yuv420p \
  -x264-params "aq-mode=3" -r 30 \
  -c:a aac -b:a 256k -ar 48000 -af "afade=t=out:st=$(python3 -c "print($DUR-0.6)"):d=0.6" \
  -movflags +faststart \
  -metadata title="خلك طبيعي" -metadata:s:a:0 language=ara \
  out/khalik-tabiei-promo.mp4
echo "→ out/khalik-tabiei-promo.mp4"
