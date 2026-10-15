// Art preview page (art.html). Query: ?zoom=2  ?only=<prefix>  ?scene=0|1  ?ppt=32|64  ?light=1  ?sceneOnly=1
import { buildArtAtlas, type ArtAtlas } from './index';
import { renderTerrainChunk, renderMinimapTerrain, TERRAIN } from './terrain';

const q = new URLSearchParams(location.search);
const zoom = parseFloat(q.get('zoom') ?? '1');
const only = q.get('only') ?? '';
const showScene = q.get('scene') !== '0';
const sceneOnly = q.get('sceneOnly') === '1';
const ppt = parseInt(q.get('ppt') ?? '32', 10);
const light = q.get('light') === '1';

const hdr = document.getElementById('hdr')!;
const main = document.getElementById('main')!;

const t0 = performance.now();
const atlas = buildArtAtlas();
const genMs = performance.now() - t0;

// ------------------------------------------------------------- sample map
const MW = 40;
const MH = 24;
function sampleMap(): Uint8Array {
  const t = new Uint8Array(MW * MH);
  const set = (x0: number, y0: number, x1: number, y1: number, v: number) => {
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (x >= 0 && y >= 0 && x < MW && y < MH) t[y * MW + x] = v;
  };
  const { ROAD, RUBBLE, WATER, RUIN, PARK } = TERRAIN;
  // roads: horizontal band + two verticals
  set(0, 11, 39, 12, ROAD);
  set(17, 0, 18, 23, ROAD);
  set(31, 0, 33, 10, ROAD);
  set(31, 13, 32, 23, ROAD);
  // ruins (blocks)
  set(1, 1, 6, 4, RUIN); set(1, 5, 3, 8, RUIN); set(8, 1, 12, 3, RUIN);
  set(20, 1, 25, 5, RUIN); set(26, 1, 29, 3, RUIN); set(20, 6, 22, 8, RUIN);
  set(35, 1, 39, 6, RUIN); set(34, 15, 39, 19, RUIN);
  set(20, 14, 23, 16, RUIN);
  // rubble around ruins
  set(4, 5, 6, 7, RUBBLE); set(13, 1, 14, 3, RUBBLE); set(23, 6, 25, 8, RUBBLE); set(26, 4, 28, 5, RUBBLE);
  set(34, 7, 37, 8, RUBBLE); set(24, 14, 25, 16, RUBBLE); set(33, 20, 36, 21, RUBBLE);
  // water: canal pond bottom-left
  set(0, 17, 7, 23, WATER); set(8, 19, 11, 23, WATER); set(3, 15, 6, 16, WATER);
  // park top-right of crossing / bottom middle
  set(8, 5, 15, 9, PARK); set(12, 14, 16, 22, PARK); set(25, 18, 30, 23, PARK);
  // carve a few single tiles for variety
  t[9 * MW + 10] = RUBBLE;
  t[20 * MW + 13] = WATER; t[21 * MW + 13] = WATER; t[21 * MW + 14] = WATER;
  return t;
}

function scene(A: ArtAtlas): HTMLCanvasElement {
  const terrain = sampleMap();
  const map = { w: MW, h: MH, terrain, seed: 1337 };
  const c = document.createElement('canvas');
  c.width = MW * ppt;
  c.height = MH * ppt;
  const g = c.getContext('2d')!;
  const tt = performance.now();
  // render as 2x2 chunks to verify seams
  const cw = MW / 2, ch = MH / 2;
  for (let cy = 0; cy < 2; cy++) for (let cx = 0; cx < 2; cx++) g.drawImage(renderTerrainChunk(map, cx * cw, cy * ch, cw, ch, ppt), cx * cw * ppt, cy * ch * ppt);
  const terrMs = performance.now() - tt;
  const s = ppt / 64; // sprite scale (art authored at 64 px/tile)
  const T = ppt;

  // creep overlay on the right side (AXIOM territory)
  const creep = A.get('fx:creep_pattern');
  if (creep) {
    g.save();
    const pat = g.createPattern(creep, 'repeat')!;
    pat.setTransform(new DOMMatrix().scale(s, s));
    g.beginPath();
    g.ellipse(36.5 * T, 14 * T, 8 * T, 7 * T, 0, 0, Math.PI * 2);
    g.clip();
    g.globalAlpha = 0.85;
    g.fillStyle = pat;
    g.fillRect(25 * T, 5 * T, 16 * T, 20 * T);
    g.restore();
  }
  const put = (key: string, x: number, y: number, rot = 0, sc = s, alpha = 1) => {
    const im = A.get(key);
    if (!im) return;
    const m = A.meta(key);
    g.save();
    g.globalAlpha = alpha;
    g.translate(x * T, y * T);
    g.rotate(rot);
    g.scale(sc, sc);
    g.drawImage(im, -im.width * m.anchorX, -im.height * m.anchorY);
    g.restore();
  };
  // dynamic shadow like the renderer will do: tinted silhouette offset
  const tint = new Map<string, HTMLCanvasElement>();
  const shadowOf = (key: string) => {
    let t = tint.get(key);
    if (t) return t;
    const im = A.get(key)!;
    t = document.createElement('canvas');
    t.width = im.width; t.height = im.height;
    const tg = t.getContext('2d')!;
    tg.drawImage(im, 0, 0);
    tg.globalCompositeOperation = 'source-in';
    tg.fillStyle = '#000';
    tg.fillRect(0, 0, t.width, t.height);
    tint.set(key, t);
    return t;
  };
  const unit = (key: string, x: number, y: number, rot = 0, sh = 0.08) => {
    const im = A.get(key);
    if (!im) return;
    const so = shadowOf(key);
    g.save();
    g.globalAlpha = 0.4;
    g.translate(x * T + sh * T * 0.6, y * T + sh * T);
    g.rotate(rot);
    g.scale(s, s);
    g.drawImage(so, -im.width / 2, -im.height / 2);
    g.restore();
    put(key, x, y, rot);
  };
  const bld = (kind: string, team: string, tx: number, ty: number, n: number, turretRot?: number) => {
    put(`bld:${kind}:${team}`, tx + n / 2, ty + n / 2);
    if (turretRot !== undefined) put(`bld:${kind}:${team}:turret`, tx + n / 2, ty + n / 2, turretRot);
  };
  // decals
  put('decal:scorch:0', 27.5, 13.2);
  put('decal:crater:0', 24.5, 9.8);
  put('decal:scorch:1', 15.2, 12.6);
  // scrap field
  put('res:scrap:0', 9.5, 14.5); put('res:scrap:1', 10.5, 15.4); put('res:scrap:2', 9.4, 16.3); put('res:scrap:3', 11, 16.6);
  // human base
  bld('hq', 'human', 3, 12.5, 4);
  bld('barracks', 'human', 8, 12.5, 3);
  bld('generator', 'human', 0.5, 9, 2);
  bld('habitat', 'human', 13, 13, 2);
  bld('gun_turret', 'human', 14.5, 9.5, 2, -0.3);
  bld('tesla', 'human', 21, 9.5, 2, 0);
  bld('missile', 'human', 21, 17.5, 2, 0.4);
  bld('depot', 'human', 8, 16.5, 2);
  bld('lab', 'human', 26, 14, 3);
  // wall line with corners
  const walls: [number, number][] = [];
  for (let y = 13; y <= 18; y++) walls.push([16, y]);
  for (let x = 16; x <= 19; x++) walls.push([x, 19]);
  const wset = new Set(walls.map(([x, y]) => `${x},${y}`));
  for (const [x, y] of walls) {
    const mask = (wset.has(`${x},${y - 1}`) ? 1 : 0) | (wset.has(`${x + 1},${y}`) ? 2 : 0) | (wset.has(`${x},${y + 1}`) ? 4 : 0) | (wset.has(`${x - 1},${y}`) ? 8 : 0);
    put(`bld:wall:human:${mask}`, x + 0.5, y + 0.5);
  }
  // axiom side
  bld('relay', 'axiom', 33.5, 9, 2);
  bld('lancet', 'axiom', 29.5, 6.5, 2, Math.PI);
  bld('lancet', 'hacked', 27.5, 20, 2, -2.5);
  bld('server_farm', 'axiom', 13, 1, 3);
  bld('server_farm', 'neutral', 26, 7.5, 3);
  // wrecks
  put('wreck:small:0', 25.8, 11.7); put('wreck:medium:1', 29.2, 12.4); put('wreck:large:0', 23.4, 12.2);
  // units: humans moving east along the road
  const f = (i: number) => i % 4;
  const hum = ['rifleman', 'rifleman', 'arc_trooper', 'rocketeer', 'netrunner', 'ranger', 'engineer', 'rifleman'];
  hum.forEach((k, i) => unit(`unit:${k}:human:${f(i)}`, 19.6 + (i % 4) * 0.85, 11.3 + Math.floor(i / 4) * 0.9, (i % 3 - 1) * 0.15));
  unit('unit:engineer:human:1', 9.1, 15.6, 2.4);
  unit('unit:engineer:human:3', 10.8, 14.6, -2);
  unit('unit:bulldog:human:0', 15.6, 11.9, 0.05, 0.12); put('unit:bulldog:human:turret', 15.6, 11.9, 0.25);
  unit('unit:volt:human:1', 18.6, 15.2, -1.57, 0.12); put('unit:volt:human:turret', 18.6, 15.2, -0.6);
  unit('unit:thumper:human:0', 13.4, 11.1, 0, 0.12); put('unit:thumper:human:turret', 13.4, 11.1, -0.2);
  // robots coming from the east
  const rob = ['skitter', 'skitter', 'skitter', 'gunner', 'sapper', 'lancer', 'gunner', 'skitter', 'skitter'];
  rob.forEach((k, i) => unit(`unit:${k}:axiom:${f(i)}`, 28.6 + (i % 3) * 0.9, 11.1 + Math.floor(i / 3) * 0.75, Math.PI + (i % 2 ? 0.2 : -0.15)));
  unit('unit:brute:axiom:1', 34.5, 12.2, Math.PI, 0.12);
  unit('unit:warden:axiom:2', 36.4, 13.6, Math.PI + 0.4, 0.3);
  unit('unit:gunner:hacked:2', 26.3, 12.6, 0.1);
  unit('unit:skitter:hacked:1', 25.6, 13.2, 0.3);
  // flying wasp with ground shadow
  put('unit:wasp:shadow', 30.4 + 0.5, 15.6 + 0.8, Math.PI * 0.85, s, 0.35);
  put('unit:wasp:axiom:0', 30.4, 15.6, Math.PI * 0.85);
  unit('unit:colossus:axiom:0', 37, 16.4, Math.PI + 0.3, 0.2);
  // UI overlays
  put('fx:ring', 19.6, 11.3, 0, s * 0.9);
  put('fx:move_marker', 24.5, 16.5);
  put('fx:rally', 11.5, 11.2);
  put('fx:hack', 26.3, 12.6, 0, s * 0.8, 0.9);
  // fx
  put('fx:explosion:2', 31.4, 12.1);
  put('fx:muzzle:0', 16.6 + 0.9, 11.9 + 0.17, 0.25);
  put('fx:rocket', 24, 11.3, 0);
  put('fx:emp_ring', 34, 18.5, 0, s, 0.9);
  const lab = document.createElement('div');
  lab.textContent = `scene ${MW}×${MH} tiles @ ${ppt}px/tile — terrain ${terrMs.toFixed(0)} ms (4 chunks)`;
  lab.style.margin = '4px 0 10px';
  (c as unknown as { _label: HTMLElement })._label = lab;
  return c;
}

// ------------------------------------------------------------- key grid
function group(key: string): string {
  const p = key.split(':');
  if (p[0] === 'unit') return `unit:${p[2] === 'shadow' ? 'misc' : p[2]}`;
  if (p[0] === 'bld') return p[1] === 'wall' ? 'bld:wall' : p[3] === 'turret' ? 'bld:turret' : `bld:${p[2]}`;
  if (p[0] === 'res' || p[0] === 'wreck' || p[0] === 'decal') return 'res / wreck / decal';
  if (p[0] === 'fx' && p[1] === 'scaffold') return 'fx:scaffold';
  return p[0];
}

function render() {
  const keys = atlas.keys().filter((k) => k.startsWith(only));
  hdr.innerHTML = `<b>OVERFIT</b> art atlas — <b>${atlas.keys().length}</b> keys generated in <b class="${genMs > 1500 ? 'ax' : ''}">${genMs.toFixed(0)} ms</b> (${Object.entries(atlas.stageMs).map(([k, v]) => `${k} ${v}`).join(', ')})` +
    ` · zoom ${zoom}× ${only ? `· only "${only}"` : ''} · <span style="color:#7d8691">?zoom=2 ?only=unit:skitter ?scene=0 ?ppt=64 ?light=1</span>`;
  (window as unknown as { __ART_MS: number }).__ART_MS = genMs;
  if (showScene && !only) {
    const h = document.createElement('h2');
    h.textContent = 'In-game sample (0.5× sprites over terrain chunks)';
    main.appendChild(h);
    const sc = scene(atlas);
    sc.className = 'scene';
    if (zoom !== 1) { sc.style.width = `${sc.width * zoom}px`; sc.style.imageRendering = 'pixelated'; }
    main.appendChild(sc);
    main.appendChild((sc as unknown as { _label: HTMLElement })._label);
    const mm = renderMinimapTerrain({ w: MW, h: MH, terrain: sampleMap(), seed: 1337 });
    mm.style.width = `${MW * 4}px`;
    mm.style.imageRendering = 'pixelated';
    main.appendChild(mm);
  }
  if (sceneOnly) return;
  const groups = new Map<string, string[]>();
  for (const k of keys) {
    const gname = group(k);
    if (!groups.has(gname)) groups.set(gname, []);
    groups.get(gname)!.push(k);
  }
  for (const [gname, ks] of groups) {
    const h = document.createElement('h2');
    h.textContent = `${gname} (${ks.length})`;
    main.appendChild(h);
    const grid = document.createElement('div');
    grid.className = 'grid' + (zoom > 1 ? ' pix' : '');
    for (const k of ks) {
      const fig = document.createElement('figure');
      if (light) fig.className = 'light';
      const src = atlas.get(k)!;
      const cv = document.createElement('canvas');
      cv.width = src.width;
      cv.height = src.height;
      cv.getContext('2d')!.drawImage(src, 0, 0);
      const m = atlas.meta(k);
      cv.style.width = `${cv.width * zoom}px`;
      cv.style.height = `${cv.height * zoom}px`;
      fig.appendChild(cv);
      const cap = document.createElement('figcaption');
      cap.textContent = `${k} ${cv.width}×${cv.height}${m.anchorX !== 0.5 || m.anchorY !== 0.5 ? ` a(${m.anchorX.toFixed(2)},${m.anchorY.toFixed(2)})` : ''}`;
      fig.appendChild(cap);
      grid.appendChild(fig);
    }
    main.appendChild(grid);
  }
}

render();
