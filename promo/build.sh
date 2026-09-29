#!/usr/bin/env bash
# Full promo build: voice → frames → score → mix → final MP4.
# Prereqs: tools/setup.sh has been run once (Python deps + local models).
set -euo pipefail
OUT="${OUT:-khalik-tabiei-promo}"   # OUT=khalik-tabiei-promo-v4 PICKS=V4_picks for the ElevenLabs voice
cd "$(dirname "$0")"
FF="${FFMPEG:-ffmpeg}"

# Voice: the owner-confirmed Saudi-Najdi AI narration (voice_auditions/segments/R_picks), assembled with
# the owner's own pauses; captions timed by forced alignment. Needs torch/torchaudio/uroman/librosa
# (set VO_PY to that interpreter). See voice_auditions/RECIPE.md.
"${VO_PY:-python3}" audio/narration_picks.py
node render/render.mjs                         # frames → build/video.mp4 (+ build/cues.json)
python3 audio/score.py                         # original music + SFX from cues
python3 audio/mix.py                           # duck, EQ, loudness → build/mix.wav

mkdir -p out
DUR=$(python3 -c "import json;print(json.load(open('build/cues.json'))['duration'])")
FADE=$(python3 -c "print($DUR-0.6)")
# Two-pass at ~2.25 Mb/s keeps the file under 30 MiB (easy to share from a phone)
# with no visible loss; platforms re-encode to a similar rate anyway.
X264=(-c:v libx264 -preset slow -b:v 2250k -profile:v high -level 4.2 -pix_fmt yuv420p -x264-params aq-mode=3 -r 30)
(cd build && "$FF" -y -hide_banner -loglevel error -i video.mp4 -t "$DUR" "${X264[@]}" -pass 1 -passlogfile x264pass -an -f mp4 /dev/null)
(cd build && "$FF" -y -hide_banner -loglevel error -i video.mp4 -i mix.wav -t "$DUR" -map 0:v -map 1:a \
  "${X264[@]}" -maxrate 4500k -bufsize 9000k -pass 2 -passlogfile x264pass \
  -c:a aac -b:a 224k -ar 48000 -af "afade=t=out:st=$FADE:d=0.6" \
  -movflags +faststart -metadata title="خلك طبيعي" -metadata:s:a:0 language=ara \
  "../out/$OUT.mp4")
"$FF" -y -hide_banner -loglevel error -ss 7.6 -i "out/$OUT.mp4" -frames:v 1 -q:v 2 "out/${OUT/khalik-tabiei-promo/cover}.jpg"
echo "→ out/$OUT.mp4"
