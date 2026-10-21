# OVERFIT — Development Memory

## Project overview
Browser RTS (desktop, mouse + keyboard). The last human resistance cell vs **AXIOM**, a robot swarm that grows across a procedural ruined city and **retrains on the damage it takes** (the *Overfit* system). All art is procedural Canvas2D, all audio is synthesised WebAudio — no asset files, no runtime downloads. Design: `docs/GDD.md`. Contracts: `docs/ARCHITECTURE.md`. Story: `docs/STORY.md`. Market research: `docs/research.md`. Open work: `backlog.md`.

## Tech stack
- TypeScript 7 (native `tsc`), strict + `erasableSyntaxOnly` → **no enums, namespaces or constructor parameter properties**; extensionless imports.
- Vite 8, PixiJS 8.22 (WebGL), Vitest 5, tsx for Node tooling, Playwright (driving **system Chrome** via `channel: 'chrome'`; the bundled browsers are not installed).
- Fonts: `@fontsource` Chakra Petch + JetBrains Mono (OFL), injected as woff2 URLs in `main.ts`.
- ~21k lines of TS. Node ≥ 22 (CI uses 24; local is 26).

## Directory structure
```
src/sim/        deterministic 20 Hz simulation — NO DOM, NO pixi, NO Math.random/Date (use w.rng)
  world.ts      Entity/World/HumanState/AxiomState, Command type, DIFF table
  step.ts       tick order + movement integration + win/lose rules
  systems/      units (orders, movement, ECON), combat, economy, commands, field (creep, vision, flow fields), query
  ai/axiom.ts   AXIOM director: compute economy, garrisons, expansion, raids, surges, Overfit training (AXIOM_BAL)
  path/         A*, flow fields (siege mode), spatial hash — 31 tests
  data/defs.ts  all unit/building/research/protocol stats (GDD tables mirror these)
  mapgen.ts     seeded city generator (+ MapGenOptions for missions)
  bot.ts        scripted player (BOT_LEVELS 0–2) — soak tests + title-screen attract demo
src/render/     Pixi renderer (renderer.ts), particles (fx.ts), atlas packing (textures.ts)
  art/          procedural sprite atlas + terrain (247 keys; contract in ARCHITECTURE.md)
src/audio/      AudioEngine singleton `audio` (SFX bank pre-rendered at init, adaptive 4-layer music)
src/input/      controller.ts — camera, selection, command modes, control groups
src/ui/         hud.ts (DOM HUD), menus.ts (all overlays), style.css
src/game/       session.ts (frame loop), campaign.ts (5 missions), missions.ts (helpers), advisor.ts, storage.ts
tools/          headless.ts, campaign-check.ts, e2e.mjs, menus-e2e.mjs, perfprobe.mjs, perf.mjs, shot.mjs, make-artifact.mjs
tests/          path.test.ts, sim.test.ts (73 tests)
```

## Critical knowledge (hard-won — do not regress)
1. **Sim/render split.** `src/sim` must stay deterministic and DOM-free; the renderer/HUD only *read* world state. Player input becomes `Command`s queued on `w.commands` and applied at the next tick — the bot and tests use the same path.
2. **Events are per frame, not per tick.** The session drains `w.events` once per rendered frame (up to 6 sim ticks). Mission scripts that react to events must mark them (`fresh()` in campaign.ts) to avoid double-handling.
3. **Ownership of keyboard input.** Menus own the keyboard while any overlay is open: `Menus.show()` disables the Controller (`ctl.enabled=false`), `Menus.close()` re-enables it and removes the overlay's single key handler (`setKey`). Never add raw `window.addEventListener('keydown')` in menus.
4. **CSP.** The game is also published inside a CSP-locked iframe (no eval). `main.ts` imports `pixi.js/unsafe-eval` first — keep it, and verify any custom shader/uniform code under a strict CSP (see "Artifact build").
5. **Textures.** Atlas frames are shared — never `destroy({texture:true})` a sprite using an atlas frame. Per-session canvas textures go through `GameRenderer.canvasTex()` and are destroyed in `clear()`. `TextureBank` pads frames by 12 px for mipmaps; tiling patterns (`fx:creep_pattern`) are uploaded standalone with `addressMode: 'repeat'`.
6. **GPU budget.** Measured 2026-10-21 (`docs/perf-baseline-2026-10-21.txt`): full-screen passes dominate, not unit counts. Avoid masks/filters/render-to-texture on map-sized objects, CSS `backdrop-filter` over the canvas, and uncapped frame rates (ProMotion = 120 Hz). Measure with `tools/perfprobe.mjs` (serially — never while other GPU work runs).
7. **Fog of war.** Enemy structures under fog keep their last-seen state (`GameRenderer.seen`, `View.live`); don't show live HP/aim for fogged enemies.
8. **Balance lives in data.** Stats in `defs.ts`, AXIOM economy in `AXIOM_BAL`, difficulty in `DIFF`, harvest in `ECON`, bot in `BOT_LEVELS`. Tune with `tools/headless.ts --set PATH=VALUE` before editing, and keep `docs/GDD.md` tables in sync.
9. **Vite HMR reloads the page** when any file changes — browser tests against the dev server get reset if files are edited mid-run. For long/perf tests, `npx vite build` and serve with `npx vite preview --port 4174`.
10. **Robots and walls.** Robots route around short walls and breach full rings via the `siege` flow field (structure tiles cost 10); only Sappers target walls deliberately.

## Commands
```bash
npm run dev            # http://127.0.0.1:5173 (?quick=1&seed=7 → skirmish; ?mission=first-light|salvage-rights|learning-curve|server-farm|hard-reset)
npm run typecheck && npm test
npm run test:campaign  # all 5 missions: soak + scripted win paths
npm run test:soak      # strict headless bot-vs-AXIOM soak (fails on invariant errors)
npm run ci             # everything CI runs
npm run test:e2e       # Playwright UI suites (needs the dev server on 5173)
npx tsx tools/headless.ts --seeds 10 --minutes 40 --size 80,96,128 --diff recruit,veteran,nightmare --level 2 --jobs 10 --quiet   # balance matrix
node tools/perfprobe.mjs http://127.0.0.1:4174/ --only=early --reps=2 --window=10 --cases=base,no-creep,res-1x   # GPU/CPU power probe
npm run build          # typecheck + dist/
npm run build:artifact # single-file build → artifact/overfit.html (CSP-safe page for claude.ai artifacts)
```
Debug handles in the browser console: `window.overfit` (App: `.session.world`, `.session.r`, `.app`), `window.overfitDebug` (`Bot`, `step`).

## Git / deployment
- Repo: github.com/MarshallXie16/overfit (**private**, personal account). Push via SSH alias `github.com-personal`; for `gh` API calls set `GH_TOKEN=$(gh auth token -h github.com -u MarshallXie16)`. Repo-local git identity is `Marshall Xie <marshallxie16@gmail.com>` — never commit with the work identity.
- CI: `.github/workflows/ci.yml` (typecheck, tests, campaign, strict soak, builds).
- Published build: private claude.ai artifact https://claude.ai/artifact/1oCHLkNNh3XxKGmfMQFhDX — republish `artifact/overfit.html` after `npm run build:artifact`. Public hosting (GitHub Pages / itch.io) has **not** been approved yet — ask first.
