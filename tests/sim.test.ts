import { describe, expect, it } from 'vitest';
import { train } from '../src/sim/ai/axiom';
import { Bot } from '../src/sim/bot';
import { UNITS } from '../src/sim/data/defs';
import { generateWorld } from '../src/sim/mapgen';
import { step } from '../src/sim/step';
import { applyDamage, damageMul, die, forget } from '../src/sim/systems/combat';
import { fieldTo } from '../src/sim/systems/field';
import { completeResearch } from '../src/sim/systems/economy';
import { ECON, hackEligible, setOrder } from '../src/sim/systems/units';
import { AXIOM, DT, HUMAN, TICK_HZ } from '../src/sim/types';
import { World, type Command, type Entity } from '../src/sim/world';

// ---------------------------------------------------------------------------- helpers

/** Flat, fully open test map. AXIOM's director is off unless a test turns it on. */
function flatWorld(size = 40, seed = 1): World {
  const w = new World(size, size, { mode: 'skirmish', difficulty: 'veteran', seed, mapSize: size });
  w.rebuildWalk();
  w.flags.noHqDefeat = true;
  w.axiom.enabled = false;
  w.revealAll = true;
  w.explored.fill(1);
  return w;
}

function run(w: World, seconds: number, each?: () => void): void {
  const n = Math.round(seconds * TICK_HZ);
  for (let i = 0; i < n && !w.result; i++) {
    each?.();
    step(w);
    w.events.length = 0;
  }
}

function runUntil(w: World, maxSeconds: number, done: () => boolean): number {
  const n = Math.round(maxSeconds * TICK_HZ);
  for (let i = 0; i < n; i++) {
    if (done()) return i * DT;
    step(w);
    w.events.length = 0;
  }
  return done() ? maxSeconds : -1;
}

function cmd(w: World, c: Command): void { w.commands.push(c); }

/** Order-independent digest of everything that matters in the world state. */
function stateHash(w: World): string {
  let h = 2166136261 >>> 0;
  const mix = (v: number) => {
    const s = Math.round(v * 1000);
    h = Math.imul(h ^ (s & 0xffff), 16777619) >>> 0;
    h = Math.imul(h ^ (s >>> 16), 16777619) >>> 0;
  };
  for (const e of w.entities) {
    if (!e.alive) continue;
    mix(e.id); mix(e.team); mix(e.x); mix(e.y); mix(e.hp); mix(e.amount); mix(e.progress);
    mix(e.kind.length + e.kind.charCodeAt(0));
  }
  mix(w.human.scrap); mix(w.human.data); mix(w.axiom.compute); mix(w.axiom.surgePool); mix(w.axiom.surgeN);
  for (const k of ['kinetic', 'energy', 'explosive'] as const) { mix(w.axiom.resist[k]); mix(w.axiom.vuln[k]); }
  mix(w.rng.s);
  return `${w.tick}:${w.entities.length}:${h.toString(16)}`;
}

// ---------------------------------------------------------------------------- damage & Overfit

describe('damage formula', () => {
  it('applies type-vs-armor, Overfit resist/vuln and research multipliers', () => {
    const w = flatWorld();
    const gunner = w.spawnUnit('gunner', AXIOM, 10, 10); // light
    const brute = w.spawnUnit('brute', AXIOM, 12, 10); // armored
    const relay = w.spawnBuilding('relay', AXIOM, 20, 20); // structure
    expect(damageMul(w, HUMAN, 'kinetic', gunner)).toBeCloseTo(1.0);
    expect(damageMul(w, HUMAN, 'kinetic', brute)).toBeCloseTo(0.6);
    expect(damageMul(w, HUMAN, 'explosive', relay)).toBeCloseTo(1.5);
    expect(damageMul(w, HUMAN, 'energy', gunner)).toBeCloseTo(1.15);

    // finalDamage = base × typeVsArmor × (1 − resist + vuln)
    w.axiom.resist.kinetic = 0.3;
    w.axiom.vuln.kinetic = 0.1;
    expect(damageMul(w, HUMAN, 'kinetic', gunner)).toBeCloseTo(0.8);
    expect(damageMul(w, HUMAN, 'kinetic', brute)).toBeCloseTo(0.6 * 0.8);

    // research multiplies the human side
    completeResearch(w, 'kinetic1');
    expect(w.human.dmgMul.kinetic).toBeCloseTo(1.2);
    expect(damageMul(w, HUMAN, 'kinetic', gunner)).toBeCloseTo(1.2 * 0.8);
    completeResearch(w, 'kinetic2');
    expect(damageMul(w, HUMAN, 'kinetic', gunner)).toBeCloseTo(1.4 * 0.8);

    // the model multiplier is clamped at 0.1
    w.axiom.resist.energy = 1.5;
    expect(damageMul(w, HUMAN, 'energy', gunner)).toBeCloseTo(1.15 * 0.1);
  });

  it('only AXIOM targets use the model; robots hitting humans ignore research', () => {
    const w = flatWorld();
    const rifle = w.spawnUnit('rifleman', HUMAN, 10, 10);
    w.axiom.resist.kinetic = 0.5;
    completeResearch(w, 'kinetic1');
    expect(damageMul(w, AXIOM, 'kinetic', rifle)).toBeCloseTo(1.0);
    expect(damageMul(w, AXIOM, 'explosive', rifle)).toBeCloseTo(0.7);
  });

  it('records damage taken by type for the next epoch and kills at 0 hp', () => {
    const w = flatWorld();
    const sk = w.spawnUnit('skitter', AXIOM, 10, 10);
    applyDamage(w, sk, 15, 'energy', HUMAN, 0);
    expect(w.axiom.dmgTaken.energy).toBe(15);
    expect(sk.hp).toBe(UNITS.skitter.hp - 15);
    applyDamage(w, sk, 100, 'kinetic', HUMAN, 0);
    expect(sk.alive).toBe(false);
    // a wreck is left behind and Data is awarded
    expect(w.entities.some((e) => e.cat === 'wreck' && e.alive)).toBe(true);
    expect(w.human.data).toBe(UNITS.skitter.dataValue);
  });
});

describe('Overfit epochs', () => {
  it('trains resistance to the top damage type and opens the counter vulnerability', () => {
    const w = flatWorld();
    const A = w.axiom;
    A.dmgTaken = { kinetic: 1000, energy: 200, explosive: 50 };
    train(w);
    expect(A.lastAdapt).toBe('kinetic');
    expect(A.resist.kinetic).toBeCloseTo(0.15); // dominant share (> 75%) → +15%
    expect(A.vuln.energy).toBeCloseTo(0.1); // kinetic → energy is the counter
    expect(A.resist.energy).toBe(0);
    expect(A.dmgTaken.kinetic).toBeCloseTo(250); // memory decays

    // explosive dominates next → resist explosive, vulnerable to kinetic
    A.dmgTaken = { kinetic: 0, energy: 0, explosive: 900 };
    train(w);
    expect(A.lastAdapt).toBe('explosive');
    expect(A.resist.explosive).toBeGreaterThan(0);
    expect(A.vuln.kinetic).toBeGreaterThan(0);
  });

  it('caps resistance at 60% and vulnerability at 40%, and ignores quiet epochs', () => {
    const w = flatWorld();
    const A = w.axiom;
    for (let i = 0; i < 12; i++) { A.dmgTaken = { kinetic: 0, energy: 2000, explosive: 0 }; train(w); }
    expect(A.resist.energy).toBeCloseTo(0.6);
    expect(A.vuln.explosive).toBeCloseTo(0.4);
    const before = { ...A.resist };
    A.dmgTaken = { kinetic: 40, energy: 30, explosive: 20 }; // < 150 total
    train(w);
    expect(A.resist).toEqual(before);
  });

  it('catastrophic forgetting halves every adaptation (and a Data Vault kill triggers it)', () => {
    const w = flatWorld();
    const A = w.axiom;
    A.resist = { kinetic: 0.5, energy: 0.3, explosive: 0 };
    A.vuln = { kinetic: 0, energy: 0.2, explosive: 0.4 };
    forget(w);
    expect(A.resist).toEqual({ kinetic: 0.25, energy: 0.15, explosive: 0 });
    expect(A.vuln).toEqual({ kinetic: 0, energy: 0.1, explosive: 0.2 });

    const vault = w.spawnBuilding('vault', AXIOM, 10, 10);
    const data0 = w.human.data;
    die(w, vault, HUMAN);
    expect(A.resist.kinetic).toBeCloseTo(0.13); // 0.25 → 0.125, rounded to whole percent
    expect(w.human.data).toBeGreaterThan(data0);
  });
});

// ---------------------------------------------------------------------------- hacking

describe('hacking', () => {
  it('eligibility: below 50% HP or stunned; never bosses or healthy robots', () => {
    const w = flatWorld();
    const g = w.spawnUnit('gunner', AXIOM, 10, 10);
    expect(hackEligible(w, g)).toBe(false);
    g.hp = g.maxHp * 0.49;
    expect(hackEligible(w, g)).toBe(true);
    const b = w.spawnUnit('brute', AXIOM, 14, 10);
    b.stunUntil = w.time + 3;
    expect(hackEligible(w, b)).toBe(true);
    const boss = w.spawnUnit('colossus', AXIOM, 20, 20);
    boss.hp = 10;
    boss.stunUntil = w.time + 3;
    expect(hackEligible(w, boss)).toBe(false);
    const rifle = w.spawnUnit('rifleman', HUMAN, 5, 5);
    rifle.hp = 1;
    expect(hackEligible(w, rifle)).toBe(false);
  });

  it('a Netrunner converts a weakened robot, which reverts when the Netrunner dies', () => {
    const w = flatWorld();
    w.spawnBuilding('hq', HUMAN, 2, 2);
    const nr = w.spawnUnit('netrunner', HUMAN, 10, 10);
    const g = w.spawnUnit('gunner', AXIOM, 13, 10);
    g.hp = g.maxHp * 0.3;
    g.stunUntil = 999; // keep it from shooting back during the channel
    cmd(w, { c: 'order', ids: [nr.id], order: { type: 'hack', id: g.id } });
    const t = runUntil(w, 6, () => g.hacked);
    expect(t).toBeGreaterThan(w.human.hackTime - 0.2);
    expect(g.team).toBe(HUMAN);
    expect(g.hackedBy).toBe(nr.id);
    expect(nr.links).toContain(g.id);
    expect(g.hp).toBeCloseTo(UNITS.gunner.hp * 0.55); // healed 25%
    expect(w.human.stats.hacked).toBe(1);

    die(w, nr, AXIOM);
    expect(g.alive).toBe(true);
    expect(g.hacked).toBe(false);
    expect(g.team).toBe(AXIOM);
  });

  it('respects Netrunner bandwidth', () => {
    const w = flatWorld();
    w.spawnBuilding('hq', HUMAN, 2, 2);
    const nr = w.spawnUnit('netrunner', HUMAN, 10, 10);
    const bots: Entity[] = [];
    // spread out so freshly hacked (melee) skitters don't maul the next victim
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2;
      const g = w.spawnUnit('skitter', AXIOM, 10 + Math.cos(a) * 3.5, 10 + Math.sin(a) * 3.5);
      g.stunUntil = 999;
      bots.push(g);
    }
    for (const g of bots) {
      cmd(w, { c: 'order', ids: [nr.id], order: { type: 'hack', id: g.id } });
      step(w);
      runUntil(w, 6, () => g.hacked || nr.order === null);
    }
    expect(bots.filter((g) => g.hacked).length).toBe(w.human.bandwidth);
    expect(bots[3].alive && !bots[3].hacked).toBe(true);
  });
});

// ---------------------------------------------------------------------------- economy

describe('construction', () => {
  function buildWith(n: number): { w: World; site: Entity } {
    const w = flatWorld();
    w.spawnBuilding('hq', HUMAN, 2, 2);
    w.human.scrap = 1000;
    const engs: Entity[] = [];
    for (let i = 0; i < n; i++) engs.push(w.spawnUnit('engineer', HUMAN, 19.5 + i, 18.6));
    cmd(w, { c: 'place', kind: 'barracks', tx: 19, ty: 19, builders: engs.map((e) => e.id) });
    step(w);
    const site = w.entities.find((e) => e.kind === 'barracks')!;
    return { w, site };
  }

  it('progress scales with the number of builders (diminishing) and completes', () => {
    const one = buildWith(1), three = buildWith(3);
    expect(one.site.built).toBe(false);
    expect(one.w.human.scrap).toBe(1000 - 150);
    run(one.w, 8);
    run(three.w, 8);
    const ratio = three.site.progress / one.site.progress;
    expect(ratio).toBeGreaterThan(1.8);
    expect(ratio).toBeLessThan(3); // builders^0.75, not linear
    expect(runUntil(three.w, 30, () => three.site.built)).toBeGreaterThan(0);
    expect(three.site.hp).toBeGreaterThan(three.site.maxHp * 0.9);
    // finished builders go back to work instead of idling
    expect(three.w.entities.filter((e) => e.kind === 'engineer' && e.order?.type === 'build').length).toBe(0);
  });
});

describe('production queue & pop cap', () => {
  it('queues units, spends scrap, trains in order and enforces the pop cap', () => {
    const w = flatWorld();
    const hq = w.spawnBuilding('hq', HUMAN, 2, 2); // +10 pop
    const bar = w.spawnBuilding('barracks', HUMAN, 20, 20);
    w.spawnBuilding('generator', HUMAN, 30, 30);
    for (let i = 0; i < 7; i++) w.spawnUnit('engineer', HUMAN, 8 + i, 8);
    w.human.scrap = 1000;
    step(w); // economy computes pop/popCap
    expect(w.human.popCap).toBe(10);
    expect(w.human.pop).toBe(7);
    for (let i = 0; i < 4; i++) cmd(w, { c: 'train', building: bar.id, kind: 'rifleman' });
    step(w);
    expect(bar.prod.length).toBe(3); // 7 + 3 = cap; the 4th is refused
    expect(w.human.scrap).toBe(1000 - 3 * 60);
    expect(w.human.pop).toBe(10);
    run(w, UNITS.rifleman.buildTime + 0.5);
    expect(w.entities.filter((e) => e.kind === 'rifleman').length).toBe(1);
    expect(bar.prod.length).toBe(2);
    run(w, 2 * UNITS.rifleman.buildTime + 0.5);
    expect(w.entities.filter((e) => e.kind === 'rifleman').length).toBe(3);
    // a Habitat raises the cap
    w.spawnBuilding('habitat', HUMAN, 25, 5);
    step(w);
    expect(w.human.popCap).toBe(18);
    cmd(w, { c: 'train', building: hq.id, kind: 'engineer' });
    step(w);
    expect(hq.prod.length).toBe(1);
  });

  it('cancelling refunds scrap', () => {
    const w = flatWorld();
    w.spawnBuilding('hq', HUMAN, 2, 2);
    const bar = w.spawnBuilding('barracks', HUMAN, 20, 20);
    w.human.scrap = 500;
    step(w); // economy computes the pop cap
    cmd(w, { c: 'train', building: bar.id, kind: 'rocketeer' });
    step(w);
    expect(w.human.scrap).toBe(400);
    cmd(w, { c: 'cancelTrain', building: bar.id, index: 0 });
    step(w);
    expect(w.human.scrap).toBe(500);
    expect(bar.prod.length).toBe(0);
  });
});

describe('harvest / deposit loop', () => {
  it('an Engineer gathers a load, carries it to the HQ and goes back for more', () => {
    const w = flatWorld();
    w.spawnBuilding('hq', HUMAN, 4, 4);
    const node = w.spawnResource('scrap', 16.5, 6.5, 100);
    const eng = w.spawnUnit('engineer', HUMAN, 9, 6);
    w.human.scrap = 0;
    cmd(w, { c: 'order', ids: [eng.id], order: { type: 'harvest', id: node.id } });
    const t1 = runUntil(w, 30, () => w.human.scrap >= ECON.carry);
    expect(t1).toBeGreaterThan(0);
    expect(w.human.stats.scrapGathered).toBe(ECON.carry);
    expect(node.amount).toBeLessThanOrEqual(100 - ECON.carry);
    // keeps cycling
    expect(runUntil(w, 30, () => w.human.scrap >= 3 * ECON.carry)).toBeGreaterThan(0);
    expect(eng.order?.type).toBe('harvest');
    // depleting the node removes it
    expect(runUntil(w, 200, () => !node.alive)).toBeGreaterThan(0);
    run(w, 10);
    expect(w.human.scrap).toBe(100);
  });

  it('wrecks harvest faster and decay', () => {
    const w = flatWorld();
    const wreck = w.spawnResource('wreck', 10, 10, 30);
    expect(wreck.expire).toBeCloseTo(w.time + 45);
    run(w, 47); // expiry is checked once per second
    expect(wreck.alive).toBe(false);
  });
});

// ---------------------------------------------------------------------------- siege flow field

describe('siege flow field', () => {
  it('robots break through a wall ring that fully encloses the base', () => {
    const w = flatWorld(48);
    const hq = w.spawnBuilding('hq', HUMAN, 22, 22); // tiles 22..25
    // closed ring of walls at Chebyshev radius 6 around the HQ footprint
    const walls: Entity[] = [];
    for (let y = 16; y <= 31; y++) for (let x = 16; x <= 31; x++) {
      if (x === 16 || x === 31 || y === 16 || y === 31) walls.push(w.spawnBuilding('wall', HUMAN, x, y));
    }
    const robots: Entity[] = [];
    for (let i = 0; i < 12; i++) {
      const r = w.spawnUnit(i % 3 ? 'skitter' : 'brute', AXIOM, 3 + (i % 4), 3 + Math.floor(i / 4));
      setOrder(r, { type: 'flow', field: 'human', tx: hq.x, ty: hq.y });
      robots.push(r);
    }
    step(w);
    const f = w.fields.get('human')!;
    // siege mode: the outside is still "reachable" (through the walls)
    expect(f.dist[3 * w.w + 3]).toBeLessThan(Infinity);
    run(w, 40);
    const damaged = walls.filter((b) => !b.alive || b.hp < b.maxHp);
    expect(damaged.length).toBeGreaterThan(0);
    // nobody is wandering around the far corner: they went to the wall line
    const alive = robots.filter((r) => r.alive);
    for (const r of alive) expect(Math.hypot(r.x - hq.x, r.y - hq.y)).toBeLessThan(14);
    // keep going: a breach opens and robots reach the HQ
    run(w, 120);
    expect(walls.some((b) => !b.alive)).toBe(true);
    expect(hq.hp < hq.maxHp || !hq.alive).toBe(true);
  });
});

// ---------------------------------------------------------------------------- movement regressions

describe('movement', () => {
  it('big units fit through a 1-tile alley', () => {
    const w = flatWorld(40);
    // a ruin wall across the map with a single 1-tile gap at x=20
    for (let x = 0; x < 40; x++) if (x !== 20) { w.terrain[20 * 40 + x] = 4; }
    w.rebuildWalk();
    w.spawnBuilding('hq', HUMAN, 2, 30);
    const brute = w.spawnUnit('brute', AXIOM, 20.5, 10.5);
    const tank = w.spawnUnit('bulldog', HUMAN, 10.5, 10.5);
    setOrder(brute, { type: 'move', x: 20.5, y: 30.5 });
    setOrder(tank, { type: 'move', x: 30.5, y: 30.5 });
    run(w, 25);
    expect(brute.y).toBeGreaterThan(25);
    expect(tank.y).toBeGreaterThan(25);
  });

  it('a unit inside a building footprint escapes even while idle', () => {
    const w = flatWorld(30);
    w.spawnBuilding('barracks', HUMAN, 10, 10);
    const u = w.spawnUnit('gunner', AXIOM, 11.5, 11.5);
    setOrder(u, { type: 'guard', x: 11.5, y: 11.5 });
    run(w, 1);
    expect(w.isWalkableTile(Math.floor(u.x), Math.floor(u.y))).toBe(true);
  });

  it('melee robots reach and hit buildings instead of stopping just short', () => {
    const w = flatWorld(30);
    const depot = w.spawnBuilding('depot', HUMAN, 15, 15);
    w.spawnBuilding('hq', HUMAN, 2, 2);
    const sk = w.spawnUnit('skitter', AXIOM, 16, 11);
    setOrder(sk, { type: 'attack', id: depot.id });
    run(w, 8);
    expect(depot.hp).toBeLessThan(depot.maxHp);
  });

  it('raiders whose target dies press on instead of idling at the ruins', () => {
    const w = flatWorld(48);
    w.spawnBuilding('hq', HUMAN, 30, 30);
    const shed = w.spawnBuilding('generator', HUMAN, 8, 8);
    const sk = w.spawnUnit('skitter', AXIOM, 4, 4);
    step(w);
    // a raid field keyed to the generator, as AXIOM's raid() creates
    const key = 'raid:' + shed.id;
    fieldTo(w, key, [8 * 48 + 8, 8 * 48 + 9, 9 * 48 + 8, 9 * 48 + 9]);
    setOrder(sk, { type: 'flow', field: key, tx: shed.x, ty: shed.y });
    run(w, 3);
    expect(w.fields.has(key)).toBe(true); // kept while its raiders use it
    expect(Math.hypot(sk.x - shed.x, sk.y - shed.y)).toBeLessThan(Math.hypot(4 - shed.x, 4 - shed.y));
    run(w, 1);
    shed.hp = 1;
    run(w, 20);
    expect(shed.alive).toBe(false);
    run(w, 25);
    expect(Math.hypot(sk.x - 32, sk.y - 32)).toBeLessThan(8);
  });
});

// ---------------------------------------------------------------------------- determinism

describe('determinism', () => {
  function simulate(seed: number, ticks: number): string {
    const w = generateWorld({ mode: 'skirmish', difficulty: 'veteran', seed, mapSize: 64 });
    const bot = new Bot(2);
    for (let i = 0; i < ticks; i++) {
      bot.think(w);
      step(w);
      w.events.length = 0;
    }
    return stateHash(w);
  }

  it('same seed + same commands → identical state', () => {
    const a = simulate(7, 20 * 120);
    const b = simulate(7, 20 * 120);
    expect(a).toBe(b);
    const c = simulate(8, 20 * 120);
    expect(c).not.toBe(a);
  });
});

// ---------------------------------------------------------------------------- bot smoke test

describe('scripted bot', () => {
  it('builds an economy and a defence and holds the first Surge (Veteran)', () => {
    const w = generateWorld({ mode: 'skirmish', difficulty: 'veteran', seed: 3, mapSize: 96 });
    const bot = new Bot(2);
    for (let i = 0; i < 4 * 60 * TICK_HZ && !w.result; i++) {
      bot.think(w);
      step(w);
      w.events.length = 0;
    }
    expect(w.result).toBeNull();
    const mine = w.entities.filter((e) => e.alive && e.team === HUMAN);
    expect(mine.filter((e) => e.kind === 'engineer').length).toBeGreaterThanOrEqual(12);
    expect(mine.filter((e) => e.kind === 'barracks' && e.built).length).toBeGreaterThanOrEqual(1);
    expect(mine.filter((e) => e.bdef?.weapon && e.built).length).toBeGreaterThanOrEqual(2);
    expect(w.human.stats.surgesSurvived).toBeGreaterThanOrEqual(1);
    // engineers are working, not idling
    expect(mine.filter((e) => e.kind === 'engineer' && !e.order).length).toBeLessThanOrEqual(2);
  });
});
