# OVERFIT backlog

Ordered roughly by value. Move items to "Done" with the date when shipped.

## Now
- [ ] Decide public hosting (GitHub Pages needs a public repo or Pro; itch.io accepts `dist-single/index.html`). Needs the owner's approval.

## Next
- [ ] Surge-arrow placement can overlap the F5–F8 protocol bar (upper-right sources).
- [ ] Grid shader: ruins/water inside the Grid now get a faint stain (review note, low severity) — mask by terrain if it bothers anyone.
- [ ] Real-user playtest notes → tuning pass (bot balance: Veteran ≈50% bot win rate with 45-min cap; humans may find Surge 1 too easy or too hard).
- [ ] Hacking UX: mark the robot a Netrunner is channelling on; teach "EMP first, then hack" in Op 2; consider auto-hack toggle.
- [ ] Scrap planning: show remaining scrap per field (tooltip / minimap brightness); near-base fields run dry around minute 12–15.
- [ ] Salvage Rights (Op 2): "hack 3 robots" can stall if patrols die to friendly fire — guarantee stunned targets or count Override hacks.
- [ ] E2E in CI (needs Chrome on the runner + WebGL; currently local-only via `npm run test:e2e`).
- [ ] Save/resume for long Endless runs.

## Later / ideas
- [ ] "AXIOM remembers you": carry a fraction of the last Endless run's adaptations into the next (research suggestion).
- [ ] Shareable swarm seeds (challenge a friend with your trained AXIOM).
- [ ] Touch controls / tablet layout.
- [ ] Colourblind-safe team palette option.
- [ ] Steam-style achievements (local).

## Done
- 2026-10-15 v1.0: full game (sim, renderer, procedural art, synthesised audio, HUD, 5-mission campaign, skirmish, Endless + daily), bot + headless soak, E2E suites, review-driven fixes.
- 2026-10-21 GitHub repo + CI; project memory (`CLAUDE.md`).
- 2026-10-21 GPU/power pass: single-pass Grid shader, own 60 fps frame limiter (30 in menus/idle), render-scale setting (auto 1.5×) + adaptive guard, no backdrop-filter, throttled HUD writes, fog upload on change, audio suspended in background tabs, retina screen-size bug fixed. GPU ≈55% → ≈5–14% (see `docs/perf-after-2026-10-21.txt`).
- 2026-10-21 itch.io upload prep (not published): `npm run release:itch` → `release/overfit-itch.zip`, absolute share-card URLs from `VITE_PUBLIC_URL` (`.env`), "desktop only" notice for touch-only devices.
