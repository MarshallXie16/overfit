#!/usr/bin/env python3
"""beats.py - the beat grid every state change, cut and SFX snaps to.

  python scripts/beats.py audio/track.wav > beats.json         # measure a real track (needs librosa)
  python scripts/beats.py --bpm 120 --dur 15 > beats.json       # synthetic grid for code-synthesized music

Output JSON:
  bpm        tempo
  duration   seconds
  beats      every beat        -> state changes and cuts go here
  downbeats  every 4th beat    -> the big moments go here
  hits       onset peaks       -> SFX go here (synthetic mode: same as beats)
"""
import sys, json, argparse

p = argparse.ArgumentParser()
p.add_argument("track", nargs="?", help="audio file to measure")
p.add_argument("--bpm", type=float, help="synthesize a grid at this tempo instead of measuring")
p.add_argument("--dur", type=float, help="duration for a synthetic grid (seconds)")
p.add_argument("--offset", type=float, default=0.0, help="first downbeat time for a synthetic grid")
a = p.parse_args()

if a.bpm:
    if not a.dur:
        sys.exit("beats.py: --bpm needs --dur")
    step = 60.0 / a.bpm
    beats = []
    t = a.offset
    while t < a.dur:
        beats.append(round(t, 3))
        t += step
    out = {"bpm": a.bpm, "duration": a.dur, "beats": beats, "downbeats": beats[::4], "hits": beats}
elif a.track:
    try:
        import numpy as np, librosa
    except ImportError:
        sys.exit("beats.py: librosa not installed. Run: pip install numpy librosa soundfile\n"
                 "         (or use --bpm/--dur for a synthetic grid when the music is code-generated)")
    y, sr = librosa.load(a.track, sr=None, mono=True)
    tempo, frames = librosa.beat.beat_track(y=y, sr=sr, units="frames")
    beats = librosa.frames_to_time(frames, sr=sr).round(3).tolist()
    onset = librosa.onset.onset_strength(y=y, sr=sr)
    peaks = librosa.util.peak_pick(onset, pre_max=3, post_max=3, pre_avg=3, post_avg=5, delta=0.5, wait=10)
    out = {
        "bpm": float(np.atleast_1d(tempo)[0]),
        "duration": round(float(len(y) / sr), 3),
        "beats": beats,
        "downbeats": beats[::4],
        "hits": librosa.frames_to_time(peaks, sr=sr).round(3).tolist(),
    }
else:
    p.print_help()
    sys.exit(2)

json.dump(out, sys.stdout, indent=1)
print()
