#!/usr/bin/env bash
# One-time setup for the promo pipeline (all free / open-source, runs locally).
set -euo pipefail
cd "$(dirname "$0")/.."
pip3 install sherpa-onnx soundfile scipy numpy pillow speechmos librosa onnxruntime imageio-ffmpeg
npm install
mkdir -p .models && cd .models
REL=https://github.com/k2-fsa/sherpa-onnx/releases/download
# Narrator: open-source Piper/VITS Saudi Arabic voice (OpenVoiceOS "ar-SA dii").
[ -d vits-piper-ar_JO-SA_dii-high ] || curl -L "$REL/tts-models/vits-piper-ar_JO-SA_dii-high.tar.bz2" | tar xj
# Whisper (turbo) — used only to QA pronunciation of each take.
[ -d sherpa-onnx-whisper-turbo ] || curl -L "$REL/asr-models/sherpa-onnx-whisper-turbo.tar.bz2" | tar xj
echo "models ready"
