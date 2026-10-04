#!/usr/bin/env bash
# Install the free scraping toolchain into ~/.scraping-tools (idempotent).
# Usage: bash setup.sh [--with-maps]
set -euo pipefail
T="${SCRAPING_TOOLS_DIR:-$HOME/.scraping-tools}"
mkdir -p "$T"
if [ ! -x "$T/venv/bin/yt-dlp" ]; then
  python3 -m venv "$T/venv"
  "$T/venv/bin/pip" install -q --upgrade pip
fi
"$T/venv/bin/pip" install -q --upgrade "yt-dlp[default,curl-cffi]" instaloader twscrape
echo "python tools: $T/venv/bin/{yt-dlp,instaloader,twscrape}"
if [ "${1:-}" = "--with-maps" ]; then
  if [ ! -x "$T/gmaps-scraper" ]; then
    command -v go >/dev/null || { echo "Go is required for Google Maps (gosom). Install Go 1.26.6+." >&2; exit 1; }
    rm -rf "$T/gosom-src"
    git -c core.hooksPath=/dev/null clone -q --depth 1 https://github.com/gosom/google-maps-scraper.git "$T/gosom-src"
    (cd "$T/gosom-src" && git log -1 --format='gosom commit %h %cI' && go build -o "$T/gmaps-scraper" .)
  fi
  echo "maps tool: $T/gmaps-scraper  (always export DISABLE_TELEMETRY=1)"
fi
