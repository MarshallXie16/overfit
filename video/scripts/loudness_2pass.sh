#!/usr/bin/env bash
# loudness_2pass.sh — project-local follow-up to the skill's mix.sh: measure the mixed file, then re-run loudnorm
# with the measured values (linear mode) so the integrated loudness really lands on -14 LUFS.
#   scripts/loudness_2pass.sh in.mp4 out.mp4
set -euo pipefail
IN="${1:?usage: loudness_2pass.sh in.mp4 out.mp4}"; OUT="${2:?usage: loudness_2pass.sh in.mp4 out.mp4}"
J=$(ffmpeg -nostats -i "$IN" -af "loudnorm=I=-14:TP=-1.5:LRA=11:print_format=json" -f null - 2>&1 | sed -n '/^{/,/^}/p')
get() { echo "$J" | python3 -c "import json,sys; print(json.load(sys.stdin)['$1'])"; }
I=$(get input_i); TP=$(get input_tp); LRA=$(get input_lra); TH=$(get input_thresh); OFF=$(get target_offset)
ffmpeg -v error -y -i "$IN" -af "loudnorm=I=-14:TP=-1.5:LRA=11:measured_I=$I:measured_TP=$TP:measured_LRA=$LRA:measured_thresh=$TH:offset=$OFF:linear=true" \
  -c:v copy -c:a aac -b:a 192k "$OUT"
R=$(ffmpeg -nostats -i "$OUT" -af ebur128=framelog=quiet -f null - 2>&1 | grep -E "^\s+I:" | tail -1)
echo "wrote $OUT (pass 1 measured I=$I LUFS TP=$TP; pass 2 result$R)"
