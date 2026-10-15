// OVERFIT procedural art atlas. Pure Canvas2D (no pixi). See docs/ARCHITECTURE.md "Art contract".
import { HUMAN_PAL, robotPal } from './palette';
import { renderSprite, type Layers, type SpriteOpts } from './sprite';
import {
  INFANTRY, INF_CANVAS, drawInfantryKind, drawBulldog, drawBulldogTurret, drawVolt, drawVoltTurret, drawThumper, drawThumperTurret, VEHICLE_CANVAS,
} from './units_human';
import {
  ROBOT_CANVAS, drawSkitter, drawGunner, drawSapper, drawBrute, drawLancer, drawWasp, drawWaspShadow, drawWarden, drawColossus,
} from './units_robot';
import type { TeamPal } from './palette';

export { renderTerrainChunk, renderMinimapTerrain, TERRAIN } from './terrain';

export const ART_TILE = 64; // authoring px per tile (renderer displays at 0.5x)

export interface ArtMeta {
  w: number;
  h: number;
  anchorX: number;
  anchorY: number;
}

export interface ArtAtlas {
  get(key: string): HTMLCanvasElement | undefined;
  keys(): string[];
  meta(key: string): ArtMeta;
}

export const HUMAN_INFANTRY = ['engineer', 'rifleman', 'arc_trooper', 'rocketeer', 'netrunner', 'ranger'] as const;
export const HUMAN_VEHICLES = ['bulldog', 'volt', 'thumper'] as const;
export const ROBOTS = ['skitter', 'gunner', 'sapper', 'brute', 'lancer', 'wasp', 'warden', 'colossus'] as const;

/** Number of animation frames per unit kind (key suffix 0..n-1). */
export const UNIT_FRAMES: Record<string, number> = {
  engineer: 4, rifleman: 4, arc_trooper: 4, rocketeer: 4, netrunner: 4, ranger: 4,
  bulldog: 2, volt: 2, thumper: 2,
  skitter: 4, gunner: 4, sapper: 4, brute: 4, lancer: 4, wasp: 2, warden: 4, colossus: 4,
};

type RobotDraw = (L: Layers, pal: TeamPal, f: number) => void;
const ROBOT_DRAW: Record<string, RobotDraw> = {
  skitter: drawSkitter, gunner: drawGunner, sapper: drawSapper, brute: drawBrute,
  lancer: drawLancer, wasp: drawWasp, warden: drawWarden, colossus: drawColossus,
};

// Rotating sprites: no baked directional shadow (the renderer draws a dynamic one).
const ROT: SpriteOpts = { shadow: null };

class Atlas implements ArtAtlas {
  private map = new Map<string, HTMLCanvasElement>();
  private metas = new Map<string, ArtMeta>();
  genMs = 0;
  add(key: string, c: HTMLCanvasElement, anchorX = 0.5, anchorY = 0.5): void {
    this.map.set(key, c);
    if (anchorX !== 0.5 || anchorY !== 0.5) this.metas.set(key, { w: c.width, h: c.height, anchorX, anchorY });
  }
  get(key: string): HTMLCanvasElement | undefined {
    return this.map.get(key);
  }
  keys(): string[] {
    return [...this.map.keys()];
  }
  meta(key: string): ArtMeta {
    const m = this.metas.get(key);
    if (m) return m;
    const c = this.map.get(key);
    return { w: c ? c.width : 0, h: c ? c.height : 0, anchorX: 0.5, anchorY: 0.5 };
  }
}

function buildUnits(A: Atlas): void {
  for (const kind of HUMAN_INFANTRY) {
    if (!INFANTRY[kind]) continue;
    for (let f = 0; f < 4; f++) A.add(`unit:${kind}:human:${f}`, renderSprite(INF_CANVAS, INF_CANVAS, (L) => drawInfantryKind(kind, L, f), ROT));
  }
  const veh: Record<string, [(L: Layers, f: number) => void, (L: Layers) => void]> = {
    bulldog: [drawBulldog, drawBulldogTurret],
    volt: [drawVolt, (L) => drawVoltTurret(L, 0)],
    thumper: [drawThumper, drawThumperTurret],
  };
  for (const kind of HUMAN_VEHICLES) {
    const sz = VEHICLE_CANVAS[kind];
    const [body, turret] = veh[kind];
    for (let f = 0; f < 2; f++) A.add(`unit:${kind}:human:${f}`, renderSprite(sz, sz, (L) => body(L, f), ROT));
    A.add(`unit:${kind}:human:turret`, renderSprite(sz, sz, turret, ROT));
  }
  void HUMAN_PAL;
  for (const kind of ROBOTS) {
    const sz = ROBOT_CANVAS[kind];
    const n = UNIT_FRAMES[kind];
    for (const team of ['axiom', 'hacked']) {
      const pal = robotPal(team);
      for (let f = 0; f < n; f++) A.add(`unit:${kind}:${team}:${f}`, renderSprite(sz, sz, (L) => ROBOT_DRAW[kind](L, pal, f), ROT));
    }
  }
  A.add('unit:wasp:shadow', renderSprite(72, 72, drawWaspShadow, { shadow: null, outline: 0 }));
}

let cached: Atlas | null = null;

/** Build (once) and return the art atlas. Subsequent calls return the cached atlas. */
export function buildArtAtlas(): ArtAtlas & { genMs: number } {
  if (cached) return cached;
  const t0 = performance.now();
  const A = new Atlas();
  buildUnits(A);
  A.genMs = performance.now() - t0;
  cached = A;
  return A;
}
