// Headless soak / balance runner.
//
// Single game(s), verbose per-minute trace:
//   npx tsx tools/headless.ts --seed 1 --seeds 5 --minutes 20 --size 96 --diff veteran
// Balance matrix (comma lists, parallel workers, aggregated table):
//   npx tsx tools/headless.ts --seeds 10 --minutes 40 --size 80,96,128 --diff recruit,veteran,nightmare --level 2 --jobs 10 --quiet
// Flags: --level 0|1|2 (bot level, default 1)  --mode skirmish|endless  --nobot  --quiet  --json  --jobs N  --strict (exit 1 on invariant errors)
//        --set PATH=VALUE,...   override balance constants (AXIOM_BAL, ECON, UNITS, BUILDINGS, RESEARCH, PROTOCOLS, DIFF, BOT)
// Perf stress (N robots march on a bot-defended base, 128 map):   npx tsx tools/headless.ts --stress 900
// Combat sandbox (open ground, 5 trials):   npx tsx tools/headless.ts --arena rifleman:20 gunner:14,skitter:14
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { AXIOM_BAL } from '../src/sim/ai/axiom';
import { Bot, BOT_LEVELS } from '../src/sim/bot';
import { BUILDINGS, PROTOCOLS, RESEARCH, UNITS } from '../src/sim/data/defs';
import { ECON } from '../src/sim/systems/units';
import { DIFF } from '../src/sim/world';
import { generateWorld } from '../src/sim/mapgen';
import { step } from '../src/sim/step';
import { setOrder } from '../src/sim/systems/units';
import { AXIOM, HUMAN, TICK_HZ, type Difficulty, type GameMode } from '../src/sim/types';
import { World, type Entity } from '../src/sim/world';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const seed0 = +opt('seed', '1');
const seeds = +opt('seeds', '1');
const minutes = +opt('minutes', '15');
const sizes = opt('size', '96').split(',').map(Number);
const diffs = opt('diff', 'veteran').split(',') as Difficulty[];
const mode = opt('mode', 'skirmish') as GameMode;
const level = +opt('level', '1');
const jobs = +opt('jobs', '1');
const noBot = args.includes('--nobot');
const quiet = args.includes('--quiet');
const asJson = args.includes('--json');
const worker = args.includes('--worker');
// --set AXIOM_BAL.rampDiv=300,UNITS.colossus.hp=4500,BOT.2.engineers=24,DIFF.veteran.compute=0.9,ECON.carry=8
const sets = opt('set', '');
const ROOTS: Record<string, unknown> = { AXIOM_BAL, ECON, UNITS, BUILDINGS, RESEARCH, PROTOCOLS, DIFF, BOT: BOT_LEVELS };
for (const kv of sets.split(',').filter(Boolean)) {
  const [path, raw] = kv.split('=');
  const keys = path.split('.');
  let o = ROOTS[keys[0]] as Record<string, unknown>;
  for (let i = 1; i < keys.length - 1; i++) o = o[keys[i]] as Record<string, unknown>;
  const last = keys[keys.length - 1];
  if (!o || !(last in o)) throw new Error('unknown --set path ' + path);
  o[last] = JSON.parse(raw);
}

export interface GameResult {
  seed: number; size: number; diff: Difficulty; level: number;
  result: string; minutes: number;
  surgesSurvived: number; surges: number; peakSwarm: number; peakEntities: number;
  killed: number; lost: number; hacked: number; trained: number; built: number;
  firstSurge: number; swarmAt10: number; swarmAt20: number; peak20: number;
  structuresKilled: number; farmsHeld: number;
  protos: string; research: number; vaults: number; maxArmy: number;
  msAvg: number; msMax: number; msAvgBusy: number;
  errors: number; errorSamples: string[];
}

// ------------------------------------------------------------------ invariants
interface Track { x: number; y: number; t: number; badT: number; order: unknown }

class Invariants {
  errors = 0;
  samples: string[] = [];
  private track = new Map<number, Track>();
  private stackSince = new Map<number, number>();
  private farmFlips = new Map<number, number[]>();
  private farmTeam = new Map<number, number>();
  private surgeSince = -1;
  private idleEng = new Map<number, number>();

  report(w: World, msg: string): void {
    this.errors++;
    if (this.samples.length < 12) this.samples.push(`t=${w.time.toFixed(0)} ${msg}`);
  }

  /** Called every 100 ticks (5 s). */
  check(w: World, botOn: boolean): void {
    const seen = new Set<number>();
    const stacks = new Map<number, number>();
    let ents = 0;
    for (const e of w.entities) {
      if (!e.alive) continue;
      ents++;
      if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) this.report(w, `NaN pos ${e.kind}#${e.id}`);
      if (!Number.isFinite(e.hp)) this.report(w, `NaN hp ${e.kind}#${e.id}`);
      if (e.hp > e.maxHp + 1e-6 && e.kind !== 'server_farm') this.report(w, `hp>max ${e.kind}#${e.id} ${e.hp}/${e.maxHp}`);
      if (e.x < 0 || e.y < 0 || e.x > w.w || e.y > w.h) this.report(w, `out of map ${e.kind}#${e.id}`);
      if (!e.isUnit) continue;
      seen.add(e.id);
      // hacking consistency
      if (e.hacked && e.team !== HUMAN) this.report(w, `hacked flag on team ${e.team} ${e.kind}#${e.id}`);
      if (e.isRobot && e.team === HUMAN && !e.hacked) this.report(w, `robot on human team without hack ${e.kind}#${e.id}`);
      if (e.hacked && e.hackedBy) {
        const r = w.get(e.hackedBy);
        if (!r || !r.links.includes(e.id)) this.report(w, `orphan hacked unit ${e.kind}#${e.id} (runner ${e.hackedBy})`);
      }
      if (e.kind === 'netrunner' && e.links.filter((l) => w.get(l)).length > w.human.bandwidth) this.report(w, `netrunner over bandwidth #${e.id}`);
      // positions
      let tr = this.track.get(e.id);
      if (!tr) { tr = { x: e.x, y: e.y, t: w.time, badT: 0, order: e.order }; this.track.set(e.id, tr); }
      if (tr.order !== e.order) { tr.order = e.order; tr.t = w.time; tr.x = e.x; tr.y = e.y; }
      if (!e.flying && !w.isWalkableTile(Math.floor(e.x), Math.floor(e.y))) {
        tr.badT += 5;
        if (tr.badT > 6) this.report(w, `inside blocked tile ${e.kind}#${e.id} @${e.x.toFixed(1)},${e.y.toFixed(1)}`);
      } else tr.badT = 0;
      if (Math.hypot(e.x - tr.x, e.y - tr.y) > 1.0) { tr.x = e.x; tr.y = e.y; tr.t = w.time; }
      else if (movingOrder(e) && e.targetId === 0 && w.time - e.firedAt > 5 && e.stunUntil <= w.time && w.time - tr.t > 40 && !(e.udef?.weapon === undefined && e.order?.type === 'flow')) {
        this.report(w, `stuck ${e.kind}#${e.id} order=${e.order?.type} @${e.x.toFixed(1)},${e.y.toFixed(1)} for ${(w.time - tr.t).toFixed(0)}s`);
        tr.t = w.time; // report once per 40 s
      }
      if (!e.flying) {
        const k = (e.y | 0) * w.w + (e.x | 0);
        stacks.set(k, (stacks.get(k) ?? 0) + 1);
      }
      // idle engineers (bot should employ them while safe scrap is within reach of a drop-off)
      if (botOn && e.team === HUMAN && e.kind === 'engineer') {
        if (!e.order && safeScrap(w)) {
          const since = this.idleEng.get(e.id) ?? w.time;
          this.idleEng.set(e.id, since);
          if (w.time - since > 30) { this.report(w, `engineer idle 30s #${e.id} @${e.x.toFixed(1)},${e.y.toFixed(1)}`); this.idleEng.set(e.id, w.time); }
        } else this.idleEng.delete(e.id);
      }
    }
    for (const id of this.track.keys()) if (!seen.has(id)) this.track.delete(id);
    // stacking: > 6 ground units on one tile for 30 s+
    for (const [k, n] of stacks) {
      if (n <= 6) { this.stackSince.delete(k); continue; }
      const since = this.stackSince.get(k) ?? w.time;
      this.stackSince.set(k, since);
      if (w.time - since > 30) { this.report(w, `stack of ${n} units on tile ${k % w.w},${(k / w.w) | 0}`); this.stackSince.set(k, w.time); }
    }
    for (const k of [...this.stackSince.keys()]) if ((stacks.get(k) ?? 0) <= 6) this.stackSince.delete(k);
    if (ents > 5000) this.report(w, `entity count runaway: ${ents}`);
    if (w.projectiles.length > 3000) this.report(w, `projectile runaway: ${w.projectiles.length}`);
    if (w.human.scrap < -1 || w.human.data < -1) this.report(w, `negative resources ${w.human.scrap} ${w.human.data}`);
    if (w.human.pop > w.human.popCap + 3 && w.human.popCap > 0) { /* pop can exceed cap after losing habitats */ }
    // surge must end eventually
    if (w.axiom.surgeActive) {
      if (this.surgeSince < 0) this.surgeSince = w.time;
      else if (w.time - this.surgeSince > 240) { this.report(w, `surge ${w.axiom.surgeN} active for 240 s`); this.surgeSince = w.time; }
    } else this.surgeSince = -1;
    // server farms flip-flop
    for (const f of w.entities) {
      if (!f.alive || f.kind !== 'server_farm') continue;
      const prev = this.farmTeam.get(f.id);
      if (prev !== undefined && prev !== f.team) {
        const arr = this.farmFlips.get(f.id) ?? [];
        arr.push(w.time);
        while (arr.length && arr[0] < w.time - 60) arr.shift();
        this.farmFlips.set(f.id, arr);
        if (arr.length > 6) this.report(w, `server farm #${f.id} flip-flopping (${arr.length} flips/min)`);
      }
      this.farmTeam.set(f.id, f.team);
    }
  }
}

let safeAt = -1, safeVal = false;
/** Is there harvestable scrap near a drop-off with no robots around it? (cached per check) */
function safeScrap(w: World): boolean {
  if (safeAt === w.tick) return safeVal;
  safeAt = w.tick;
  const drops = w.entities.filter((b) => b.alive && b.team === HUMAN && b.built && b.bdef?.dropoff);
  const robots = w.entities.filter((u) => u.alive && u.team === AXIOM && u.isUnit);
  safeVal = w.entities.some((r) => r.alive && r.cat === 'resource' && r.amount > 0 && w.creepAt(r.x, r.y) < 0.3 &&
    drops.some((d) => Math.hypot(d.x - r.x, d.y - r.y) < 20) && !robots.some((u) => Math.hypot(u.x - r.x, u.y - r.y) < 9));
  return safeVal;
}

function movingOrder(e: Entity): boolean {
  const t = e.order?.type;
  return t === 'move' || t === 'amove' || t === 'flow' || t === 'attack';
}

// ------------------------------------------------------------------ one game
export function runGame(seed: number, size: number, diff: Difficulty, lvl: number, mins: number, verbose: boolean): GameResult {
  const w = generateWorld({ mode, difficulty: diff, seed, mapSize: size });
  const bot = noBot ? null : new Bot(lvl);
  const inv = new Invariants();
  const ticks = mins * 60 * TICK_HZ;
  let maxTick = 0, sumTick = 0, busySum = 0, busyN = 0, peakEnt = 0, firstSurge = 0, at10 = -1, at20 = -1, peak20 = 0;
  let structuresKilled = 0, farmTicks = 0, vaults = 0, maxArmy = 0;
  const protos: Record<string, number> = { supply: 0, emp: 0, orbital: 0, override: 0 };
  for (let i = 0; i < ticks && !w.result; i++) {
    const a = performance.now();
    bot?.think(w);
    step(w);
    const dt = performance.now() - a;
    sumTick += dt; if (dt > maxTick) maxTick = dt;
    for (const ev of w.events) {
      if (ev.t === 'surge_start' && ev.n === 1) firstSurge = ev.count as number;
      if (ev.t === 'death' && ev.team === AXIOM && ev.cat === 'building') { structuresKilled++; if (ev.kind === 'vault') vaults++; }
      if (ev.t === 'supply_warn') protos.supply++;
      if (ev.t === 'emp') protos.emp++;
      if (ev.t === 'orbital_warn') protos.orbital++;
      if (ev.t === 'override') protos.override++;
    }
    w.events.length = 0;
    const n = w.entities.length;
    if (n > peakEnt) peakEnt = n;
    if (n >= 800) { busySum += dt; busyN++; }
    if (i % 100 === 0) {
      inv.check(w, !!bot);
      let army = 0;
      for (const e of w.entities) {
        if (e.kind === 'server_farm' && e.team === HUMAN) farmTicks += 100;
        if (e.alive && e.team === HUMAN && e.isUnit && e.kind !== 'engineer') army++;
      }
      if (army > maxArmy) maxArmy = army;
    }
    if (i === 10 * 60 * TICK_HZ) at10 = w.axiom.units;
    if (i === 20 * 60 * TICK_HZ) at20 = w.axiom.units;
    if (i <= 20 * 60 * TICK_HZ && w.axiom.units > peak20) peak20 = w.axiom.units;
    if (verbose && i % (TICK_HZ * 60) === 0 && i > 0) {
      const hu = w.entities.filter((e) => e.alive && e.team === HUMAN && e.isUnit);
      const eng = hu.filter((e) => e.kind === 'engineer').length;
      const ax = w.entities.filter((e) => e.alive && e.team === AXIOM && e.isUnit).length;
      const tur = w.entities.filter((e) => e.alive && e.team === HUMAN && e.isBuilding && e.bdef?.weapon).length;
      const A = w.axiom;
      const axb = new Map<string, number>();
      for (const e of w.entities) if (e.alive && e.isBuilding && (e.team === AXIOM || e.kind === 'server_farm')) { const k = e.kind === 'server_farm' ? 'farm' + e.team : e.kind.slice(0, 4); axb.set(k, (axb.get(k) ?? 0) + 1); }
      const res = (k: 'kinetic' | 'energy' | 'explosive') => `${Math.round(A.resist[k] * 100)}/${Math.round(A.vuln[k] * 100)}`;
      console.log(`  s${seed} ${(w.time / 60).toFixed(0)}m: scrap ${w.human.scrap | 0} data ${w.human.data | 0} pop ${w.human.pop}/${w.human.popCap} pwr ${w.human.powerUsed}/${w.human.power} | eng ${eng} army ${hu.length - eng} tur ${tur} | robots ${ax} thr ${A.threat} cmp ${A.computeRate.toFixed(1)}/s pool ${A.surgePool | 0} bank ${A.compute | 0} surge ${A.surgeN}${A.surgeActive ? '*' : ''} T-${A.surgeT | 0} | K/E/X r/v ${res('kinetic')} ${res('energy')} ${res('explosive')} | ${[...axb].map(([k, v]) => k + v).join(' ')} creep ${A.creepTiles} | bot ${bot?.mode ?? '-'} | ms ${(sumTick / w.tick).toFixed(2)}`);
    }
  }
  const st = w.human.stats;
  return {
    seed, size, diff, level: lvl,
    result: w.result ?? 'timeout', minutes: +(w.time / 60).toFixed(2),
    surgesSurvived: st.surgesSurvived, surges: w.axiom.surgeN, peakSwarm: st.peakSwarm, peakEntities: peakEnt,
    killed: st.killed, lost: st.lost, hacked: st.hacked, trained: st.trained, built: st.built,
    firstSurge, swarmAt10: at10, swarmAt20: at20, peak20, structuresKilled, farmsHeld: +(farmTicks / TICK_HZ / 60).toFixed(1),
    protos: `s${protos.supply}e${protos.emp}o${protos.orbital}v${protos.override}`, research: w.human.research.size, vaults, maxArmy,
    msAvg: +(sumTick / Math.max(1, w.tick)).toFixed(3), msMax: +maxTick.toFixed(1), msAvgBusy: busyN ? +(busySum / busyN).toFixed(3) : 0,
    errors: inv.errors, errorSamples: inv.samples,
  };
}

function line(r: GameResult): string {
  return `${r.diff.padEnd(9)} ${String(r.size).padStart(3)} s${String(r.seed).padEnd(3)} ${r.result.padEnd(8)} ${r.minutes.toFixed(1).padStart(5)}m | surges ${r.surgesSurvived}/${r.surges} first ${r.firstSurge} | swarm peak ${r.peakSwarm} (<=20m ${r.peak20}) @10m ${r.swarmAt10} @20m ${r.swarmAt20} | K ${r.killed} L ${r.lost} H ${r.hacked} S ${r.structuresKilled} V ${r.vaults} farm ${r.farmsHeld}m army ${r.maxArmy} res ${r.research} ${r.protos} | ms ${r.msAvg} busy ${r.msAvgBusy} max ${r.msMax} ent ${r.peakEntities} | err ${r.errors}${r.errorSamples.length ? ' :: ' + r.errorSamples.slice(0, 3).join(' | ') : ''}`;
}

function table(rs: GameResult[]): void {
  const groups = new Map<string, GameResult[]>();
  for (const r of rs) {
    const k = r.diff;
    const g = groups.get(k) ?? [];
    g.push(r);
    groups.set(k, g);
    const k2 = `${r.diff} ${r.size}`;
    const g2 = groups.get(k2) ?? [];
    g2.push(r);
    groups.set(k2, g2);
  }
  console.log('\n group            n   win%  loss%  avgMin  winMin  surgesSurv  peakSwarm  pk<=20m @20m*  ms/tick  busy   max  errors   (* games alive at 20m)');
  for (const [k, g] of [...groups.entries()].sort()) {
    const n = g.length;
    const wins = g.filter((r) => r.result === 'victory');
    const losses = g.filter((r) => r.result === 'defeat');
    const avg = (f: (r: GameResult) => number, arr = g) => (arr.length ? arr.reduce((a, r) => a + f(r), 0) / arr.length : 0);
    const busy = g.filter((r) => r.msAvgBusy > 0);
    console.log(` ${k.padEnd(15)} ${String(n).padStart(3)}  ${(wins.length / n * 100).toFixed(0).padStart(4)}  ${(losses.length / n * 100).toFixed(0).padStart(5)}  ${avg((r) => r.minutes).toFixed(1).padStart(6)}  ${avg((r) => r.minutes, wins).toFixed(1).padStart(6)}  ${avg((r) => r.surgesSurvived).toFixed(1).padStart(10)}  ${avg((r) => r.peakSwarm).toFixed(0).padStart(9)}  ${avg((r) => r.peak20, g.filter((r) => r.swarmAt20 >= 0)).toFixed(0).padStart(7)} ${avg((r) => r.swarmAt20, g.filter((r) => r.swarmAt20 >= 0)).toFixed(0).padStart(4)}  ${avg((r) => r.msAvg).toFixed(2).padStart(8)}  ${avg((r) => r.msAvgBusy, busy).toFixed(2).padStart(5)}  ${Math.max(...g.map((r) => r.msMax)).toFixed(0).padStart(4)}  ${g.reduce((a, r) => a + r.errors, 0)}`);
  }
}

// ------------------------------------------------------------------ main
// ------------------------------------------------------------------ perf stress
function stress(n: number): void {
  const w = generateWorld({ mode: 'skirmish', difficulty: 'veteran', seed: 11, mapSize: 128 });
  const bot = new Bot(2);
  for (let i = 0; i < 300 * TICK_HZ; i++) { bot.think(w); step(w); w.events.length = 0; }
  const hq = w.entities.find((e) => e.kind === 'hq')!;
  // an unbreakable fortress: keeps the siege (and the entity count) going for the whole window
  for (const b of w.entities) if (b.alive && b.team === HUMAN && b.isBuilding) b.maxHp = b.hp = 1e7;
  const kinds = ['skitter', 'skitter', 'skitter', 'gunner', 'gunner', 'brute', 'lancer', 'wasp', 'sapper'];
  let k = 0;
  for (let tries = 0; k < n && tries < n * 20; tries++) {
    const x = w.rng.range(3, w.w - 3), y = w.rng.range(3, w.h - 3);
    if (Math.hypot(x - hq.x, y - hq.y) < 35 || !w.isWalkableTile(x | 0, y | 0)) continue;
    const u = w.spawnUnit(kinds[k % kinds.length], AXIOM, x, y);
    setOrder(u, { type: 'flow', field: 'human', tx: hq.x, ty: hq.y });
    k++;
  }
  let sum = 0, mx = 0, ticks = 0, busy = 0, busyN = 0;
  for (let i = 0; i < 120 * TICK_HZ && !w.result; i++) {
    const a = performance.now();
    bot.think(w); step(w);
    const d = performance.now() - a;
    w.events.length = 0;
    sum += d; ticks++; if (d > mx) mx = d;
    if (w.entities.length >= 800) { busy += d; busyN++; }
  }
  console.log(`stress: ${k} robots spawned | avg ${(sum / ticks).toFixed(2)} ms/tick | with >=800 entities ${(busy / Math.max(1, busyN)).toFixed(2)} ms over ${busyN} ticks | max ${mx.toFixed(1)} ms | ${w.result ?? 'base held'} after ${(ticks / TICK_HZ).toFixed(0)} s`);
}

// ------------------------------------------------------------------ combat sandbox
function arena(hs: string, rs: string, trials = 5): void {
  const parse = (x: string) => x.split(',').filter(Boolean).map((p) => { const [k, n] = p.split(':'); return [k, +n] as [string, number]; });
  const H = parse(hs), R = parse(rs);
  let hw = 0, sh = 0, sr = 0, st = 0;
  for (let tr = 0; tr < trials; tr++) {
    const w = new World(64, 64, { mode: 'skirmish', difficulty: 'veteran', seed: 100 + tr, mapSize: 64 });
    w.rebuildWalk(); w.flags.noHqDefeat = true; w.revealAll = true; w.axiom.enabled = false;
    let i = 0;
    for (const [k, n] of H) for (let j = 0; j < n; j++, i++) setOrder(w.spawnUnit(k, HUMAN, 20 + (i % 6) * 0.9, 26 + Math.floor(i / 6) * 0.9), { type: 'amove', x: 44, y: 30 });
    i = 0;
    for (const [k, n] of R) for (let j = 0; j < n; j++, i++) setOrder(w.spawnUnit(k, AXIOM, 44 + (i % 6) * 0.9, 26 + Math.floor(i / 6) * 0.9), { type: 'amove', x: 20, y: 30 });
    const alive = (team: number) => w.entities.filter((e) => e.alive && e.team === team && e.isUnit).length;
    for (let t = 0; t < 180 * TICK_HZ && alive(HUMAN) && alive(AXIOM); t++) { step(w); w.events.length = 0; }
    if (alive(HUMAN) && !alive(AXIOM)) hw++;
    sh += alive(HUMAN); sr += alive(AXIOM); st += w.time;
  }
  const cost = (L: [string, number][], f: (k: string) => number) => L.reduce((a, [k, n]) => a + f(k) * n, 0);
  console.log(`${hs} (${cost(H, (k) => UNITS[k].cost.scrap)} scrap) vs ${rs} (${cost(R, (k) => UNITS[k].compute ?? 0)} compute): humans win ${hw}/${trials}, survivors H ${(sh / trials).toFixed(1)} R ${(sr / trials).toFixed(1)}, ${(st / trials).toFixed(0)} s`);
}

async function main(): Promise<void> {
  if (args.includes('--stress')) { stress(+opt('stress', '900')); return; }
  if (args.includes('--arena')) { const i = args.indexOf('--arena'); arena(args[i + 1], args[i + 2], 5); return; }
  const jobsList: { seed: number; size: number; diff: Difficulty }[] = [];
  for (const diff of diffs) for (const size of sizes) for (let s = seed0; s < seed0 + seeds; s++) jobsList.push({ seed: s, size, diff });
  if (worker) {
    const r = runGame(seed0, sizes[0], diffs[0], level, minutes, false);
    process.stdout.write('@@RESULT ' + JSON.stringify(r) + '\n');
    return;
  }
  const results: GameResult[] = [];
  if (jobs <= 1 || jobsList.length === 1) {
    for (const j of jobsList) {
      const r = runGame(j.seed, j.size, j.diff, level, minutes, !quiet);
      results.push(r);
      console.log(line(r));
    }
  } else {
    const script = fileURLToPath(import.meta.url);
    let next = 0;
    await new Promise<void>((resolve) => {
      let running = 0;
      const launch = (): void => {
        while (running < jobs && next < jobsList.length) {
          const j = jobsList[next++];
          running++;
          const p = spawn(process.execPath, [...process.execArgv, script, '--worker', '--seed', String(j.seed), '--size', String(j.size), '--diff', j.diff,
            '--level', String(level), '--minutes', String(minutes), '--mode', mode, ...(noBot ? ['--nobot'] : []), ...(sets ? ['--set', sets] : [])], { stdio: ['ignore', 'pipe', 'inherit'] });
          let out = '';
          p.stdout.on('data', (d) => { out += d; });
          p.on('close', () => {
            const m = out.split('\n').find((l) => l.startsWith('@@RESULT '));
            if (m) { const r = JSON.parse(m.slice(9)) as GameResult; results.push(r); console.log(line(r)); }
            else console.log(`job ${j.diff} ${j.size} s${j.seed} failed`);
            running--;
            if (next >= jobsList.length && running === 0) resolve(); else launch();
          });
        }
      };
      launch();
    });
  }
  results.sort((a, b) => a.diff.localeCompare(b.diff) || a.size - b.size || a.seed - b.seed);
  if (results.length > 1) table(results);
  if (asJson) console.log(JSON.stringify(results));
  // --strict: CI gate — fail on any invariant error or crashed job
  if (args.includes('--strict')) {
    const errs = results.reduce((n, r) => n + r.errors, 0);
    if (errs > 0 || results.length < jobsList.length) {
      console.error(`STRICT: ${errs} invariant errors, ${jobsList.length - results.length} failed jobs`);
      process.exit(1);
    }
  }
}

void main();
