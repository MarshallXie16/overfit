#!/usr/bin/env bash
# determinism_check.sh — render the same seconds twice and compare every decoded frame.
# A seek(t) film is a pure function of time; if this fails, something reads a clock,
# Math.random, a CSS transition or state carried between frames.
#
#   scripts/determinism_check.sh [index.html] [seconds=2]
set -euo pipefail
PAGE="${1:-index.html}"; DUR="${2:-2}"
HERE="$(cd "$(dirname "$0")" && pwd)"
mkdir -p out
node "$HERE/render.mjs" --page "$PAGE" --dur "$DUR" --sub 1 --out out/det_a.mp4 >/dev/null
node "$HERE/render.mjs" --page "$PAGE" --dur "$DUR" --sub 1 --out out/det_b.mp4 >/dev/null
ffmpeg -v error -i out/det_a.mp4 -f framemd5 - | grep -v '^#' > out/det_a.md5
ffmpeg -v error -i out/det_b.mp4 -f framemd5 - | grep -v '^#' > out/det_b.md5
if cmp -s out/det_a.md5 out/det_b.md5; then
  echo "deterministic: $(wc -l < out/det_a.md5 | tr -d ' ') frames identical across two renders"
else
  echo "NOT deterministic: first differing frame:"; diff out/det_a.md5 out/det_b.md5 | head -3; exit 1
fi
