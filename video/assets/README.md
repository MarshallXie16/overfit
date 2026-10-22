# Assets — captured from the live build (2026-10-22)

Source: https://marshallxie16.github.io/overfit/ via `scripts/capture_assets.mjs` (Playwright, system
Chrome, 1920x1080 CSS px at 2x → 3840x2160 PNGs; HUD crops are element screenshots at 2x). The
skirmish was `?quick=1&seed=7` fast-forwarded with the game's own bot (level 2) on the human side,
so every screen is a real game state. Audio muted, edge-scroll off, render scale "sharp".

| File | What it is | Used for |
|------|-----------|----------|
| `title-demo.png` | the title-screen attract demo with the menu hidden: the red Grid, the AXIOM Core, relays, robots (3840x2160) | hook (0-2 s) |
| `game-30-fight-z13.png` | Surge 2, 24 machines, tesla-coil chokepoint, HUD on | assemble shot map band, surge escalation 1, its red alert row |
| `game-40-fight-z13.png` | Surge 3, 49 machines, explosion + lightning, Dr. Okafor radio line | surge escalation 2, its alert row, the strike shot |
| `game-50-fight-z09.png` | Cascade 4 (71 machines + a Colossus), big base, 11:09 | surge escalation 3, its alert row |
| `hud-model-epoch0.png` / `hud-model-50.png` | AXIOM MODEL panel at epoch 0 (all x1.00) and epoch 8 (KINETIC x0.55, ENERGY x0.76, EXPLOSIVE x1.36) | assemble shot, feature 1 swap |
| `hud-topbar-30/40/50.png` | top bar at three stages; the film crops the SURGE box + THREAT pips | assemble shot, surge escalation |
| `hud-minimap-50.png`, `hud-selpanel-engineer.png`, `hud-cmdcard-build.png`, `hud-protocols-50.png` | minimap, Engineer panel, build menu (cursor clicks T), Commander Protocols (cursor clicks F7) | assemble shot, feature 3 |
| `ui-title-menu.png` | CAMPAIGN / SKIRMISH / ENDLESS SWARM buttons | modes shot |
| `ui-dialog-briefing.png` | Operation 1 briefing; the film crops its DEPLOY button | CTA click |
| `logo.svg` | the favicon, verbatim from the game's `index.html` (red diamond, teal core); the film draws the same path | logo mark |
| `fonts/` | Chakra Petch 600/700, JetBrains Mono 400/600 (OFL, from the game's @fontsource packages) | all type |

The wordmark is set live in Chakra Petch 700 with the game's 18 px/92 px tracking (`.logo` in `src/ui/style.css`);
the element crop of it was clipped by the letter-spacing, so it is not used. Captures the film does not use
were deleted to keep the repo small; `scripts/capture_assets.mjs` regenerates all of them (about 60 files).

Colours and fonts: see `docs/style_guide.md`. Nothing in the film is redrawn from memory; every UI
element is one of these crops.
