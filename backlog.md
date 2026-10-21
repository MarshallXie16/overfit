# OVERFIT backlog

Ordered roughly by value. Move items to "Done" with the date when shipped.

## Now
- [ ] **GPU/power pass** (in progress 2026-10-21): single-pass Grid shader, render-scale + frame-rate-cap settings, 30 fps while in menus/paused, no `backdrop-filter`, audio suspended in background tabs. Re-measure with `tools/perfprobe.mjs` against `docs/perf-baseline-2026-10-21.txt`.
- [ ] Decide public hosting (GitHub Pages needs a public repo or Pro; itch.io accepts `dist-single/index.html`). Needs the owner's approval.

## Next
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
