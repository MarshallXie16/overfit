// Combat sandbox: N humans vs M robots on open ground.
import { step } from '../src/sim/step';
import { World } from '../src/sim/world';
import { HUMAN, AXIOM } from '../src/sim/types';
import { setOrder } from '../src/sim/systems/units';
const args = process.argv.slice(2);
const parse = (s: string) => s.split(',').map((p) => { const [k, n] = p.split(':'); return [k, +n] as [string, number]; });
const H = parse(args[0] ?? 'rifleman:20');
const R = parse(args[1] ?? "gunner:20");
const trials = +(args[2] ?? 5);
import { UNITS as U0 } from '../src/sim/data/defs';
for (const kv of (args[3] ?? '').split(',').filter(Boolean)) {
  const [path, raw] = kv.split('=');
  const keys = path.split('.');
  let o = (U0 as unknown as Record<string, Record<string, unknown>>)[keys[0]] as Record<string, unknown>;
  for (let i = 1; i < keys.length - 1; i++) o = o[keys[i]] as Record<string, unknown>;
  o[keys[keys.length - 1]] = JSON.parse(raw);
}
let hw = 0, sumH = 0, sumR = 0, sumT = 0;
for (let tr = 0; tr < trials; tr++) {
  const w = new World(64, 64, { mode: 'skirmish', difficulty: 'veteran', seed: 100 + tr, mapSize: 64 });
  w.rebuildWalk(); w.flags.noHqDefeat = true; w.revealAll = true; w.axiom.enabled = false;
  let i = 0;
  for (const [k, n] of H) for (let j = 0; j < n; j++, i++) { const u = w.spawnUnit(k, HUMAN, 20 + (i % 6) * 0.9, 26 + Math.floor(i / 6) * 0.9); setOrder(u, { type: 'amove', x: 44, y: 30 }); }
  i = 0;
  for (const [k, n] of R) for (let j = 0; j < n; j++, i++) { const u = w.spawnUnit(k, AXIOM, 44 + (i % 6) * 0.9, 26 + Math.floor(i / 6) * 0.9); setOrder(u, { type: 'amove', x: 20, y: 30 }); }
  for (let t = 0; t < 20 * 180; t++) {
    step(w); w.events.length = 0;
    const h = w.entities.filter((e) => e.alive && e.team === HUMAN && e.isUnit).length;
    const r = w.entities.filter((e) => e.alive && e.team === AXIOM && e.isUnit).length;
    if (!h || !r) break;
  }
  const hs = w.entities.filter((e) => e.alive && e.team === HUMAN && e.isUnit);
  const rs = w.entities.filter((e) => e.alive && e.team === AXIOM && e.isUnit);
  if (hs.length && !rs.length) hw++;
  sumH += hs.length; sumR += rs.length; sumT += w.time;
}
const cost = (L: [string, number][], f: (k: string) => number) => L.reduce((a, [k, n]) => a + f(k) * n, 0);
import('../src/sim/data/defs').then(({ UNITS }) => {
  console.log(`${args[0]} (${cost(H, (k) => UNITS[k].cost.scrap)} scrap) vs ${args[1]} (${cost(R, (k) => UNITS[k].compute ?? 0)} compute): human wins ${hw}/${trials}, avg survivors H ${(sumH / trials).toFixed(1)} R ${(sumR / trials).toFixed(1)}, avg ${(sumT / trials).toFixed(0)}s`);
});
