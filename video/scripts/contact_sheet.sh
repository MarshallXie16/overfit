#!/usr/bin/env bash
# contact_sheet.sh — the stills you look at before you show anyone the film.
#
#   scripts/contact_sheet.sh out/final.mp4 [out_dir] [--at SECONDS]
#
# Writes to out_dir (default: out/):
#   contact.png     2 frames per second, 6 across          -> pacing, variety, dead beats
#   phone.png       1 frame per second at 360 px wide      -> readability on a phone
#   loop_check.mp4  the film played twice back to back     -> watch the seam
#   strip.png       12 consecutive frames from --at        -> pops and overlaps in a fast action
set -euo pipefail
IN="${1:?usage: contact_sheet.sh video.mp4 [out_dir] [--at seconds]}"; shift
OUT="out"; AT=""
while [ $# -gt 0 ]; do case "$1" in --at) AT="$2"; shift 2;; *) OUT="$1"; shift;; esac; done
[ -f "$IN" ] || { echo "contact_sheet.sh: no such file: $IN" >&2; exit 1; }
mkdir -p "$OUT"
DUR=$(ffprobe -v error -show_entries format=duration -of csv=p=0 "$IN")
rows() { awk -v n="$1" -v c="$2" 'BEGIN{r=int((n+c-1)/c); print (r<1?1:r)}'; }

N=$(awk -v d="$DUR" 'BEGIN{print int(d*2+0.999)}'); R=$(rows "$N" 6)
ffmpeg -v error -y -i "$IN" -vf "fps=2,scale=270:-1,tile=6x${R}" -frames:v 1 "$OUT/contact.png"

N=$(awk -v d="$DUR" 'BEGIN{print int(d+0.999)}'); R=$(rows "$N" 5)
ffmpeg -v error -y -i "$IN" -vf "fps=1,scale=360:-1,tile=5x${R}" -frames:v 1 "$OUT/phone.png"

ffmpeg -v error -y -stream_loop 1 -i "$IN" -c copy "$OUT/loop_check.mp4"

if [ -n "$AT" ]; then
  START=$(awk -v a="$AT" 'BEGIN{s=a-0.1; print (s<0?0:s)}')
  ffmpeg -v error -y -ss "$START" -i "$IN" -vf "scale=320:-1,tile=12x1" -frames:v 1 "$OUT/strip.png"
fi
echo "contact: $OUT/contact.png  phone: $OUT/phone.png  loop: $OUT/loop_check.mp4${AT:+  strip: $OUT/strip.png}"
