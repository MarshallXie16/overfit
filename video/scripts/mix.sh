#!/usr/bin/env bash
# mix.sh — put the picture and the sound together at a broadcast-safe loudness.
#
#   scripts/mix.sh out/silent.mp4 out/final.mp4 [score.wav] [sfx.wav] [--sfx-gain 0.8]
#
# Zero audio files: copies the video. One: normalises it. Two: mixes score + SFX, then normalises.
# Audio is padded with silence to the video length (apad + -shortest), so a short score never trims the film.
# Loudness target -14 LUFS (what Reels / TikTok / YouTube normalise to), true peak -1.5 dBTP.
set -euo pipefail
VIDEO="${1:?usage: mix.sh silent.mp4 final.mp4 [score.wav] [sfx.wav] [--sfx-gain G]}"
OUT="${2:?usage: mix.sh silent.mp4 final.mp4 [score.wav] [sfx.wav] [--sfx-gain G]}"; shift 2
A1=""; A2=""; N=0; GAIN=1
while [ $# -gt 0 ]; do
  case "$1" in
    --sfx-gain) GAIN="$2"; shift 2 ;;
    *) N=$((N + 1)); if [ "$N" -eq 1 ]; then A1="$1"; elif [ "$N" -eq 2 ]; then A2="$1"; else echo "mix.sh: at most two audio files (score, sfx)" >&2; exit 1; fi; shift ;;
  esac
done
for f in "$VIDEO" $A1 $A2; do [ -f "$f" ] || { echo "mix.sh: no such file: $f" >&2; exit 1; }; done
mkdir -p "$(dirname "$OUT")"
LOUD="loudnorm=I=-14:TP=-1.5:LRA=11"

case "$N" in
  0) ffmpeg -v error -y -i "$VIDEO" -c copy "$OUT" ;;
  1) ffmpeg -v error -y -i "$VIDEO" -i "$A1" -filter_complex "[1:a]${LOUD},apad[a]" \
       -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest "$OUT" ;;
  2) ffmpeg -v error -y -i "$VIDEO" -i "$A1" -i "$A2" \
       -filter_complex "[2:a]volume=${GAIN}[s];[1:a][s]amix=inputs=2:duration=longest:normalize=0,${LOUD},apad[a]" \
       -map 0:v -map "[a]" -c:v copy -c:a aac -b:a 192k -shortest "$OUT" ;;
esac
echo "wrote $OUT ($(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")s, audio inputs: $N)"
