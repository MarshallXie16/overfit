# Review log

Score 1-10. Ship when every axis is 8+. Be a harsh motion director, not a proud author.

## Round 1 — [date/time] — contact.png, phone.png, strip.png @ [t]
| Axis | Score | Evidence (timestamp) |
|------|-------|----------------------|
| Hook in first 2s | | |
| Readability at 360 px | | |
| Motion quality (springs, no dead frames) | | |
| Variety (new thing every 2-4s) | | |
| Composition | | |
| Brand accuracy | | |
| Sound sync | | |

Three biggest problems:
1. [t=…] …
2. [t=…] …
3. [t=…] …

Fixes applied: …

## Round 0 — 2026-10-22 00:16 — checkpoint
Unattended run (the user is away; the parent session asked for the full pipeline). The shot list in
`docs/shotlist.md` was written on the 120 BPM synthetic grid before any code and is shown in the
session's report; no answer was waited for. Style: "Linear launch film" picked out of two proposed
(see `docs/style_guide.md`). Defaults: 20 s, 9:16 + 16:9, synthesized A-minor score, SFX from cues.json.

## Round 1 — 2026-10-22 00:27 — out/r1/{contact,phone,strip@8.4}.png (9:16 draft 540x960) and out/r1w/{contact,phone,strip@4.4}.png (16:9 draft 960x540)
| Axis | Score | Evidence (timestamp) |
|------|-------|----------------------|
| Hook in first 2s | 7 | t=0-2: the Grid + "THE SWARM / LEARNS / YOU." reads, but the image is dimmed to mud (0.42) and the push-in is barely visible |
| Readability at 360 px | 5 | t=2-4, 8-10: panels clipped at the frame edge (my panel scales were absolute pixels, so the half-size draft drew them 2x); t=5.5 sub text 30 px |
| Motion quality (springs, no dead frames) | 7 | strip@8.4: cursor arrives, ring settles, no jumps; t=7.5 the "EVERY SURGE IS BIGGER." line gets only 0.5 s before the cut |
| Variety (new thing every 2-4s) | 8 | every bar is a different kind of shot; no two adjacent contact tiles alike after t=2 |
| Composition | 5 | 16:9 t=2.0 "A BROWSER RTS." collides with the SURGE bar; 16:9 t=5.0 headline overlaps the AXIOM MODEL panel; 9:16 t=3.0 minimap sits on the model panel (same scale bug) |
| Brand accuracy | 9 | every UI element a real crop; Chakra Petch + JetBrains Mono from the game; teal the only drawn accent, red only in crops and the mark |
| Sound sync | 8 | grid_check: cues 40/40 on a beat, cuts 10/10 on a downbeat; out/draft-mixed.mp4 exists |

Three biggest problems:
1. [t=2-4, 8-10, 14-20] every panel scale / offset was in absolute pixels, not multiplied by S = min(W,H)/1080 — wrong at any size but 1080.
2. [t=2.0 16:9] label under the surge bar; [t=5.0 16:9] headline 110 px runs into the panel at 1.6x.
3. [t=7.5] headline lands half a second before the cut; [t=0-2] hook dimmed 0.42.

Fixes applied: all panel scales, offsets and the cursor start now scale with S; 16:9 label moved to 0.17H with no backing; 16:9 feature-1 headline 92 px and panel 1.5x; "EVERY SURGE IS BIGGER." on 7.0 with its underline on 7.5; hook dim 0.30 and push 1.12x; strike zoom 1.15→1.0; sub text 34 px.

## Round 2 — 2026-10-22 00:33 — out/r2/{contact,phone,strip@4.3}.png (9:16) and out/r2w/{contact,phone,strip@18.3}.png (16:9)
| Axis | Score | Evidence (timestamp) |
|------|-------|----------------------|
| Hook in first 2s | 8 | t=0: the AXIOM Core and the red Grid are the first tile; the three words land on 0.0/0.5/1.0, underline on 1.5; push-in now visible across tiles 1-4 |
| Readability at 360 px | 7 | every headline and sub reads on phone.png; t=2-4 the HUD panels sit at 1x CSS size (model-panel body text ~18 px at 1080) |
| Motion quality (springs, no dead frames) | 8 | strip@4.3: the panel grows and settles without a jump, the swap blurs out over 2 frames; strip@18.3: cursor lands, ring expands and fades; a change on every beat |
| Variety (new thing every 2-4s) | 8 | ten different shot types; no two adjacent tiles alike after the hook |
| Composition | 7 | 16:9 collisions gone; 9:16 t=5.0 a 330 px dead band between the headline (0.17H) and the panel (0.40H) |
| Brand accuracy | 9 | unchanged: real crops, real fonts, one accent |
| Sound sync | 8 | grid_check 40/40 and 10/10; draft mix re-made |

Three biggest problems:
1. [t=4-6, 9:16] panel too low under its headline.
2. [t=2-4, 9:16] hero panel body text under 22 px at 1080.
3. [t=2-4] minimap and command card a touch small against the map band.

Fixes applied: feature-1 panel at 0.33H; assemble-shot model panel 1.15x in portrait with the protocols bar tracking its height; minimap and card 0.9x.

## Round 3 — 2026-10-22 00:38 — out/r3/{contact,phone,strip@2.2}.png (9:16) and out/r3w/{contact,phone,strip@9.3}.png (16:9)
| Axis | Score | Evidence (timestamp) |
|------|-------|----------------------|
| Hook in first 2s | 8 | t=0 the AXIOM Core + Grid tile is the most striking still in the film; words on 0.0/0.5/1.0, underline 1.5 |
| Readability at 360 px | 8 | every headline, sub, fact and the URL read on phone.png; t=2-4 the hero panel's title clears 22 px at 1080 |
| Motion quality (springs, no dead frames) | 8 | strip@2.2: map settles from 1.12x, surge bar drops in on frames 1-3, no pop; strip@9.3 (16:9): cursor glides to F7, ring on 9.5; a change on every beat 0-19.5 |
| Variety (new thing every 2-4s) | 8 | hook / assemble / panel push-in / three surges / cursor build / explosion / counter / menu / lockup / CTA |
| Composition | 8 | left-anchored type, UI right or below, no corner labels, no borders, no gradients; 9:16 t=5.0 headline and panel now 200 px apart |
| Brand accuracy | 9 | real crops only, Chakra Petch + JetBrains Mono, teal accent, red only inside crops and the mark |
| Sound sync | 8 | grid_check 40/40 cues, 10/10 cuts; out/draft-mixed.mp4 plays the draft with score + SFX |

Three biggest problems (all under the bar now; carried as "improve next"):
1. [t=2-4] the assemble shot's minimap and card are decoration at this size; a tighter two-panel version would read better on a phone.
2. [t=16-20] the lockup leaves the lower 40% of 9:16 empty for 2 s before the CTA fills it.
3. The score is the placeholder bed (kick/hat/bass/pad); a melody and a stop before the logo would lift sound from "in sync" to "designed".

Fixes applied: none needed; proceeding to the final render.

## Round 4 — 2026-10-22 00:56 — on the FINAL files: out/final/{contact,phone,strip@10.0}.png (9:16, 1080x1920 60 fps sub 4) and out/finalw/{contact,strip@4.4}.png (16:9)
Final render: 9x16 1028 s, 16x9 1232 s (three Chromiums in parallel on an M3 Pro). determinism_check.sh index.html 20: 1200 frames identical.
ffprobe: h264 yuv420p 1080x1920 / 1920x1080, 60 fps, aac 96 kHz mono, 20.000 s. mix.sh single pass measured -16.2 LUFS; scripts/loudness_2pass.sh brings both finals to -14.7 LUFS (TP ceiling -1.5 dBTP limits the last 0.7 LU).
| Axis | Score | Evidence (timestamp) |
|------|-------|----------------------|
| Hook in first 2s | 8 | poster at 1.75 s: Core, Grid, three words, underline |
| Readability at 360 px | 8 | every word reads on out/final/phone.png |
| Motion quality (springs, no dead frames) | 7 | t=12.5-13.8 the counter digits are double-exposed: the rounded value changes between the 4 subframes of a frame and tmix averages them (strip@10.0 shows the strike shake + slam blur as intended) |
| Variety (new thing every 2-4s) | 8 | as round 3 |
| Composition | 8 | as round 3 |
| Brand accuracy | 9 | as round 3 |
| Sound sync | 8 | grid_check 40/40, 10/10; final mix at -14.7 LUFS integrated, LRA 0.5 LU |

Three biggest problems:
1. [t=12-14] counter digits ghosted by subframe averaging (also latent in the URL typing at 19.0-19.75).
2. [t=16-18] the empty lower 40% of 9:16 (carried).
3. placeholder score (carried).

Fixes applied: counter value and typed-character count keyed to the frame index (Math.floor(t*FPS)/FPS) so all subframes of a frame agree; both finals re-rendered and the determinism check re-run (round 5 below).

## Round 5 — 2026-10-22 01:29 — on the re-rendered FINAL files: out/final/{contact,phone,strip@13.2}.png (9:16) and out/finalw/{contact,strip@19.1}.png (16:9)
Second final render (patched renderer: clip screenshots, ffmpeg killed on error): 9x16 775 s, 16x9 920 s, two in
parallel; determinism_check.sh index.html 20: 1200 frames identical (second time). ffprobe: h264 yuv420p, 60 fps,
aac; both mixes -14.7 LUFS integrated. The first attempt at this re-render stalled at 1 s in all three Chromiums
(Playwright "waiting for element to be stable" timeout at load average 19) and hung; see the skill STATUS, item 13.
| Axis | Score | Evidence (timestamp) |
|------|-------|----------------------|
| Hook in first 2s | 8 | poster.png at 1.75 s |
| Readability at 360 px | 8 | phone.png: every word reads |
| Motion quality (springs, no dead frames) | 8 | strip@13.2: 53 → 67 % in twelve frames, every digit crisp; strip@19.1: characters land clean; no jumps |
| Variety (new thing every 2-4s) | 8 | as round 3 |
| Composition | 8 | as round 3 |
| Brand accuracy | 9 | as round 3 |
| Sound sync | 8 | grid_check 40/40 cues, 10/10 cuts; final mixes exist and measure -14.7 LUFS |

Shipped with these scores. Three things to improve next: a written score (melody, riser into the strike, stop
before the logo) instead of the placeholder bed; the 9:16 lockup's empty lower 40% at 16-18 s; a tighter two-panel
assemble shot for phones.
