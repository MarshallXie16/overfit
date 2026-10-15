# OVERFIT — Technical Architecture

Stack: **TypeScript (strict, `erasableSyntaxOnly` → no enums/namespaces/param-properties), Vite, PixiJS v8, Vitest.** No other runtime deps. Imports are extensionless (`import { x } from './foo'`).

## Layering (strict)

```
src/sim/      Pure deterministic simulation. NO DOM, NO pixi, NO Math.random (use world.rng).
  data/       Unit/building/robot/research definitions (tables).
  path/       Pathfinding: A*, flow fields, spatial hash, line-walk checks.
  systems/    Tick systems (movement, combat, economy, production, creep, vision...).
  ai/         AXIOM director (economy, expansion, raids, surges, Overfit adaptation).
  world.ts    World state + entity store + event queue.
src/render/   PixiJS rendering. Reads world, never mutates sim state.
  art/        Procedural sprite generation (Canvas2D only, no pixi import).
src/audio/    WebAudio synthesis. Consumes sim events.
src/input/    Camera, selection, command issuing (produces Commands).
src/ui/       DOM HUD/menus (HTML/CSS over the canvas).
src/game/     Session setup: modes, map generation, campaign scripts, save/settings.
tools/        headless.ts — run the sim without rendering (bot player, balance, soak tests).
tests/        Vitest.
```

## Units of measure

- World coordinates are **tiles** (floats). Tile `(tx,ty)` spans `[tx,tx+1)×[ty,ty+1)`; centre is `tx+0.5`.
- Render base scale `TILE_PX = 32` px per tile. Art is authored at **2×** (64 px per tile) and displayed at 0.5 scale for crisp zoom.
- Angles in radians, 0 = +x (east), y grows downward (screen space). Sprites are drawn facing **east**.
- Sim tick: **20 Hz** fixed (`DT = 0.05 s`). Render interpolates `px,py → x,y`.

## Map passability contract (`src/sim/path`)

```ts
// Walk codes per tile (Uint8Array, row-major idx = ty*w + tx)
export const WALK_BLOCKED = 0;   // terrain: water, ruins, map edge — never walkable
export const WALK_OPEN = 1;      // normal
export const WALK_SLOW = 2;      // rubble: walkable, path cost 1.6, speed ×0.7
export const WALK_STRUCTURE = 3; // occupied by a building: blocked for normal paths; in 'siege' flow fields it is a GOAL-adjacent cost tile (see FlowField)

export interface PathGrid { w: number; h: number; walk: Uint8Array; version: number /* bump when walk changes */ }
```

APIs (owned by the pathing module):

```ts
findPath(grid, sx, sy, gx, gy, opts?: { maxExpand?: number }): Array<{x:number,y:number}> | null
  // inputs: float world coords. 8-dir A*, octile heuristic, NO corner cutting, WALK_SLOW cost 1.6.
  // If goal tile is not walkable, target the nearest walkable tile to the goal (BFS ring search).
  // If unreachable, return a path to the reachable tile closest to the goal (by heuristic) — never null unless start itself is enclosed.
  // Returns waypoints at tile centres, string-pulled with lineWalkable() (first waypoint is NOT the start), final point = exact goal if goal tile walkable.
lineWalkable(grid, x0, y0, x1, y1, radius?): boolean    // supercover; true if every touched tile is WALK_OPEN/WALK_SLOW
nearestWalkable(grid, tx, ty, maxR?): {tx,ty} | null
class FlowField {
  constructor(w, h)
  build(grid, goals: number[] /* tile indices */, mode: 'normal' | 'siege'): void
  // Dijkstra from all goals. 'siege': WALK_STRUCTURE tiles get traversal cost SIEGE_COST (=10) instead of blocked,
  // so robots path *through* walls when the detour is long (they stop and attack the structure in front of them).
  dist: Float32Array                     // integrated cost, Infinity if unreachable
  dirX: Float32Array; dirY: Float32Array // unit vector toward the best neighbour (0,0 at goals/unreachable)
  sample(x, y): {dx, dy, dist}           // float world coords, no allocation (returns shared object)
}
class SpatialHash {
  constructor(w, h, cellSize = 2)
  clear(); insert(id, x, y); queryRadius(x, y, r, out: number[]): number   // fills out[] with ids, returns count (candidates in overlapping cells; caller does exact distance check)
}
```

## Entity model (`src/sim/world.ts`)

A single `Entity` class with optional fields (simple > clever). Kinds are string ids from data tables (`'rifleman'`, `'skitter'`, `'hq'`, `'relay'`, `'scrap'`, `'wreck'` …). Teams: `0` neutral, `1` human, `2` AXIOM. `entity.hacked` marks a converted robot (team 1, robot kind).

The sim emits **events** into `world.events` (array cleared by the frame loop after render+audio consume them). Event shape: `{ t: string; x: number; y: number; ... }`. Core event names:

```
shot {kind:'kinetic'|'energy'|'explosive', from:id, x,y, tx,ty, weapon}   arc {points:[x,y,...]}
proj_launch / proj_hit {x,y,radius}       death {id, kind, team, x,y, big:boolean}
build_place / build_done {kind}           unit_ready {kind}       research_done {id}
hack_start / hack_done / hack_revert {id} emp {x,y,r}  orbital_warn / orbital {x,y,r}
surge_warn / surge_start {n, cascade}     epoch {type, resist}    forgetting {}
alert {msg, x, y, level}                  harvest {x,y}           brownout {on}
radio {speaker, text}                     objective {...}         victory / defeat
```

## Art contract (`src/render/art`)

Pure Canvas2D. Entry: `buildArtAtlas(): ArtAtlas` returning canvases keyed by string. Renderer converts to Pixi textures.

```
unit:<kind>:<team>:<frame>     body, facing east, frame 0..N-1 (walk/idle cycle)
unit:<kind>:<team>:turret      separate turret for vehicles/turrets, facing east (pivot = canvas centre)
bld:<kind>:<team>              building, top-down, canvas = footprint×64 px (may include ≤16 px overhang/shadow; anchor centre)
bld:<kind>:<team>:turret       turret head (gun_turret, tesla, missile, lancet)
fx:<name>:<frame>              effects
icon:<kind>                    96×96 UI icon
res:scrap:<v>, wreck:<size>:<v>, decal:scorch:<v>
team ∈ human | axiom | hacked
```

## Audio contract (`src/audio`)

`AudioEngine` with `init()` (user gesture), `play(name, {x,y,vol})`, `setListener(x,y,zoom)`, `setIntensity(0..1)`, `music(track)`, volume setters. Internally rate-limits and voice-caps.

## Determinism & testing

- `world.rng` is a seeded PRNG (mulberry32). Sim never reads wall-clock time.
- Player input → `Command` objects queued and applied at the start of the next tick → same interface for the headless bot.
- `tools/headless.ts` runs N minutes of game time with a scripted bot and reports outcomes, perf (ms/tick), and invariants (no NaN positions, no units inside blocked tiles for >2 s, entity counts sane).
