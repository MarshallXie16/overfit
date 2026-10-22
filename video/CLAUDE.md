# Motion studio rules

Claude Code reads this file on every run in this folder, so every film made here follows it
without repeating the rules in each prompt.

## Render contract
- Every film is a pure function of time: `window.seek(t)` paints frame t, nothing else does.
- No CSS transitions, no setTimeout, no requestAnimationFrame in render mode, no state carried
  between frames. Seeded noise only (`rng(seed)` from lib/motion.js), never Math.random.
- Render with `node scripts/render.mjs`; encode H.264 yuv420p, CRF 16, 60 fps, 4 subframes.

## Look
- Banned defaults: centered title on a gradient, everything fading in, corner labels and frame
  borders, glow on UI chrome, generic particle bursts, bouncy easing on type.
- One display face, one UI face. One accent color unless the brief says otherwise.
- Every 2 to 4 seconds something new must happen on screen.
- Real product UI only (screenshots cropped and animated). Never redraw a product from imagination.

## Sound
- Score and SFX are synthesized in code unless a track is supplied.
- Every state change sits on the beat grid (beats.json). SFX on measured onset peaks. Mix to -14 LUFS.

## Loop before you show me anything
1. Render one frame per beat as a contact sheet and LOOK at it.
2. Score 1-10: hook in first 2s, readability at phone size, motion quality, variety,
   composition, brand accuracy, sound sync.
3. Fix the 3 worst problems. Repeat until every score is 8+.
4. Only then do the full render.
