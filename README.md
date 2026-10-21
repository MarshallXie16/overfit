# OVERFIT — *the swarm learns you*

A browser real-time strategy game about an AI apocalypse. You command the last human resistance cell against **AXIOM**, a rogue logistics optimiser whose robot swarm grows, spreads across the city, and **retrains on how you fight**.

Instant play, no install, no downloads at runtime: every sprite is drawn procedurally with Canvas2D and every sound is synthesised with WebAudio.

## Signature mechanics

- **Overfit** — every epoch AXIOM trains on the damage type that hurt it most and becomes resistant to it… but each adaptation opens a weakness (Kinetic → weak to Energy → weak to Explosive → weak to Kinetic). The AXIOM MODEL panel shows what it is learning *right now*.
- **Catastrophic Forgetting** — destroy Data Vaults to halve everything it has learned.
- **Hacking** — Netrunners turn weakened or EMP-stunned robots to your side. If the Netrunner dies, its robots revert.
- **An ever-growing swarm** — AXIOM has a real economy: Compute from territory (the red Grid), Relays, Fabricators and captured Server Farms. Surges get bigger every time; every 4th is a Cascade led by a Colossus.
- **Salvage economy** — Engineers harvest scrap piles and the wrecks of everything you kill; kills earn Data for research and Commander Protocols (Supply Drop, EMP Burst, Orbital Strike, Override).

## Modes

- **Campaign** — five scripted operations that teach every mechanic.
- **Skirmish** — procedural ruined city (seeded), destroy the AXIOM Core.
- **Endless Swarm** — survive as long as you can; **Daily Challenge** with a shareable result card.

## Controls

| Action | Input |
| --- | --- |
| Select / box select | Left click / drag · Shift adds · double-click selects a type |
| Smart command | Right click (move, attack, harvest, build, repair, hack, rally) |
| Attack-move / Stop / Hold / Hack | `A` / `S` / `H` / `K` · Shift queues |
| Build menu | Engineer selected → `B`, then the building key; drag to draw walls |
| Control groups | `Ctrl+1–9` set, `1–9` select (double-tap centres) |
| Camera | Arrow keys, screen edge, middle-drag, wheel zoom, minimap |
| Idle Engineer / Last alert / Base / Army | `.` / `Space` / `Home` / `F2` |
| Commander Protocols | `F5`–`F8` |
| Tactical pause / Menu | `P` / `Esc` |

## Development

```bash
npm install
npm run dev            # http://127.0.0.1:5173  (?quick=1 → skirmish, ?mission=first-light → Operation 1)
npm run ci             # typecheck, unit/sim tests, campaign checks, strict headless soak, build
npm run test:e2e       # Playwright UI suites against the dev server (uses system Chrome)
npm run build          # typecheck + production build to dist/
npm run build:artifact # single self-contained HTML (CSP-safe) → artifact/overfit.html
```

Agent/dev handbook: `CLAUDE.md` (architecture invariants, commands, gotchas). Open work: `backlog.md`. CI runs on every push (`.github/workflows/ci.yml`).

### Architecture

```
src/sim/      deterministic 20 Hz simulation (no DOM): units, combat, economy, AXIOM AI, Overfit, mapgen, bot
  path/       A*, flow fields (siege mode routes through walls), spatial hash
src/render/   PixiJS v8 renderer, particle FX, texture packing; art/ = procedural Canvas2D sprites & terrain
src/audio/    WebAudio synthesis: rate-limited SFX bus + adaptive layered music
src/input/    camera, selection, command modes
src/ui/       DOM HUD, menus
src/game/     session loop, campaign scripts, advisor, storage
```

See `docs/GDD.md` (design), `docs/ARCHITECTURE.md` (technical contracts), `docs/STORY.md` (narrative) and `docs/research.md` (market research).

## Credits

Design, code, art and audio generated end-to-end by Claude (Anthropic) agents. Fonts: Chakra Petch and JetBrains Mono (SIL Open Font License). Engine: PixiJS (MIT).
