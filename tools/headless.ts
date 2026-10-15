// Headless soak/balance runner.
// Usage: npx tsx tools/headless.ts [--seed 1] [--minutes 15] [--size 96] [--diff veteran] [--mode skirmish] [--seeds 5] [--nobot]
import { Bot } from '../src/sim/bot';
import { generateWorld } from '../src/sim/mapgen';
import { step } from '../src/sim/step';
import { AXIOM, HUMAN, TICK_HZ, type Difficulty, type GameMode } from '../src/sim/types';
import type { World } from '../src/sim/world';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const seed0 = +opt('seed', '1');
const seeds = +opt('seeds', '1');
const minutes = +opt('minutes', '15');
const size = +opt('size', '96');
const diff = opt('diff', 'veteran') as Difficulty;
const mode = opt('mode', 'skirmish') as GameMode;
const noBot = args.includes('--nobot');
const quiet = args.includes('--quiet');

function invariants(w: World): string[] {
  const errs: string[] = [];
  for (const e of w.entities) {
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) errs.push(`NaN pos ${e.kind}#${e.id}`);
    if (!Number.isFinite(e.hp)) errs.push(`NaN hp ${e.kind}#${e.id}`);
    if (e.isUnit && !e.flying && !w.isWalkableTile(Math.floor(e.x), Math.floor(e.y))) {
      (e as unknown as { badT: number }).badT = ((e as unknown as { badT: number }).badT ?? 0) + 1;
      if ((e as unknown as { badT: number }).badT > TICK_HZ * 4) errs.push(`stuck in wall ${e.kind}#${e.id} @${e.x.toFixed(1)},${e.y.toFixed(1)}`);
    } else if (e.isUnit) (e as unknown as { badT: number }).badT = 0;
  }
  if (w.human.scrap < -1 || w.human.data < -1) errs.push(`negative resources ${w.human.scrap} ${w.human.data}`);
  return errs;
}

const summary: string[] = [];
for (let s = seed0; s < seed0 + seeds; s++) {
  const w = generateWorld({ mode, difficulty: diff, seed: s, mapSize: size });
  const bot = noBot ? null : new Bot(1);
  const ticks = minutes * 60 * TICK_HZ;
  let maxTick = 0, sumTick = 0, errCount = 0;
  const t0 = performance.now();
  for (let i = 0; i < ticks && !w.result; i++) {
    bot?.think(w);
    const a = performance.now();
    step(w);
    const dt = performance.now() - a;
    sumTick += dt; if (dt > maxTick) maxTick = dt;
    w.events.length = 0;
    if (i % 100 === 0) {
      const errs = invariants(w);
      if (errs.length) { errCount += errs.length; if (errCount < 12) console.log(`[seed ${s} t=${w.time.toFixed(0)}]`, errs.slice(0, 3).join(' | ')); }
    }
    if (!quiet && i % (TICK_HZ * 60) === 0 && i > 0) {
      const hu = w.entities.filter((e) => e.alive && e.team === HUMAN && e.isUnit).length;
      const ax = w.entities.filter((e) => e.alive && e.team === AXIOM && e.isUnit).length;
      console.log(`  seed ${s} ${(w.time / 60).toFixed(0)}m: scrap ${w.human.scrap | 0} data ${w.human.data | 0} pop ${w.human.pop}/${w.human.popCap} pwr ${w.human.powerUsed}/${w.human.power} | humans ${hu} robots ${ax} threat ${w.axiom.threat} compute ${w.axiom.computeRate.toFixed(1)}/s surges ${w.axiom.surgeN} creep ${w.axiom.creepTiles} resist ${JSON.stringify(w.axiom.resist)}`);
    }
  }
  const wall = performance.now() - t0;
  const st = w.human.stats;
  const line = `seed ${s}: ${w.result ?? 'running'} at ${(w.time / 60).toFixed(1)}m | killed ${st.killed} lost ${st.lost} hacked ${st.hacked} built ${st.built} trained ${st.trained} surges ${st.surgesSurvived}/${w.axiom.surgeN} peakSwarm ${st.peakSwarm} | tick avg ${(sumTick / Math.max(1, w.tick)).toFixed(2)}ms max ${maxTick.toFixed(1)}ms | wall ${(wall / 1000).toFixed(1)}s | invariant errors ${errCount}`;
  console.log(line);
  summary.push(line);
}
if (seeds > 1) { console.log('\n=== SUMMARY ==='); for (const l of summary) console.log(l); }
