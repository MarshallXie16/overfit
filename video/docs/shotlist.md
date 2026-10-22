# Shot list — OVERFIT intro

Format(s): 9:16 (1080x1920) and 16:9 (1920x1080) from one timeline   Duration: 20 s   Grid: 120 BPM synthetic (`beats.py --bpm 120 --dur 20`), beat = 0.5 s, cuts on downbeats (2 s)
Logline: a free browser RTS whose enemy learns how you fight; by the end you want to click Deploy.
Reference grammar: docs/style_guide.md ("Linear launch film": black canvas, one teal accent, left-anchored spring type, real UI assembling, cuts on downbeats)
Defaults chosen (unattended run): 20 s, 9:16 + 16:9, 120 BPM synthesized score in A minor, SFX from `cues.json`, style 1 of 2 proposed.

| # | Beat | Time | What happens on screen | Camera | Text on screen | SFX | Spring preset |
|---|------|------|------------------------|--------|----------------|-----|---------------|
| 1 | 0 | 0.0 | HOOK. Frame 1 is the swarm (og.png right crop, lasers + explosions). Three words slam in one per beat: THE SWARM (0.0), LEARNS (0.5), YOU. (1.0); teal underline draws at 1.5 | slow push-in 1.0→1.08 over the bar | THE SWARM / LEARNS / YOU. | thump 0.0, thump 0.5, thump 1.0, tick 1.5 | heavy (type), default (push) |
| 2 | 4 | 2.0 | ASSEMBLE. Hard cut to the Surge 3 battle crop (game-40) scaling 1.12→1.0; HUD panels spring in from their edges on each beat: topbar (2.0), AXIOM MODEL + objectives (2.5), minimap + Engineer panel (3.0), command card + protocols (3.5) | settle | A BROWSER RTS. (small, top-left, 2.0) | whoosh 2.0, pop 2.5, pop 3.0, pop 3.5 | default |
| 3 | 8 | 4.0 | FEATURE 1: OVERFIT. Camera pushes into the AXIOM MODEL panel until it fills the width; at 4.5 the panel swaps epoch 0 → epoch 8 (KINETIC x0.55 … EXPLOSIVE x1.36) behind a 3 px blur; headline at 5.0, sub at 5.5 | push-in, track() | IT LEARNS HOW YOU FIGHT. / Every epoch AXIOM retrains on the damage that hurt it. | whoosh 4.0, pop 4.5, thump 5.0, tick 5.5 | default |
| 4 | 12 | 6.0 | FEATURE 2: THE SWARM GROWS. Three real surge screens, one per beat, each a bigger crowd: Surge 2 (24 machines) 6.0, Surge 3 (49) 6.5, Cascade 4 (71 + Colossus) 7.0; each brings its real announcement crop; THREAT pips crop grows; headline at 7.5 | each cut lands pushed-in 1.1, settles | SURGE 2 · 24 / SURGE 3 · 49 / CASCADE 4 · 71 (real crops) / EVERY SURGE IS BIGGER. | thump 6.0, thump 6.5, thump 7.0, tick 7.5 | default, snappy on the pips |
| 5 | 16 | 8.0 | FEATURE 3: STRIKE BACK, cursor-driven. Engineer panel + build card spring in (8.0); cursor glides to T (turret) and clicks (8.5, teal ring on the real button); protocols bar springs in big (9.0); cursor clicks F7 ORBITAL STRIKE (9.5) | static, cursor moves | BUILD. (8.0) / CALL THE STRIKE. (9.0) | pop 8.0, click 8.5, pop 9.0, click 9.5 | default (panels), snappy (cursor, ring) |
| 6 | 20 | 10.0 | THE STRIKE LANDS. Hard cut to the explosion crop (game-40 centre) at 1.3 zoom with a 3-frame shake; headline slams 10.0; second line 11.0 | 1.3 → 1.15 settle | STRIKE BACK. / HACK ITS MACHINES. MAKE IT FORGET. | thump 10.0, whoosh 10.0, tick 11.0 | heavy (type) |
| 7 | 24 | 12.0 | METRIC. Mono counter 0 → 100 on the beats (12.0 → 13.5), "% PROCEDURAL"; three facts tick in under it | static | 100% PROCEDURAL / 0 asset files · every sprite drawn in code · every sound synthesised · nothing to download | tick 12.0, tick 12.5, tick 13.0, pop 13.5 | snappy (counter), default |
| 8 | 28 | 14.0 | MODES. The three real title-menu buttons spring in staggered: CAMPAIGN (14.0), SKIRMISH (14.5), ENDLESS SWARM · Daily #22 (15.0); cursor hovers CAMPAIGN at 15.5 | static | THREE WAYS TO LOSE TO A MACHINE. (14.0, small) | pop 14.0, pop 14.5, pop 15.0, tick 15.5 | default, snappy (hover) |
| 9 | 32 | 16.0 | LOGO. The diamond mark springs in (heavy) 16.0, the real OVERFIT wordmark 16.5, tagline 17.0; everything else gone | static | OVERFIT (wordmark crop) / THE SWARM LEARNS YOU. | thump 16.0, whoosh 16.5, tick 17.0 | heavy |
| 10 | 36 | 18.0 | CTA. The real briefing DEPLOY button springs in under the lockup (18.0); cursor arrives and clicks it (18.5, teal ring); URL types out in mono (19.0-19.75); hold | static | PLAY FREE IN YOUR BROWSER / marshallxie16.github.io/overfit | pop 18.0, click 18.5, tick 19.0, tick 19.5 | default, snappy (click) |

Loop: no. Last frame holds the lockup + URL.
Per-format layout: 9:16 puts type in the top third and UI in the lower two thirds; 16:9 puts type on the left 45% and UI on the right. Same timeline, laid out from `L`.
Open questions for the user: none blocking. Proceeded unattended (logged in docs/review_log.md).
