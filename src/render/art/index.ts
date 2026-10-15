// OVERFIT procedural art atlas. Pure Canvas2D (no pixi). See docs/ARCHITECTURE.md "Art contract".
//
// Conventions: authored at 64 px per tile (renderer displays at 0.5x). Sprites face EAST, pivot = canvas centre.
// Rotating sprites (unit bodies, unit turrets, building turret heads) carry no baked directional shadow;
// static sprites (buildings, walls, scrap, wrecks, decals, icons) have shadows cast toward the bottom-right.
import { AXIOM_PAL, HACKED_PAL, robotPal, type TeamPal } from './palette';
import { renderSprite, BLD_SHADOW, type Layers, type SpriteOpts } from './sprite';
import { ctxOf, makeCanvas } from './util';
import {
  INFANTRY, INF_CANVAS, drawInfantryKind, drawBulldog, drawBulldogTurret, drawVolt, drawVoltTurret, drawThumper, drawThumperTurret, VEHICLE_CANVAS,
} from './units_human';
import {
  ROBOT_CANVAS, drawSkitter, drawGunner, drawSapper, drawBrute, drawLancer, drawWasp, drawWaspShadow, drawWarden, drawColossus,
} from './units_robot';
import { HUMAN_BUILDINGS, HUMAN_TURRETS, drawWall } from './buildings_human';
import { AXIOM_BUILDINGS, drawLancetHead, drawServerFarm } from './buildings_axiom';
import { buildFx } from './fx';
import { canvasIcon, commandIcons, researchIcons, spriteIcon } from './icons';

export { renderTerrainChunk, renderMinimapTerrain, TERRAIN } from './terrain';
export type { TerrainMap } from './terrain';

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
export const HUMAN_BUILDING_KINDS = ['hq', 'generator', 'habitat', 'depot', 'barracks', 'factory', 'lab', 'wall', 'gun_turret', 'tesla', 'missile', 'sensor'] as const;
export const AXIOM_BUILDING_KINDS = ['core', 'fabricator', 'relay', 'vault', 'lancet'] as const;
export const TURRET_BUILDINGS = ['gun_turret', 'tesla', 'missile', 'lancet'] as const;

/** Number of animation frames per unit kind (key suffix 0..n-1). */
export const UNIT_FRAMES: Record<string, number> = {
  engineer: 4, rifleman: 4, arc_trooper: 4, rocketeer: 4, netrunner: 4, ranger: 4,
  bulldog: 2, volt: 2, thumper: 2,
  skitter: 4, gunner: 4, sapper: 4, brute: 4, lancer: 4, wasp: 2, warden: 4, colossus: 4,
};

/** Footprint size in tiles for every building kind. */
export const BUILDING_SIZE: Record<string, number> = {
  hq: 4, generator: 2, habitat: 2, depot: 2, barracks: 3, factory: 3, lab: 3, wall: 1, gun_turret: 2, tesla: 2, missile: 2, sensor: 2,
  core: 5, fabricator: 3, relay: 2, vault: 3, lancet: 2, server_farm: 3,
};

type RobotDraw = (L: Layers, pal: TeamPal, f: number) => void;
const ROBOT_DRAW: Record<string, RobotDraw> = {
  skitter: drawSkitter, gunner: drawGunner, sapper: drawSapper, brute: drawBrute,
  lancer: drawLancer, wasp: drawWasp, warden: drawWarden, colossus: drawColossus,
};

const VEH: Record<string, [(L: Layers, f: number) => void, (L: Layers) => void]> = {
  bulldog: [drawBulldog, drawBulldogTurret],
  volt: [drawVolt, (L) => drawVoltTurret(L, 0)],
  thumper: [drawThumper, drawThumperTurret],
};

// Rotating sprites: no baked directional shadow (the renderer draws a dynamic one).
const ROT: SpriteOpts = { shadow: null };
const BLD: SpriteOpts = { shadow: BLD_SHADOW, mid: true };

class Atlas implements ArtAtlas {
  private map = new Map<string, HTMLCanvasElement>();
  private metas = new Map<string, ArtMeta>();
  genMs = 0;
  stageMs: Record<string, number> = {};
  add = (key: string, c: HTMLCanvasElement, anchorX = 0.5, anchorY = 0.5): void => {
    this.map.set(key, c);
    if (anchorX !== 0.5 || anchorY !== 0.5) this.metas.set(key, { w: c.width, h: c.height, anchorX, anchorY });
  };
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
  for (const kind of HUMAN_VEHICLES) {
    const sz = VEHICLE_CANVAS[kind];
    const [body, turret] = VEH[kind];
    for (let f = 0; f < 2; f++) A.add(`unit:${kind}:human:${f}`, renderSprite(sz, sz, (L) => body(L, f), ROT));
    A.add(`unit:${kind}:human:turret`, renderSprite(sz, sz, turret, ROT));
  }
  for (const kind of ROBOTS) {
    const sz = ROBOT_CANVAS[kind];
    const n = UNIT_FRAMES[kind];
    for (const team of ['axiom', 'hacked']) {
      const pal = robotPal(team);
      for (let f = 0; f < n; f++) A.add(`unit:${kind}:${team}:${f}`, renderSprite(sz, sz, (L) => ROBOT_DRAW[kind](L, pal, f), ROT));
    }
  }
  A.add('unit:wasp:shadow', blurredShadow(renderSprite(72, 72, drawWaspShadow, { shadow: null, outline: 0 }), 2.5, 0.55));
  A.add('unit:colossus:shadow', blurredShadow(A.get('unit:colossus:axiom:0')!, 5, 0.5));
}

/** Black silhouette of `src`, softened; used as a ground-shadow key. */
function blurredShadow(src: HTMLCanvasElement, blur: number, alpha: number): HTMLCanvasElement {
  const W = src.width, H = src.height;
  const sil = makeCanvas(W, H);
  const sg = ctxOf(sil);
  sg.drawImage(src, 0, 0);
  sg.globalCompositeOperation = 'source-in';
  sg.fillStyle = '#000';
  sg.fillRect(0, 0, W, H);
  const out = makeCanvas(W, H);
  const g = ctxOf(out);
  g.shadowColor = `rgba(0,0,0,${alpha})`;
  g.shadowBlur = blur * 2;
  g.shadowOffsetX = W * 2;
  g.drawImage(sil, -W * 2, 0);
  return out;
}

function buildBuildings(A: Atlas): void {
  for (const [kind, { n, draw }] of Object.entries(HUMAN_BUILDINGS)) {
    const sz = n * 64 + 32;
    A.add(`bld:${kind}:human`, renderSprite(sz, sz, draw, BLD));
  }
  for (const [kind, { size, draw }] of Object.entries(HUMAN_TURRETS)) {
    A.add(`bld:${kind}:human:turret`, renderSprite(size, size, draw, ROT));
  }
  for (let mask = 0; mask < 16; mask++) {
    A.add(`bld:wall:human:${mask}`, renderSprite(96, 96, (L) => drawWall(L, mask), { shadow: { dx: 4, dy: 5, blur: 4, a: 0.55 }, outline: 0 }));
  }
  A.add('bld:wall:human', A.get('bld:wall:human:10')!);
  for (const [kind, { n, draw }] of Object.entries(AXIOM_BUILDINGS)) {
    const sz = n * 64 + 32;
    A.add(`bld:${kind}:axiom`, renderSprite(sz, sz, (L) => draw(L, AXIOM_PAL), BLD));
  }
  A.add('bld:lancet:hacked', renderSprite(160, 160, (L) => AXIOM_BUILDINGS.lancet.draw(L, HACKED_PAL), BLD));
  A.add('bld:lancet:axiom:turret', renderSprite(112, 112, (L) => drawLancetHead(L, AXIOM_PAL), ROT));
  A.add('bld:lancet:hacked:turret', renderSprite(112, 112, (L) => drawLancetHead(L, HACKED_PAL), ROT));
  for (const team of ['neutral', 'human', 'axiom']) {
    A.add(`bld:server_farm:${team}`, renderSprite(224, 224, (L) => drawServerFarm(L, team), BLD));
  }
}

const UNIT_ICON_SCALE: Record<string, number> = {
  engineer: 1.3, rifleman: 1.25, arc_trooper: 1.25, rocketeer: 1.25, netrunner: 1.25, ranger: 1.05,
  bulldog: 0.66, volt: 0.68, thumper: 0.6,
  skitter: 1.6, gunner: 1.2, sapper: 1.85, brute: 0.76, lancer: 0.92, wasp: 1.3, warden: 1.0, colossus: 0.36,
};

function compose(base: HTMLCanvasElement, head: HTMLCanvasElement, rot: number): HTMLCanvasElement {
  const c = makeCanvas(base.width, base.height);
  const g = ctxOf(c);
  g.drawImage(base, 0, 0);
  g.translate(base.width / 2, base.height / 2);
  g.rotate(rot);
  g.drawImage(head, -head.width / 2, -head.height / 2);
  return c;
}

function buildIcons(A: Atlas): void {
  const teal = '#2fd4c4';
  const red = '#ff2a4d';
  for (const kind of HUMAN_INFANTRY) {
    A.add(`icon:${kind}`, spriteIcon(teal, 'human', INF_CANVAS, UNIT_ICON_SCALE[kind], (L) => drawInfantryKind(kind, L, 0)));
  }
  for (const kind of HUMAN_VEHICLES) {
    const [body, turret] = VEH[kind];
    A.add(`icon:${kind}`, spriteIcon(teal, 'human', VEHICLE_CANVAS[kind], UNIT_ICON_SCALE[kind], (L) => { body(L, 0); turret(L); }));
  }
  for (const kind of ROBOTS) {
    A.add(`icon:${kind}`, spriteIcon(red, 'axiom', ROBOT_CANVAS[kind], UNIT_ICON_SCALE[kind], (L) => ROBOT_DRAW[kind](L, AXIOM_PAL, 1)));
  }
  for (const kind of HUMAN_BUILDING_KINDS) {
    let src = A.get(`bld:${kind}:human`)!;
    if (kind === 'wall') src = A.get('bld:wall:human:10')!;
    const head = A.get(`bld:${kind}:human:turret`);
    if (head) src = compose(src, head, -0.5);
    A.add(`icon:${kind}`, canvasIcon(teal, 'human', src, kind === 'wall' ? 110 : 86));
  }
  for (const kind of AXIOM_BUILDING_KINDS) {
    let src = A.get(`bld:${kind}:axiom`)!;
    const head = A.get(`bld:${kind}:axiom:turret`);
    if (head) src = compose(src, head, -0.5);
    A.add(`icon:${kind}`, canvasIcon(red, 'axiom', src, 86));
  }
  A.add('icon:server_farm', canvasIcon('#e8d9a0', 'neutral', A.get('bld:server_farm:neutral')!, 86));
  for (const [id, c] of Object.entries(researchIcons())) A.add(`icon:${id}`, c);
  for (const [id, c] of Object.entries(commandIcons())) A.add(`icon:${id}`, c);
  // protocol aliases (data ids in defs.ts)
  A.add('icon:supply', A.get('icon:proto_supply')!);
  A.add('icon:emp', A.get('icon:proto_emp')!);
  A.add('icon:orbital', A.get('icon:proto_orbital')!);
  A.add('icon:override', A.get('icon:proto_override')!);
}

let cached: Atlas | null = null;

/** Build (once) and return the art atlas. Subsequent calls return the cached atlas. */
export function buildArtAtlas(): ArtAtlas & { genMs: number; stageMs: Record<string, number> } {
  if (cached) return cached;
  const t0 = performance.now();
  const A = new Atlas();
  const stage = (name: string, fn: () => void) => {
    const t = performance.now();
    fn();
    A.stageMs[name] = Math.round(performance.now() - t);
  };
  stage('units', () => buildUnits(A));
  stage('buildings', () => buildBuildings(A));
  stage('fx', () => buildFx(A.add));
  stage('icons', () => buildIcons(A));
  A.genMs = performance.now() - t0;
  cached = A;
  return A;
}
