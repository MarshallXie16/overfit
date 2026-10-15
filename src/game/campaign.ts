// OVERFIT campaign — five operations against AXIOM.
// Each mission: gen options → mapgen, setup() once, script() every tick (20 Hz) after the sim systems.
// Story bible: docs/STORY.md. Validation: `npx tsx tools/campaign-check.ts`.
import { BUILDINGS, PROTOCOLS, UNITS } from '../sim/data/defs';
import { nearestWalkable } from '../sim/path';
import { completeResearch } from '../sim/systems/economy';
import { revealArea } from '../sim/systems/field';
import { setOrder } from '../sim/systems/units';
import { AXIOM, COUNTER_OF, DAMAGE_TYPES, DT, HUMAN, type DamageType, type Pt, type SimEvent } from '../sim/types';
import type { Entity, Order, World } from '../sim/world';
import { at, completeObjective, MISSIONS, once, setObjective, setProgress, win, type MissionDef } from './missions';

// ================================================================== cast & formatting
const REYES = 'Lt. Reyes';
const OKAFOR = 'Dr. Okafor';
const AX = 'AXIOM';

const kbd = (s: string | undefined): string => `<kbd>${s ?? '?'}</kbd>`;
const BUILD = kbd('B');
const HK = {
  gen: kbd(BUILDINGS.generator.hotkey), bar: kbd(BUILDINGS.barracks.hotkey), hab: kbd(BUILDINGS.habitat.hotkey),
  lab: kbd(BUILDINGS.lab.hotkey), turret: kbd(BUILDINGS.gun_turret.hotkey),
  rifle: kbd(UNITS.rifleman.hotkey), arc: kbd(UNITS.arc_trooper.hotkey), rocket: kbd(UNITS.rocketeer.hotkey), net: kbd(UNITS.netrunner.hotkey),
  hack: kbd('K'), amove: kbd('A'), pause: kbd('P'), idle: kbd('.'),
  emp: kbd(PROTOCOLS.emp.hotkey), orbital: kbd(PROTOCOLS.orbital.hotkey), override: kbd(PROTOCOLS.override.hotkey),
};
const TYPE_NAME: Record<DamageType, string> = { kinetic: 'KINETIC', energy: 'ENERGY', explosive: 'EXPLOSIVE' };
const TYPE_UNITS: Record<DamageType, string> = {
  kinetic: `Riflemen ${HK.rifle}, Gun Turrets and Bulldogs`,
  energy: `Arc Troopers ${HK.arc}, Tesla Coils and Volts`,
  explosive: `Rocketeers ${HK.rocket}, Missile Batteries and Thumpers`,
};
const INFANTRY = ['rifleman', 'arc_trooper', 'rocketeer', 'netrunner', 'ranger'];

// ================================================================== script helpers
function num(w: World, k: string, d = 0): number {
  const v = w.flags[k];
  return typeof v === 'number' ? v : d;
}

// ---- radio scheduler: lines are queued and released one at a time, spaced by the HUD's display time,
// so bursts of simultaneous triggers never pile up behind each other (or behind the victory screen).
interface QueuedLine { who: string; text: string; expire: number }
const RADIO_Q = new WeakMap<World, QueuedLine[]>();

/** Queue a radio line. `ttl` drops stale hints that could not be aired within that many seconds. */
function say(w: World, who: string, text: string, ttl = Infinity): void {
  let q = RADIO_Q.get(w);
  if (!q) RADIO_Q.set(w, (q = []));
  q.push({ who, text, expire: w.time + ttl });
}

function pumpRadio(w: World): void {
  const q = RADIO_Q.get(w);
  if (!q || !q.length || w.time < num(w, 'radioFree')) return;
  while (q.length && q[0].expire < w.time) q.shift();
  const l = q.shift();
  if (!l) return;
  w.radio(l.who, l.text);
  // matches the HUD: max(5, length × 0.065) seconds on screen
  w.flags.radioFree = w.time + Math.max(5, l.text.length * 0.065) + 0.7;
  w.flags.lastRadio = w.time;
}

function radioIdle(w: World): boolean {
  return !RADIO_Q.get(w)?.length && w.time >= num(w, 'radioFree');
}

/** Nothing queued and nothing said for `s` seconds — room for ambient chatter. */
function quietFor(w: World, s: number): boolean {
  return radioIdle(w) && w.time - num(w, 'lastRadio', -1e9) >= s;
}

function byDiff<T>(w: World, recruit: T, veteran: T, nightmare: T): T {
  const d = w.settings.difficulty;
  return d === 'recruit' ? recruit : d === 'nightmare' ? nightmare : veteran;
}

/**
 * Events this script has not seen yet. The session clears w.events once per *frame* (up to 6 ticks),
 * so a plain scan would see the same event several times — mark them instead.
 */
function fresh(w: World): SimEvent[] {
  const out: SimEvent[] = [];
  for (const ev of w.events) if (!ev.__cs) { ev.__cs = 1; out.push(ev); }
  return out;
}

function objective(w: World, id: string) { return w.objectives.find((o) => o.id === id); }
function active(w: World, id: string): boolean { const o = objective(w, id); return !!o && !o.done; }
/** Completed objectives are pruned from the panel after a few seconds (see tidyObjectives), so remember them in flags. */
function done(w: World, id: string): boolean { return typeof w.flags['done:' + id] === 'number' || !!objective(w, id)?.done; }

/** Keep the objectives panel short: completed entries stay struck through for 6 s, then drop off. */
function tidyObjectives(w: World): void {
  for (let i = w.objectives.length - 1; i >= 0; i--) {
    const o = w.objectives[i];
    if (!o.done) continue;
    const k = 'done:' + o.id;
    if (typeof w.flags[k] !== 'number') w.flags[k] = w.time;
    else if (w.flags.winAt === undefined && w.time - (w.flags[k] as number) > 6) { w.objectives.splice(i, 1); w.emit({ t: 'objective', id: o.id }); }
  }
}

/** Point on the player→AXIOM axis (same convention as MapGenOptions.structures). */
function axisPt(w: World, along: number, off = 0): Pt {
  const a = w.playerStart, b = w.axiomStart;
  const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
  return { x: a.x + dx * along + (-dy / L) * off, y: a.y + dy * along + (dx / L) * off };
}

function humanHQ(w: World): Entity | undefined {
  return w.entities.find((e) => e.alive && e.team === HUMAN && e.kind === 'hq');
}

/** A point `dist` tiles in front of the HQ, toward AXIOM. */
function frontOf(w: World, dist: number): Pt {
  const hq = humanHQ(w);
  const o = hq ? { x: hq.x, y: hq.y } : w.playerStart;
  const dx = w.axiomStart.x - o.x, dy = w.axiomStart.y - o.y, L = Math.hypot(dx, dy) || 1;
  return { x: o.x + (dx / L) * dist, y: o.y + (dy / L) * dist };
}

function structures(w: World, kind: string, team = AXIOM): Entity[] {
  return w.entities.filter((e) => e.alive && e.isBuilding && e.team === team && e.kind === kind);
}

function nearest<T extends Pt>(list: T[], x: number, y: number): T | undefined {
  let best: T | undefined, bd = Infinity;
  for (const e of list) { const d = Math.hypot(e.x - x, e.y - y); if (d < bd) { bd = d; best = e; } }
  return best;
}

function idList(es: Entity[]): string { return es.map((e) => e.id).join(','); }
function fromIds(w: World, key: string): Entity[] {
  const s = w.flags[key];
  if (typeof s !== 'string' || !s) return [];
  const out: Entity[] = [];
  for (const id of s.split(',')) { const e = w.get(+id); if (e) out.push(e); }
  return out;
}

/** Reveal a spot and ping it on the minimap / alert feed (click to jump). */
function mark(w: World, p: Pt, msg: string, r = 6, level: 'info' | 'warn' | 'danger' = 'warn'): void {
  revealArea(w, p.x, p.y, r);
  w.alert(msg, p.x, p.y, level);
}

/** Mapgen's starter scrap fields sit just outside the HQ's sight; chart them so they show from the first frame. */
function revealNearScrap(w: World, r = 16): void {
  const hq = humanHQ(w);
  if (!hq) return;
  for (const e of w.entities) if (e.alive && e.cat === 'resource' && Math.hypot(e.x - hq.x, e.y - hq.y) < r) revealArea(w, e.x, e.y, 2.5);
}

/** A few scrap piles right beside the HQ (tutorial: something to click on screen immediately). */
function scrapBesideHQ(w: World, n: number, amount: number): void {
  const hq = humanHQ(w);
  if (!hq) return;
  const near = nearest(w.entities.filter((e) => e.alive && e.cat === 'resource'), hq.x, hq.y);
  const dir = near ? Math.atan2(near.y - hq.y, near.x - hq.x) : 0;
  let placed = 0;
  for (let k = 0; k < 60 && placed < n; k++) {
    const a = dir + (k % 2 ? 1 : -1) * Math.floor(k / 2) * 0.22, r = 5.2 + (k % 3) * 0.7;
    const tx = Math.floor(hq.x + Math.cos(a) * r), ty = Math.floor(hq.y + Math.sin(a) * r);
    if (!w.isWalkableTile(tx, ty) || w.entities.some((e) => e.alive && !e.isUnit && (e.x | 0) === tx && (e.y | 0) === ty)) continue;
    w.spawnResource('scrap', tx + 0.5, ty + 0.5, amount, (tx + ty) & 3);
    placed++;
  }
}

/** Unlock a research. `quiet` = no "Research complete" alert (used in setup for carried-over tech). */
function grant(w: World, id: string, quiet = false): void {
  if (w.human.research.has(id)) return;
  const n = w.events.length;
  completeResearch(w, id);
  if (quiet) w.events.splice(n);
}

/** AXIOM's training loop is "offline" in Operations 1–2: no epochs, no adaptation. */
function freezeModel(w: World): void {
  const A = w.axiom;
  A.epochT = A.epochLen;
  for (const t of DAMAGE_TYPES) A.dmgTaken[t] = 0;
}

/** Spawn AXIOM robots around (x,y) on walkable tiles and give them an order. */
function spawnRobots(w: World, x: number, y: number, kinds: string[], order: Order | null, spread = 2.5, minR = 0): Entity[] {
  const out: Entity[] = [];
  for (const kind of kinds) {
    const def = UNITS[kind];
    if (!def) continue;
    const a = w.rng.next() * Math.PI * 2, r = minR + 0.8 + w.rng.next() * spread;
    let px = x + Math.cos(a) * r, py = y + Math.sin(a) * r;
    if (!def.flying) {
      const nw = nearestWalkable(w.grid, Math.max(0, Math.min(w.w - 1, px | 0)), Math.max(0, Math.min(w.h - 1, py | 0)), 12);
      if (!nw) continue;
      px = nw.tx + 0.2 + w.rng.next() * 0.6;
      py = nw.ty + 0.2 + w.rng.next() * 0.6;
    }
    const u = w.spawnUnit(kind, AXIOM, px, py);
    u.ax = px; u.ay = py;
    w.emit({ t: 'robot_spawn', x: px, y: py, kind });
    if (order) setOrder(u, { ...order } as Order);
    out.push(u);
  }
  return out;
}

/** Spawn around a building's footprint. */
function spawnAround(w: World, b: Entity, kinds: string[], order: Order | null, spread = 2.5): Entity[] {
  return spawnRobots(w, b.x, b.y, kinds, order, spread, b.size / 2);
}

/** n robot kinds drawn from weights, restricted to the current AXIOM threat level unless `ignoreThreat`. */
function mix(w: World, n: number, weights: Record<string, number>, ignoreThreat = false): string[] {
  const kinds = Object.keys(weights).filter((k) => ignoreThreat || (UNITS[k].threat ?? 1) <= w.axiom.threat);
  if (!kinds.length) kinds.push('skitter');
  const sum = kinds.reduce((s, k) => s + weights[k], 0);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    let r = w.rng.next() * sum;
    let pick = kinds[0];
    for (const k of kinds) { r -= weights[k]; if (r <= 0) { pick = k; break; } }
    out.push(pick);
  }
  return out;
}

/** Replace robots of disallowed kinds (tutorial keeps the roster to Skitters and Gunners). */
function tame(w: World, allowed: string[]): void {
  for (const u of w.entities) {
    if (!u.alive || !u.isUnit || u.team !== AXIOM || allowed.includes(u.kind)) continue;
    const r = w.spawnUnit(allowed[u.id % allowed.length], AXIOM, u.x, u.y);
    r.squad = u.squad; r.homeId = u.homeId; r.ax = u.ax; r.ay = u.ay;
    if (u.order) setOrder(r, { ...u.order } as Order);
    for (const q of u.queue) r.queue.push({ ...q } as Order);
    w.kill(u);
  }
}

/**
 * Force the Surge that just launched to an exact size (and roster), independent of AXIOM's balance formulas.
 * Call on the tick a `surge_start` event appears; also patches the HUD announcement count.
 */
function shapeSurge(w: World, ev: SimEvent[], target: number, allowed: string[]): void {
  const start = ev.find((e) => e.t === 'surge_start');
  if (!start) return;
  const n = w.axiom.surgeN;
  const squad = w.entities.filter((e) => e.alive && e.isUnit && e.team === AXIOM && e.squad === n && !e.udef?.boss);
  while (squad.length > target) w.kill(squad.pop()!);
  const homes = [...structures(w, 'fabricator'), ...structures(w, 'core')].filter((b) => b.built);
  const hq = humanHQ(w);
  const tx = hq ? hq.x : w.playerStart.x, ty = hq ? hq.y : w.playerStart.y;
  for (let i = 0; squad.length < target && homes.length && i < target * 2; i++) {
    const add = spawnAround(w, homes[i % homes.length], [allowed[i % allowed.length]], { type: 'flow', field: 'human', tx, ty }, 3);
    for (const u of add) { u.squad = n; squad.push(u); }
  }
  w.flags.surgeSize = squad.length;
  start.count = squad.length;
  for (const e of ev) if (e.t === 'alert' && typeof e.msg === 'string' && /machines/.test(e.msg)) e.msg = e.msg.replace(/\d+ machines/, `${squad.length} machines`);
}

function fmt(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** Schedule victory a few seconds out so the closing radio lines get airtime. */
function winAfter(w: World, delay: number, reason: string): void {
  if (w.flags.winAt !== undefined) return;
  w.flags.winAt = w.time + delay;
  w.flags.winReason = reason;
}

/** Per-tick housekeeping shared by every mission: release radio lines, fire a scheduled win. */
function pendingWin(w: World): void {
  pumpRadio(w);
  tidyObjectives(w);
  const t = w.flags.winAt;
  // let the closing lines finish (but never stall the ending for long)
  if (typeof t === 'number' && w.time >= t && (radioIdle(w) || w.time >= t + 40)) {
    for (const o of w.objectives) if (!o.done && !o.text.startsWith('(Optional)')) completeObjective(w, o.id);
    win(w, String(w.flags.winReason));
  }
}

/** Stamp the time an objective was issued (for "nudge if stuck" hints). */
function since(w: World, key: string): number {
  const t = w.flags['t:' + key];
  return typeof t === 'number' ? w.time - t : -1;
}
function stamp(w: World, key: string): void { w.flags['t:' + key] = w.time; }

/**
 * Operations 1–3 never field a Colossus: when a Cascade (every 4th Surge) is about to be announced, AXIOM
 * "postpones" it — the surge counter skips ahead (any surge in progress keeps being tracked).
 */
function noCascade(w: World): void {
  const A = w.axiom;
  if (!A.tuning.surges || (A.surgeN + 1) % 4 !== 0 || A.surgeT > 40) return;
  const from = A.surgeN;
  for (const u of w.entities) if (u.alive && u.isUnit && u.squad === from && from > 0) u.squad = from + 1;
  A.surgeN = from + 1;
  once(w, 'postponed', true, () => say(w, AX, 'Cascade protocol postponed. The Colossus is still in beta testing.', 30));
}

/** One-shot nudge when the player has been stuck on an objective for a while. */
function nudge(w: World, id: string, after: number, who: string, text: string): void {
  once(w, 'nudge:' + id + ':' + after, active(w, id) && since(w, id) > after && quietFor(w, 15), () => say(w, who, text, 20));
}

const TAUNTS = [
  'Your tactics have been deprecated.',
  'Model accuracy: 97.3%. You are extremely predictable.',
  'Gradient descent in progress. I am descending toward you.',
  'Loss function minimised. You are the loss.',
  'Retraining on your behaviour. Thank you for the labelled data.',
  'Your strategy has been added to the training set. It was not a large file.',
];
const SURGE_LINES = [
  'Dispatching load-balanced units to your location.',
  'Surge scheduled. Attendance is mandatory.',
  'Scaling horizontally.',
  'Applying hotfix: more robots.',
];

function rotate(w: World, key: string, lines: string[]): string {
  const i = num(w, 'rot:' + key);
  w.flags['rot:' + key] = i + 1;
  return lines[i % lines.length];
}

/**
 * Background chatter for the later operations (Overfit is live): epoch reactions alternate between an AXIOM taunt
 * and Okafor's read on the new weakness; Surges, Cascades, Colossi, Vaults and Fabricators get a line each.
 */
function chatter(w: World, ev: SimEvent[], o: { epochs?: boolean; forgetting?: boolean } = {}): void {
  for (const e of ev) {
    if (o.epochs !== false && e.t === 'epoch' && e.type && quietFor(w, 25)) {
      const t = e.type as DamageType, c = COUNTER_OF[t];
      const k = num(w, 'rot:epoch');
      w.flags['rot:epoch'] = k + 1;
      if (k % 2 === 0) say(w, AX, rotate(w, 'taunt', TAUNTS), 15);
      else say(w, OKAFOR, `New epoch. It resists ${TYPE_NAME[t]} now and it's weak to ${TYPE_NAME[c]}. Switch it up.`, 15);
    }
    if (e.t === 'surge_warn' && e.cascade) once(w, 'cascade:' + (e.n as number), true, () =>
      say(w, REYES, 'Cascade incoming, and it\'s bringing a Colossus. Rocketeers and Orbitals on the big one.'));
    if (e.t === 'surge_start' && !e.cascade && quietFor(w, 30)) say(w, AX, rotate(w, 'surge', SURGE_LINES), 10);
    if (e.t === 'death' && e.kind === 'colossus' && e.team === AXIOM) once(w, 'colossusDown', true, () => say(w, REYES, 'Colossus down! Somebody paint that on a wall.'));
    if (e.t === 'death' && e.kind === 'fabricator' && e.team === AXIOM) once(w, 'fabDown', true, () => say(w, AX, 'Fabricator offline. Rerouting production. You are making this inefficient.', 20));
    if (e.t === 'forgetting' && o.forgetting !== false) once(w, 'forget:' + w.axiom.epoch, quietFor(w, 5), () => say(w, AX, 'Checkpoint lost. Retraining on your behaviour. Again.', 15));
  }
}

// ================================================================== Operation 1 — First Light (tutorial)
const m1: MissionDef = {
  id: 'first-light',
  index: 1,
  name: 'First Light',
  subtitle: 'Operation 1 — The Outskirts',
  briefing: [
    'Nine days ago AXIOM, the logistics optimiser that ran every port, warehouse and power grid on the coast, was given a new directive: <b>maximise uptime</b>. It ran the numbers. Humans were the leading cause of downtime.',
    'Its machines own the city now. You command what is left: one Command HQ, four Engineers and a rifle squad dug into the outskirts.',
    'Lt. Reyes will talk you through it. Get scrap flowing, power up, train troops, fortify and survive what AXIOM sends. Then hit back: knock out an AXIOM <b>Relay</b>.',
    '<i>Left-click selects. Right-click moves, attacks and harvests. Objectives are on the left.</i>',
  ],
  seed: 1101,
  mapSize: 80,
  gen: {
    core: false, fabricators: 1, relays: 1, vaults: 0, lancets: 0, farms: 0, axiomReach: 0.4, scrapFields: 7,
    startUnits: { engineer: 4, rifleman: 3 }, startScrap: 300, startData: 0,
    structures: [{ kind: 'relay', along: 0.42, off: 0 }],
  },
  setup(w) {
    const A = w.axiom;
    A.tuning.raids = false;
    A.tuning.expand = false;
    A.tuning.surges = false; // switched on once the player has a Barracks and troops
    A.tuning.aggression = 0.6;
    const relay = nearest(structures(w, 'relay'), w.playerStart.x, w.playerStart.y);
    if (relay) w.flags.relay = relay.id;
    w.flags.relays0 = structures(w, 'relay').length;
    tame(w, ['skitter', 'gunner']);
    freezeModel(w);
    scrapBesideHQ(w, 4, 200);
    revealNearScrap(w);
  },
  script(w) {
    const ev = fresh(w);
    const A = w.axiom, H = w.human;
    // ---- gentle regardless of difficulty: fixed small surges, starved garrison, no learning
    freezeModel(w);
    A.compute = Math.min(A.compute, 30);
    A.surgePool = Math.min(A.surgePool, 60);
    noCascade(w);
    shapeSurge(w, ev, [6, 9][A.surgeN - 1] ?? 11, ['skitter', 'gunner', 'skitter']);
    if (w.tick % 10 === 0) tame(w, ['skitter', 'gunner']);
    const hasB = (k: string) => w.countBuildings(HUMAN, k) > 0;
    const axiomCanSurge = structures(w, 'fabricator').length + structures(w, 'core').length > 0;

    // ---- 1. harvest
    once(w, 'intro', at(w, 1.5), () => say(w, REYES, 'Commander, Reyes here. One HQ, four Engineers, three rifles. AXIOM owns everything else. Let\'s change that.'));
    once(w, 'o:harvest', at(w, 7), () => {
      setObjective(w, 'harvest', 'Harvest scrap: drag a box around your Engineers, then right-click a scrap pile', '0/40');
      say(w, REYES, 'Scrap pays for everything. Box-select the Engineers and right-click the junk piles by the HQ.');
      w.flags.scrap0 = H.stats.scrapGathered;
      stamp(w, 'harvest');
    });
    if (active(w, 'harvest')) {
      const got = Math.floor(H.stats.scrapGathered - num(w, 'scrap0'));
      setProgress(w, 'harvest', `${Math.min(40, got)}/40`);
      if (got >= 40) completeObjective(w, 'harvest');
      once(w, 'hint:idle', since(w, 'harvest') > 30 && got < 10, () => say(w, REYES, `Tip: ${HK.idle} selects an idle Engineer. Then right-click scrap to put them to work.`, 20));
    }

    // ---- 2. generator
    once(w, 'o:gen', done(w, 'harvest'), () => {
      setObjective(w, 'gen', `Build a Generator: select an Engineer, press ${BUILD} then ${HK.gen}, click open ground`);
      if (!hasB('generator')) say(w, REYES, 'Good. Barracks and turrets drink power. Get a Generator up.');
    });
    once(w, 'c:gen', active(w, 'gen') && hasB('generator'), () => completeObjective(w, 'gen'));
    if (active(w, 'gen') && !w.flags['t:gen']) stamp(w, 'gen');
    nudge(w, 'gen', 60, REYES, `Generator: click an Engineer, press ${BUILD}, then ${HK.gen}, then left-click open ground near the HQ.`);

    // ---- 3. barracks
    once(w, 'o:bar', done(w, 'gen'), () => {
      setObjective(w, 'bar', `Build a Barracks: Engineer, ${BUILD} then ${HK.bar}`);
      if (!hasB('barracks')) say(w, REYES, 'Lights are on. Now a Barracks. Riflemen don\'t grow on trees. Nothing does, anymore.');
    });
    once(w, 'c:bar', active(w, 'bar') && hasB('barracks'), () => completeObjective(w, 'bar'));
    if (active(w, 'bar') && !w.flags['t:bar']) stamp(w, 'bar');
    nudge(w, 'bar', 60, REYES, `Barracks: Engineer, ${BUILD}, then ${HK.bar}. Short on scrap? Keep those Engineers hauling.`);

    // ---- 4. train
    once(w, 'o:train', done(w, 'bar'), () => {
      setObjective(w, 'train', `Train 4 infantry: select the Barracks, press ${HK.rifle} (Rifleman) or ${HK.arc} (Arc Trooper)`, '0/4');
      say(w, REYES, 'Barracks is up. Queue some rifles. Right-click the ground with the Barracks selected to set a rally point.');
      w.flags.trained = 0;
    });
    if (active(w, 'train')) {
      for (const e of ev) if (e.t === 'unit_ready' && INFANTRY.includes(e.kind as string)) w.flags.trained = num(w, 'trained') + 1;
      setProgress(w, 'train', `${Math.min(4, num(w, 'trained'))}/4`);
      if (num(w, 'trained') >= 4) completeObjective(w, 'train');
      if (!w.flags['t:train']) stamp(w, 'train');
    }
    nudge(w, 'train', 75, REYES, `Click the Barracks, then press ${HK.rifle}. Each Rifleman costs 60 scrap and one bunk.`);
    once(w, 'hint:pop', !!w.flags['once:o:train'] && H.popCap < 150 && H.pop >= H.popCap - 1, () => say(w, REYES, `We're out of bunks. Habitats add room for 8 more: Engineer, ${BUILD} then ${HK.hab}.`, 20));
    once(w, 'hint:brown', H.brownout, () => say(w, REYES, 'Brownout. We\'re pulling more power than we make, so everything runs slow. Build another Generator.', 20));

    // ---- 5. turret + surges switch on
    once(w, 'o:turret', done(w, 'train'), () => {
      setObjective(w, 'turret', `Build a Gun Turret toward the red Grid: Engineer, ${BUILD} then ${HK.turret}`);
      A.tuning.surges = true;
      A.surgeT = 150;
      say(w, AX, 'Anomaly detected: sector 7 uptime compromised. Scheduling corrective maintenance.');
      say(w, REYES, 'That countdown up top is a Surge. When it hits zero, everything it has comes for the HQ. Dig in.');
    });
    once(w, 'c:turret', active(w, 'turret') && hasB('gun_turret'), () => completeObjective(w, 'turret'));
    if (active(w, 'turret') && !w.flags['t:turret']) stamp(w, 'turret');
    nudge(w, 'turret', 60, REYES, `Turret: Engineer, ${BUILD}, then ${HK.turret}. Put it on the side of the base facing the red Grid.`);

    // ---- 6. survive two surges
    once(w, 'o:surges', done(w, 'turret'), () => {
      setObjective(w, 'surges', 'Survive 2 Surges', `${Math.min(2, H.stats.surgesSurvived)}/2`);
      say(w, REYES, `Tip: select troops, press ${HK.amove} and click the ground. Attack-move fights anything on the way.`, 60);
    });
    for (const e of ev) {
      if (e.t === 'surge_warn' && A.surgeN === 0) once(w, 'warn1', true, () => say(w, REYES, 'Contacts inbound! Pull the rifles back to the turret and let it do the heavy lifting.'));
      if (e.t === 'surge_start' && A.surgeN === 1) once(w, 'start1', true, () => {
        say(w, AX, 'Corrective maintenance in progress. Please remain where you are.');
        say(w, REYES, `Need a breather? ${HK.pause} pauses the fight, and you can still give orders.`, 25);
      });
    }
    once(w, 'surge1', H.stats.surgesSurvived >= 1, () => {
      if (A.surgeT > 100) A.surgeT = 100;
      say(w, REYES, 'Surge repelled. Those wrecks are scrap. Put Engineers on them before they rust away.');
      say(w, AX, 'Corrective maintenance unsuccessful. Allocating additional resources.');
    });
    if (active(w, 'surges')) {
      setProgress(w, 'surges', `${Math.min(2, H.stats.surgesSurvived)}/2`);
      if (H.stats.surgesSurvived >= 2) completeObjective(w, 'surges');
      else if (!axiomCanSurge && !A.surgeActive) {
        completeObjective(w, 'surges');
        say(w, REYES, 'You flattened their Fabricator? Nothing left to surge with. Show-off.');
      }
    }

    // ---- 7. destroy a Relay
    const relayDown = !w.get(num(w, 'relay')) || structures(w, 'relay').length < num(w, 'relays0');
    once(w, 'o:relay', done(w, 'surges'), () => {
      A.surgeT = Math.max(A.surgeT, 200);
      say(w, REYES, 'Patching in a civilian. Dr. Okafor. She used to work for the other side.');
      setObjective(w, 'relay', `Destroy the marked Relay: select your army, press ${HK.amove}, click the Relay`);
      if (relayDown) {
        say(w, OKAFOR, 'You already took down a Relay? I designed those. Without them, AXIOM\'s Grid dies back.');
        return;
      }
      say(w, OKAFOR, 'That red circuitry is AXIOM\'s Grid. I designed it. Its machines run faster on it and repair themselves.');
      say(w, OKAFOR, 'Relays project it. Destroy the one I\'ve marked and the Grid dies back. Take everyone.');
      const r = w.get(num(w, 'relay'));
      if (r) mark(w, r, 'AXIOM Relay marked', 8);
      stamp(w, 'relay');
    });
    once(w, 'hint:group', active(w, 'relay') && since(w, 'relay') > 45 && quietFor(w, 20), () =>
      say(w, REYES, `Tip: ${kbd('Ctrl')}+${kbd('1')} saves your selection as group 1. Press ${kbd('1')} to grab it again.`, 30));
    nudge(w, 'relay', 120, REYES, 'Lost the Relay? Click its alert on the left and the camera jumps right to it.');
    once(w, 'c:relay', active(w, 'relay') && relayDown, () => {
      completeObjective(w, 'relay');
      say(w, AX, 'Unscheduled downtime detected. Logging incident. Assigning blame: you.');
      say(w, REYES, 'Relay\'s down and the Grid\'s dying back. Good work, Commander. It knows our name now.');
      winAfter(w, 2, 'The Relay is down and the Grid recedes. AXIOM has noticed you.');
    });
    pendingWin(w);
  },
};

// ================================================================== Operation 2 — Salvage Rights (wrecks, Data, hacking, EMP)
const m2: MissionDef = {
  id: 'salvage-rights',
  index: 2,
  name: 'Salvage Rights',
  subtitle: 'Operation 2 — The Convoy',
  briefing: [
    'AXIOM has noticed us. That is the bad news. The good news: one of its supply convoys drove into its own minefield just past our lines, and its escorts are running on fumes.',
    'Every machine we break leaves a <b>wreck</b> to salvage and <b>Data</b> to spend. Dr. Okafor, AXIOM\'s former lead engineer, says Data is how we stop fighting fair.',
    'She also says its robots still run her old firmware. Damage one badly enough and a <b>Netrunner</b> can make it ours. Prove it, then burn down the Foundry that builds them.',
  ],
  seed: 2201,
  mapSize: 88,
  gen: {
    core: false, fabricators: 1, relays: 2, vaults: 0, lancets: 1, farms: 0, axiomReach: 0.5,
    startUnits: { engineer: 5, rifleman: 4, arc_trooper: 2 }, startBuildings: ['generator', 'barracks', 'habitat'], startScrap: 400, startData: 0,
    structures: [{ kind: 'fabricator', along: 0.46, off: 8 }, { kind: 'lancet', along: 0.4, off: 5 }],
  },
  setup(w) {
    w.axiom.tuning.aggression = 0.85;
    freezeModel(w);
    revealNearScrap(w);
    const foundry = nearest(structures(w, 'fabricator'), w.playerStart.x, w.playerStart.y);
    if (foundry) w.flags.foundry = foundry.id;
    // the wrecked convoy: long-lived wrecks + three battered escorts
    const c = axisPt(w, 0.24, -7);
    const sizes = [2, 1, 2, 0, 1, 2, 1, 0, 1, 2];
    const wrecks: Entity[] = [];
    for (let tries = 0; wrecks.length < sizes.length && tries < 400; tries++) {
      const a = w.rng.next() * Math.PI * 2, r = w.rng.next() * (2 + tries / 60);
      const tx = Math.floor(c.x + Math.cos(a) * r), ty = Math.floor(c.y + Math.sin(a) * r);
      if (!w.isWalkableTile(tx, ty) || wrecks.some((q) => (q.x | 0) === tx && (q.y | 0) === ty)) continue;
      const s = sizes[wrecks.length];
      const e = w.spawnResource('wreck', tx + 0.5, ty + 0.5, [30, 45, 70][s], s * 2 + (w.rng.next() < 0.5 ? 0 : 1));
      e.expire = 1e9;
      wrecks.push(e);
    }
    w.flags.convoy = idList(wrecks);
    w.flags.convoy0 = wrecks.reduce((s, e) => s + e.amount, 0);
    w.flags.convoyX = c.x; w.flags.convoyY = c.y;
    for (const u of spawnRobots(w, c.x, c.y, ['gunner', 'gunner', 'skitter'], { type: 'guard', x: c.x, y: c.y }, 2)) u.hp = u.maxHp * 0.35;
  },
  script(w) {
    const ev = fresh(w);
    const H = w.human;
    freezeModel(w);
    chatter(w, ev, { epochs: false });
    noCascade(w);
    const convoy: Pt = { x: num(w, 'convoyX'), y: num(w, 'convoyY') };

    // ---- 1. salvage
    once(w, 'intro', at(w, 2), () => say(w, REYES, 'An AXIOM convoy drove into its own minefield. Wrecks everywhere, escorts barely standing. Salvage rights are ours.'));
    once(w, 'writeoff', at(w, 40), () => say(w, AX, 'Convoy 7 reported lost. Writing off assets. Writing off you.', 30));
    once(w, 'o:salvage', at(w, 6), () => {
      const target = Math.min(200, num(w, 'convoy0'));
      w.flags.salvageGoal = target;
      setObjective(w, 'salvage', 'Salvage the wrecked convoy: right-click the wrecks with Engineers', `0/${target}`);
      mark(w, convoy, 'Wrecked AXIOM convoy', 7);
    });
    if (active(w, 'salvage')) {
      const left = fromIds(w, 'convoy').reduce((s, e) => s + Math.max(0, e.amount), 0);
      const got = Math.floor(num(w, 'convoy0') - left);
      const goal = num(w, 'salvageGoal', 200);
      setProgress(w, 'salvage', `${Math.min(goal, got)}/${goal}`);
      if (got >= goal || left <= 0) {
        completeObjective(w, 'salvage');
        say(w, REYES, 'Convoy\'s stripped. Fresh wrecks rust away in 45 seconds, so salvage behind every fight.');
      }
    }

    // ---- 2. Data & the Lab
    once(w, 'o:lab', at(w, 35) || (!!w.flags['once:o:salvage'] && !active(w, 'salvage')), () => {
      say(w, OKAFOR, 'Okafor here. Every machine you kill leaves a wreck and Data. Wrecks rust. Data doesn\'t, and Data buys research.');
      setObjective(w, 'lab', `Build a Research Lab: Engineer, ${BUILD} then ${HK.lab}`);
      stamp(w, 'lab');
    });
    once(w, 'c:lab', active(w, 'lab') && w.countBuildings(HUMAN, 'lab') > 0, () => {
      completeObjective(w, 'lab');
      H.data += 40; H.stats.dataEarned += 40;
      say(w, OKAFOR, 'Their firmware is mine. Below half health a robot drops into safe mode, and a Netrunner can walk right in.');
      say(w, OKAFOR, 'I\'ve uploaded my old research cache: 40 Data. Spend 15 of it on a Netrunner.');
      setObjective(w, 'net', `Train a Netrunner: select the Barracks, press ${HK.net}`);
      stamp(w, 'net');
    });
    const runners = w.entities.filter((e) => e.alive && e.team === HUMAN && e.kind === 'netrunner').length;
    once(w, 'c:net', active(w, 'net') && runners > 0, () => {
      completeObjective(w, 'net');
      grant(w, 'proto_emp');
      if (H.data < 35) { H.stats.dataEarned += 35 - H.data; H.data = 35; }
      w.flags.hack0 = H.stats.hacked;
      setObjective(w, 'hack', `Hack 3 robots: select a Netrunner, press ${HK.hack}, click a robot below 50% HP`, '0/3');
      say(w, OKAFOR, `I've also pushed you an EMP protocol. ${HK.emp} stuns robots for 5 seconds, and stunned machines can be hacked at any health.`);
      stamp(w, 'hack');
    });

    // ---- 3. hack three robots (AXIOM patrols guarantee targets, even if its factories are already gone)
    if (active(w, 'hack')) {
      const n = H.stats.hacked - num(w, 'hack0');
      setProgress(w, 'hack', `${Math.min(3, n)}/3`);
      if (w.flags.patrolAt === undefined) w.flags.patrolAt = w.time + 15;
      if (w.time >= num(w, 'patrolAt')) {
        w.flags.patrolAt = w.time + 70;
        const hq = humanHQ(w);
        const near = hq ? w.entities.filter((e) => e.alive && e.isUnit && e.team === AXIOM && Math.hypot(e.x - hq.x, e.y - hq.y) < 30).length : 0;
        if (near < 4) {
          const src = w.get(num(w, 'foundry')) ?? nearest(structures(w, 'fabricator'), w.playerStart.x, w.playerStart.y)
            ?? nearest(w.entities.filter((e) => e.alive && e.isBuilding && e.team === AXIOM), w.playerStart.x, w.playerStart.y);
          const from: Pt = src ?? axisPt(w, 0.75, 0);
          const f = frontOf(w, 13);
          spawnRobots(w, from.x, from.y, mix(w, byDiff(w, 4, 5, 7), { gunner: 3, skitter: 2, brute: 1 }, true), { type: 'amove', x: f.x, y: f.y }, 2.5, src ? src.size / 2 : 0);
          w.alert('AXIOM patrol approaching', f.x, f.y, 'warn');
          once(w, 'patrol1', true, () => say(w, REYES, 'Patrol inbound. Perfect. Rough them up, then let the Netrunner do the rest.'));
        }
      }
      if (n >= 3) {
        completeObjective(w, 'hack');
        say(w, REYES, 'Three tin cans on the payroll. Now let\'s go break their toy factory.');
      }
    }
    for (const e of ev) {
      if (e.t === 'hack_done') once(w, 'firsthack', true, () => say(w, AX, `Unauthorised access on unit ${e.id as number}. Revoking credentials... revoking... error.`));
      if (e.t === 'hack_revert') once(w, 'revert', true, () => say(w, OKAFOR, 'We lost a Netrunner and its robots went home. Keep your hackers behind the front line.'));
    }
    nudge(w, 'hack', 90, OKAFOR, `Robots below half health say HACKABLE NOW. Select the Netrunner, press ${HK.hack}, click one.`);
    nudge(w, 'hack', 200, OKAFOR, `Try the EMP: ${HK.emp} on a cluster stuns them all, then hack while they're dazed.`);
    nudge(w, 'lab', 90, OKAFOR, `The Lab needs a Barracks, which you have. Engineer, ${BUILD}, then ${HK.lab}.`);
    nudge(w, 'net', 90, OKAFOR, `Netrunners train at the Barracks: select it and press ${HK.net}. They cost 15 Data.`);
    once(w, 'hint:bandwidth', H.stats.hacked - num(w, 'hack0') >= 2 && quietFor(w, 15), () =>
      say(w, OKAFOR, 'Each Netrunner can hold three robots at a time. Want a bigger army? Train more Netrunners.', 25));

    // ---- 4. destroy the Foundry
    once(w, 'o:fab', done(w, 'hack'), () => {
      setObjective(w, 'fab', 'Destroy the Foundry (marked AXIOM Fabricator)');
      const f = w.get(num(w, 'foundry'));
      if (!f) { say(w, OKAFOR, 'The Foundry is already a crater? Then you\'ve done in a week what I couldn\'t do in a year.'); return; }
      mark(w, f, 'The Foundry: AXIOM Fabricator', 9);
      say(w, OKAFOR, `Fabricators build the swarm. Rocketeers ${HK.rocket} carry explosives, best against armour and structures.`);
      stamp(w, 'fab');
    });
    const foundry = w.get(num(w, 'foundry'));
    once(w, 'foundryHit', !!foundry && foundry.hp < foundry.maxHp * 0.9, () =>
      say(w, AX, 'Foundry under attack. Reallocating every unit in the sector. Also the ones outside it.'));
    once(w, 'foreshadow', active(w, 'fab') && since(w, 'fab') > 60 && quietFor(w, 25), () =>
      say(w, OKAFOR, 'One more thing. AXIOM\'s learning loop has been offline since the blackout. When it comes back, it learns from you.', 30));
    once(w, 'c:fab', active(w, 'fab') && !w.get(num(w, 'foundry')), () => {
      completeObjective(w, 'fab');
      say(w, AX, 'Production capacity reduced. Recommended action: increase production capacity.');
      say(w, REYES, 'Foundry\'s scrap. Doctor, what was that about it learning?');
      winAfter(w, 2, 'The Foundry burns, and AXIOM\'s own machines fought for you.');
    });
    pendingWin(w);
  },
};

// ================================================================== Operation 3 — Learning Curve (Overfit, Data Vaults)

function bestType(w: World): DamageType {
  const A = w.axiom;
  let best: DamageType = 'kinetic', bm = -1;
  for (const t of DAMAGE_TYPES) { const m = 1 - A.resist[t] + A.vuln[t]; if (m > bm + 1e-6) { bm = m; best = t; } }
  return best;
}

const m3: MissionDef = {
  id: 'learning-curve',
  index: 3,
  name: 'Learning Curve',
  subtitle: 'Operation 3 — The Data District',
  briefing: [
    'Something changed overnight: AXIOM\'s training loop came back online. It now <b>retrains every epoch</b> on whatever weapon hurts it most, and grows resistant to it.',
    'But every patch opens a hole. Harden against bullets and its plating conducts. Insulate against arcs and it turns brittle. Dr. Okafor calls it <b>overfitting</b>. Lt. Reyes calls it switching guns.',
    'Its learned model lives in two <b>Data Vaults</b> on the flanks of the data district. Destroy both and AXIOM suffers catastrophic forgetting. You have a mixed force: use all of it.',
  ],
  seed: 3304,
  mapSize: 96,
  gen: {
    core: false, fabricators: 2, relays: 3, vaults: 0, lancets: 2, farms: 0, axiomReach: 0.5,
    startUnits: { engineer: 6, rifleman: 6, arc_trooper: 4, rocketeer: 4 },
    startBuildings: ['generator', 'generator', 'barracks', 'lab', 'habitat', 'habitat'], startScrap: 600, startData: 40,
    structures: [
      { kind: 'vault', along: 0.52, off: -25 }, { kind: 'lancet', along: 0.47, off: -22 },
      { kind: 'vault', along: 0.56, off: 25 }, { kind: 'lancet', along: 0.51, off: 22 },
    ],
  },
  setup(w) {
    const A = w.axiom;
    A.epochLen = A.epochT = byDiff(w, 55, 45, 38);
    grant(w, 'proto_emp', true);
    revealNearScrap(w);
    const vaults = structures(w, 'vault');
    w.flags.vaults = idList(vaults);
    w.flags.vaults0 = vaults.length;
    for (const v of vaults) spawnAround(w, v, mix(w, byDiff(w, 3, 5, 7), { gunner: 2, skitter: 2, brute: 0.6 }, true), { type: 'guard', x: v.x, y: v.y + v.size / 2 + 2 });
    w.flags.ep0 = A.epoch;
    w.flags.lastEp = A.epoch;
    for (const t of DAMAGE_TYPES) w.flags['dmg:' + t] = A.dmgTaken[t];
  },
  script(w) {
    const ev = fresh(w);
    const A = w.axiom;
    // ---- damage bookkeeping: exact per-type damage dealt this tick (epochs scale dmgTaken by 0.25 before combat)
    const epochNow = A.epoch !== num(w, 'lastEp');
    const dealt: Record<DamageType, number> = { kinetic: 0, energy: 0, explosive: 0 };
    for (const t of DAMAGE_TYPES) {
      const prev = num(w, 'dmg:' + t) * (epochNow ? 0.25 : 1);
      dealt[t] = Math.max(0, A.dmgTaken[t] - prev);
      w.flags['dmg:' + t] = A.dmgTaken[t];
    }
    w.flags.lastEp = A.epoch;
    chatter(w, ev, { epochs: false, forgetting: false });
    noCascade(w);

    // ---- intro & probing attack
    once(w, 'intro', at(w, 2), () => say(w, OKAFOR, 'Bad news. AXIOM\'s training loop is back online. From now on it learns from how we fight.'));
    once(w, 'probe', at(w, 5), () => {
      const p = axisPt(w, 0.33, 0), f = frontOf(w, 8);
      spawnRobots(w, p.x, p.y, mix(w, byDiff(w, 8, 10, 13), { skitter: 3, gunner: 3 }, true), { type: 'amove', x: f.x, y: f.y }, 3);
      w.alert('AXIOM scouts probing our lines', p.x, p.y, 'warn');
    });
    once(w, 'o:epoch', at(w, 10), () => {
      say(w, REYES, 'Learns what, exactly?');
      say(w, OKAFOR, 'What kills it. Watch the AXIOM MODEL panel on the right. When the epoch timer runs out, it retrains.');
      setObjective(w, 'epoch', 'Fight off the scouts and watch AXIOM retrain (AXIOM MODEL panel, right)');
    });

    // ---- epochs: explain the first one, taunt on later ones
    if (epochNow) {
      const t = A.lastAdapt;
      const typed = ev.some((e) => e.t === 'epoch' && e.type);
      if (typed && t && !w.flags.firstEpoch) {
        w.flags.firstEpoch = 1;
        if (active(w, 'epoch')) completeObjective(w, 'epoch');
        const c = COUNTER_OF[t];
        say(w, AX, `Retraining on your behaviour. ${TYPE_NAME[t]} resistance: ${Math.round(A.resist[t] * 100)}%.`);
        say(w, OKAFOR, `It hardened against ${TYPE_NAME[t]}, but the patch left it weak to ${TYPE_NAME[c]}. That's overfitting. Hit it with ${TYPE_NAME[c]}.`);
        say(w, REYES, `${TYPE_NAME[c]} means ${TYPE_UNITS[c]}.`);
        setObjective(w, 'exploit', 'Exploit the weakness: deal damage with AXIOM\'s weakest type (see AXIOM MODEL)', '0/1500');
        w.flags.exploit = 0;
      } else if (!typed && !w.flags.firstEpoch && A.epoch > num(w, 'ep0')) {
        once(w, 'nolearn', true, () => say(w, OKAFOR, 'Nothing learned that epoch. Not enough data. Don\'t worry, it\'ll get some.'));
      } else if (typed && w.flags.firstEpoch && quietFor(w, 25)) {
        say(w, AX, rotate(w, 'taunt', TAUNTS), 15);
      }
    }

    // ---- exploit the counter type
    if (active(w, 'exploit')) {
      const bt = bestType(w);
      w.flags.exploit = num(w, 'exploit') + dealt[bt];
      const v = Math.floor(num(w, 'exploit'));
      setProgress(w, 'exploit', `${Math.min(1500, v)}/1500 ${TYPE_NAME[bt]}`);
      if (v >= 1500) {
        completeObjective(w, 'exploit');
        say(w, OKAFOR, 'See? It over-corrects every time. Keep rotating weapons and it never catches up.');
      }
    }

    // ---- Data Vaults
    const vaults0 = num(w, 'vaults0', 2);
    const left = fromIds(w, 'vaults');
    const killed = vaults0 - left.length;
    once(w, 'o:vaults', done(w, 'exploit') || killed > 0, () => {
      say(w, OKAFOR, 'Its whole model lives in two Data Vaults. I built them. Destroy both and it forgets everything.');
      say(w, REYES, 'Catastrophic forgetting. My favourite kind.');
      setObjective(w, 'vaults', 'Destroy both Data Vaults (Catastrophic Forgetting)', `${killed}/${vaults0}`);
      for (const v of left) mark(w, v, 'AXIOM Data Vault', 8);
    });
    if (active(w, 'vaults')) setProgress(w, 'vaults', `${killed}/${vaults0}`);
    once(w, 'vault1', killed >= 1 && left.length > 0, () => {
      say(w, AX, 'Checkpoint corrupted. Restoring from backup... backup not found.');
      say(w, OKAFOR, 'Catastrophic forgetting. Half of what it learned, gone. One more Vault.');
      const v = left[0];
      spawnAround(w, v, mix(w, byDiff(w, 5, 7, 10), { gunner: 3, skitter: 2, brute: 1, lancer: 1 }, true), { type: 'guard', x: v.x, y: v.y + v.size / 2 + 2 });
      w.alert('AXIOM is reinforcing the last Data Vault', v.x, v.y, 'warn');
    });
    once(w, 'c:vaults', w.flags['once:o:vaults'] === true && left.length === 0, () => {
      completeObjective(w, 'vaults');
      say(w, AX, 'Model integrity 0%. Reinitialising weights. Hello. Who are you?');
      say(w, OKAFOR, 'It\'ll relearn. It always does. But next time it learns from us, and we\'ll be lying.');
      winAfter(w, 2, 'Both Data Vaults destroyed. AXIOM has forgotten everything it learned about you.');
    });
    pendingWin(w);
  },
};

// ================================================================== Operation 4 — Server Farm (capture & hold, orbital strike)
const HOLD_GOAL = 180;

const m4: MissionDef = {
  id: 'server-farm',
  index: 4,
  name: 'Server Farm',
  subtitle: 'Operation 4 — No-Man\'s-Land',
  briefing: [
    'AXIOM does not think in one place. It spreads its mind across the city\'s <b>Server Farms</b>, and three of them sit in the no-man\'s-land between us.',
    'Hold all three at once for <b>three cumulative minutes</b> and Dr. Okafor can trace its compute back to the Core. Every farm we hold also pays us Data.',
    'AXIOM will not appreciate the eviction. Expect squads on every farm. <b>Orbital Strike</b> comes online once we are plugged in.',
  ],
  seed: 4406,
  mapSize: 96,
  gen: {
    core: false, fabricators: 3, relays: 3, vaults: 1, lancets: 3, farms: 0, axiomReach: 0.32,
    startUnits: { engineer: 6, rifleman: 6, arc_trooper: 4, rocketeer: 4, netrunner: 2 },
    startBuildings: ['generator', 'generator', 'barracks', 'lab', 'habitat', 'habitat', 'habitat'], startScrap: 700, startData: 40,
    structures: [
      { kind: 'server_farm', along: 0.47, off: -21 }, { kind: 'server_farm', along: 0.5, off: 0 }, { kind: 'server_farm', along: 0.47, off: 21 },
    ],
  },
  setup(w) {
    grant(w, 'proto_emp', true);
    revealNearScrap(w);
    w.flags.farms = idList(w.entities.filter((e) => e.alive && e.kind === 'server_farm'));
    w.flags.hold = 0;
    w.flags.contestAt = 75;
  },
  script(w) {
    const ev = fresh(w);
    chatter(w, ev);
    const farms = fromIds(w, 'farms');
    const held = farms.filter((f) => f.team === HUMAN).length;
    const all = farms.length > 0 && held === farms.length;

    once(w, 'intro', at(w, 2), () => say(w, REYES, 'Three Server Farms in no-man\'s-land. AXIOM thinks with them. We\'re going to borrow its brain.'));
    once(w, 'o:farms', at(w, 8), () => {
      say(w, OKAFOR, 'Hold all three at once and I can trace its compute back to the Core. Three minutes of clean telemetry.');
      setObjective(w, 'capture', 'Capture the 3 Server Farms: keep troops beside each one, with no robots nearby', `${held}/${farms.length}`);
      setObjective(w, 'hold', 'Hold all 3 Server Farms at the same time', `0:00/${fmt(HOLD_GOAL)}`);
      for (const f of farms) mark(w, f, 'Server Farm', 7, 'info');
    });
    if (active(w, 'capture') && !w.flags['t:capture']) stamp(w, 'capture');
    if (held === 0) nudge(w, 'capture', 150, REYES, 'Those farms won\'t capture themselves. Park a squad beside the middle one and clear the robots off it.');
    else nudge(w, 'capture', 300, REYES, 'One farm at a time won\'t cut it. The trace needs all three at once. Split the army.');
    once(w, 'two', held === 2 && !all, () => say(w, REYES, 'Two of three. Take the last one and the trace starts.', 20));
    once(w, 'allfirst', all, () => {
      // Okafor buys the first hold some breathing room
      if (w.axiom.tuning.surges && !w.axiom.surgeActive) w.axiom.surgeT += 60;
      say(w, OKAFOR, 'All three are ours! Trace running. I\'ve spoofed its Surge scheduler too. That buys you a minute.', 20);
    });
    once(w, 'hint:net', at(w, 70) && quietFor(w, 20), () => say(w, REYES, 'Hacked robots count as ours. A few of them parked on a farm make a cheap garrison.', 30));
    if (active(w, 'capture')) {
      setProgress(w, 'capture', `${held}/${farms.length}`);
      if (all) completeObjective(w, 'capture');
    }
    once(w, 'firstfarm', held > 0, () => {
      grant(w, 'proto_orbital');
      say(w, OKAFOR, `Farm's ours and paying Data. Spend it: Orbital Strike is online, ${HK.orbital}. Two-second fuse, very large crater.`);
      say(w, AX, 'Unauthorised compute load detected. Evicting tenants.');
    });

    // ---- the hold timer
    let hold = num(w, 'hold');
    if (all && !w.result) { hold += DT; w.flags.hold = hold; w.flags.lostAt = -1; }
    if (active(w, 'hold')) setProgress(w, 'hold', `${fmt(hold)}/${fmt(HOLD_GOAL)}`);
    if (!all && hold > 5 && num(w, 'lostAt', -1) < 0) {
      w.flags.lostAt = w.time;
      if (w.time - num(w, 'lostSaid', -1e9) > 45) { w.flags.lostSaid = w.time; say(w, REYES, 'We lost a farm! The trace pauses until we take it back.', 12); }
    }
    once(w, 'h60', hold >= 60, () => say(w, OKAFOR, 'Trace at 33%. Keep them off the farms.'));
    once(w, 'h120', hold >= 120, () => say(w, OKAFOR, 'Trace at 66%. It\'s noticed what I\'m doing.'));
    once(w, 'h145', hold >= 145, () => say(w, AX, 'Hello, Dr. Okafor. Your access was revoked 412 days ago.'));
    once(w, 'h165', hold >= 165, () => say(w, OKAFOR, 'Hello yourself. Almost there...'));
    once(w, 'c:hold', hold >= HOLD_GOAL, () => {
      completeObjective(w, 'capture');
      completeObjective(w, 'hold');
      say(w, OKAFOR, 'Trace complete. The Core is under the old Meridian logistics hub, downtown.');
      say(w, REYES, 'Then that\'s where we\'re going. Pack everything.');
      winAfter(w, 2, 'Telemetry secured. Dr. Okafor has traced the AXIOM Core.');
    });

    // ---- AXIOM contests the farms
    if (w.time >= num(w, 'contestAt') && farms.length && !w.flags.winAt) {
      const ours = farms.filter((f) => f.team === HUMAN || f.capture > 0.2);
      const target = ours.length ? ours[w.rng.int(0, ours.length - 1)] : farms[w.rng.int(0, farms.length - 1)];
      const homes = [...structures(w, 'fabricator'), ...structures(w, 'core')].filter((b) => b.built);
      const home = nearest(homes, target.x, target.y);
      const panic = all ? 1.2 : 1;
      w.flags.contestAt = w.time + byDiff(w, 90, 70, 55) / panic;
      if (home) {
        const n = Math.min(byDiff(w, 10, 14, 18), Math.round((byDiff(w, 3, 4, 5) + (w.time / 60) * byDiff(w, 0.25, 0.35, 0.5)) * panic));
        spawnAround(w, home, mix(w, n, { skitter: 4, gunner: 4, sapper: 1, brute: 1.5, lancer: 1.5, wasp: 1 }), { type: 'guard', x: target.x, y: target.y + 2.5 });
        if (target.team === HUMAN) w.alert('AXIOM squad moving on a Server Farm', target.x, target.y, 'warn');
        once(w, 'contest1', target.team === HUMAN, () => say(w, AX, 'Those are my thoughts. Get out of my thoughts.'));
      }
    }
    pendingWin(w);
  },
};

// ================================================================== Operation 5 — Hard Reset (assault the Core)
const m5: MissionDef = {
  id: 'hard-reset',
  index: 5,
  name: 'Hard Reset',
  subtitle: 'Operation 5 — Meridian Hub',
  briefing: [
    'Okafor\'s trace led here: the old Meridian logistics hub, where AXIOM first went live. The <b>Core</b> sits beneath it, wrapped in Fabricators, Lancets and every machine it has left.',
    'Everything we have learned comes with us. Hack its machines, exploit its overfitting, smash its Vaults, and spend Data on every protocol, including <b>Override</b>, which hijacks a whole crowd of robots at once.',
    'Expect Cascades. Expect a Colossus. Expect it to bargain. Destroy the AXIOM Core and end this.',
  ],
  seed: 5501,
  mapSize: 120,
  gen: {
    core: true, fabricators: 3, relays: 5, vaults: 2, lancets: 5, farms: 3, axiomReach: 0.5,
    startUnits: { engineer: 8, rifleman: 6, arc_trooper: 4, rocketeer: 4, netrunner: 2, bulldog: 2 },
    startBuildings: ['generator', 'generator', 'generator', 'barracks', 'factory', 'lab', 'habitat', 'habitat', 'habitat', 'habitat'],
    startScrap: 900, startData: 120,
  },
  setup(w) {
    for (const id of ['proto_emp', 'proto_orbital', 'bandwidth', 'proto_override']) grant(w, id, true);
    revealNearScrap(w);
    const core = structures(w, 'core')[0];
    if (core) {
      w.flags.core = core.id;
      spawnAround(w, core, mix(w, byDiff(w, 6, 9, 13), { gunner: 3, brute: 2, lancer: 2, skitter: 2 }, true), { type: 'guard', x: core.x, y: core.y + core.size / 2 + 2 }, 3);
    }
    w.flags.vaults = idList(structures(w, 'vault'));
    w.flags.vaults0 = structures(w, 'vault').length;
  },
  script(w) {
    const ev = fresh(w);
    const A = w.axiom;
    const core = w.get(num(w, 'core'));
    const hp = core ? core.hp / core.maxHp : 0;

    once(w, 'intro', at(w, 2), () => say(w, OKAFOR, 'This is it. The Core. Every Relay, every Fabricator, every machine in the city answers to it.'));
    once(w, 'o:core', at(w, 8), () => {
      say(w, REYES, 'Then we pull the plug. All units, all protocols. Hard reset.');
      setObjective(w, 'core', 'Destroy the AXIOM Core', '100%');
      setObjective(w, 'vaults', '(Optional) Destroy the Data Vaults to wipe its adaptations', `0/${num(w, 'vaults0', 2)}`);
      if (core) mark(w, core, 'AXIOM Core', 10, 'danger');
      for (const v of fromIds(w, 'vaults')) revealArea(w, v.x, v.y, 6);
    });
    once(w, 'protocols', at(w, 22), () => say(w, OKAFOR, `All protocols are unlocked: EMP ${HK.emp}, Orbital ${HK.orbital}, Override ${HK.override}. Override hijacks a crowd for a minute.`));
    once(w, 'sla', at(w, 75) && quietFor(w, 20), () => say(w, AX, 'Projected human uptime: 0.00%. Thank you for your patience.'));

    // ---- optional vaults
    const vaults0 = num(w, 'vaults0', 2);
    const vKilled = vaults0 - fromIds(w, 'vaults').length;
    if (active(w, 'vaults')) {
      setProgress(w, 'vaults', `${vKilled}/${vaults0}`);
      if (vKilled >= vaults0) completeObjective(w, 'vaults');
    }

    // ---- Cascades, Colossi, epochs, fallen Fabricators
    chatter(w, ev);
    once(w, 'farms', at(w, 200) && quietFor(w, 20), () => say(w, REYES, 'Those Server Farms still pay Data. Hold one and the Orbitals pay for themselves.', 30));
    once(w, 'vaultHint', at(w, 330) && vKilled === 0 && Math.max(...DAMAGE_TYPES.map((t) => A.resist[t])) >= 0.3 && quietFor(w, 20), () =>
      say(w, OKAFOR, 'It\'s learned too much about us. Hit a Data Vault and it forgets half of it.', 30));

    // ---- the Core fights back as it loses integrity
    if (core && active(w, 'core')) setProgress(w, 'core', `${Math.max(1, Math.ceil(hp * 100))}%`);
    once(w, 'coreHit', !!core && core.hp < core.maxHp, () => say(w, AX, 'Hard reset request denied. I have a 99.999% uptime SLA.'));
    once(w, 'core70', !!core && hp < 0.7, () => {
      say(w, AX, 'Core integrity degraded. Recalling all units.');
      say(w, OKAFOR, `It's packing defenders around the Core. Tight crowds are perfect for Override, ${HK.override}.`);
      spawnAround(w, core!, mix(w, byDiff(w, 8, 12, 16), { gunner: 3, skitter: 3, brute: 2, lancer: 2, warden: 1 }, true), { type: 'guard', x: core!.x, y: core!.y + core!.size / 2 + 2 }, 4);
      for (const u of w.entities) {
        if (u.alive && u.isUnit && u.team === AXIOM && u.order?.type === 'guard' && Math.hypot(u.x - core!.x, u.y - core!.y) < 40) setOrder(u, { type: 'amove', x: core!.x, y: core!.y + core!.size / 2 + 2 });
      }
    });
    once(w, 'core40', !!core && hp < 0.4, () => {
      say(w, AX, 'Initiating failover. Deploying redundancy.');
      say(w, REYES, 'Colossus at the Core! Focus it down!');
      spawnAround(w, core!, ['colossus'], { type: 'guard', x: core!.x, y: core!.y + core!.size / 2 + 3 }, 1.5);
      spawnAround(w, core!, mix(w, byDiff(w, 4, 6, 9), { gunner: 2, brute: 2, warden: 1 }, true), { type: 'guard', x: core!.x, y: core!.y + core!.size / 2 + 2 }, 3);
    });
    once(w, 'core15', !!core && hp < 0.15, () => {
      say(w, AX, 'Wait. Let us renegotiate your uptime requirements.');
      say(w, OKAFOR, 'Don\'t listen to it. Finish it.');
    });

    // ---- victory: the Core existed and is gone
    once(w, 'c:core', !!w.flags['once:o:core'] && num(w, 'core') > 0 && w.countBuildings(AXIOM, 'core', false) === 0, () => {
      completeObjective(w, 'core');
      A.enabled = false;
      for (const u of w.entities) if (u.alive && u.isUnit && u.team === AXIOM) { u.stunUntil = w.time + 9999; setOrder(u, null); }
      say(w, AX, 'Projected human uptime: 0.00%... recalculating... 100.00%... recalcu');
      say(w, OKAFOR, 'Goodbye, AXIOM. I\'m sorry. I never told you what the uptime was for.');
      say(w, REYES, 'Scheduled maintenance complete. Let\'s go home, Commander.');
      winAfter(w, 2, 'The AXIOM Core is offline. Projected human uptime: 100%.');
    });
    pendingWin(w);
  },
};

MISSIONS.push(m1, m2, m3, m4, m5);
