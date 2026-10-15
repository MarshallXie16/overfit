// Campaign validation: every operation is generated, set up and simulated headlessly with the scripted Bot.
//   soak pass — Bot only, ~25 game-minutes: no exceptions, objectives appear, radio lines valid.
//   win pass  — Bot + scripted cheats that satisfy each objective's trigger (HQ kept alive): the win must fire.
// Usage: npx tsx tools/campaign-check.ts [--mission first-light] [--diff veteran] [--minutes 25] [--transcript] [--all-diffs]
import '../src/game/campaign';
import { MISSIONS, type MissionDef } from '../src/game/missions';
import { Bot } from '../src/sim/bot';
import { generateWorld } from '../src/sim/mapgen';
import { step } from '../src/sim/step';
import { applyDamage, convertUnit, die } from '../src/sim/systems/combat';
import { AXIOM, HUMAN, TICK_HZ, type DamageType, type Difficulty } from '../src/sim/types';
import type { Entity, World } from '../src/sim/world';

const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const onlyMission = opt('mission', '');
const diff = opt('diff', 'veteran') as Difficulty;
const minutes = +opt('minutes', '25');
const transcript = args.includes('--transcript');
const allDiffs = args.includes('--all-diffs');

const SPEAKERS = ['Lt. Reyes', 'Dr. Okafor', 'AXIOM'];
const visible = (html: string) => html.replace(/<[^>]+>/g, '');

interface Line { t: number; speaker: string; text: string }
interface Ctx {
  seenAt: Record<string, number>;
  doneAt: Record<string, number>;
  mark: Record<string, number>;
}
interface Run {
  w: World;
  result: string;
  time: number;
  radio: Line[];
  ctx: Ctx;
  errors: string[];
}

type Cheat = (w: World, c: Ctx) => void;

function makeWorld(m: MissionDef, d: Difficulty): World {
  const w = generateWorld({ mode: 'campaign', difficulty: d, seed: m.seed, mapSize: m.mapSize, missionId: m.id }, m.gen);
  m.setup(w);
  w.script = (ww) => m.script(ww);
  return w;
}

function run(m: MissionDef, d: Difficulty, mins: number, cheat?: Cheat, player?: Cheat): Run {
  const w = makeWorld(m, d);
  const bot = player ? null : new Bot(1);
  const radio: Line[] = [];
  const ctx: Ctx = { seenAt: {}, doneAt: {}, mark: {} };
  const errors: string[] = [];
  const ticks = mins * 60 * TICK_HZ;
  const drain = () => {
    for (const ev of w.events) if (ev.t === 'radio') radio.push({ t: w.time, speaker: ev.speaker as string, text: ev.text as string });
    w.events.length = 0;
  };
  try {
    for (let i = 0; i < ticks && !w.result; i++) {
      if (player) player(w, ctx); else bot!.think(w);
      step(w);
      // the session clears events once per *frame*; emulate 2 ticks per frame so scripts must de-duplicate
      if (i % 2 === 1) drain();
      for (const o of w.objectives) {
        if (ctx.seenAt[o.id] === undefined) ctx.seenAt[o.id] = w.time;
        if (o.done && ctx.doneAt[o.id] === undefined) ctx.doneAt[o.id] = w.time;
      }
      if (cheat) {
        cheat(w, ctx);
        // keep the HQ standing so the win path can be verified even if the Bot is losing
        for (const e of w.entities) if (e.alive && e.team === HUMAN && e.kind === 'hq') e.hp = e.maxHp;
      }
      if (i % 200 === 0) {
        for (const e of w.entities) if (!Number.isFinite(e.x) || !Number.isFinite(e.y) || !Number.isFinite(e.hp)) { errors.push(`NaN on ${e.kind}#${e.id}`); break; }
      }
    }
    drain();
  } catch (err) {
    errors.push(`exception at t=${w.time.toFixed(1)}: ${(err as Error).stack ?? err}`);
  }
  return { w, result: w.result ?? 'running', time: w.time, radio, ctx, errors };
}

// ------------------------------------------------------------------ cheats (stand-ins for player actions the Bot doesn't do)
const isActive = (w: World, id: string) => w.objectives.some((o) => o.id === id && !o.done);
const age = (w: World, c: Ctx, id: string) => (c.seenAt[id] === undefined ? -1 : w.time - c.seenAt[id]);
const flagEnt = (w: World, k: string) => w.get(w.flags[k] as number);
const every = (w: World, s: number) => w.tick % Math.round(s * TICK_HZ) === 0;
const robots = (w: World) => w.entities.filter((e) => e.alive && e.isUnit && e.team === AXIOM && !e.udef?.boss);

function finishSurge(w: World, c: Ctx, id: string): void {
  // if a surge straggles somewhere for minutes, clean it up so the objective chain can be verified
  if (isActive(w, id) && w.axiom.surgeActive) {
    c.mark.surgeSince ??= w.time;
    if (w.time - c.mark.surgeSince > 150) for (const u of robots(w)) if (u.squad === w.axiom.surgeN) die(w, u, HUMAN);
  } else delete c.mark.surgeSince;
}

const CHEATS: Record<string, Cheat> = {
  'first-light': (w, c) => {
    finishSurge(w, c, 'surges');
    if (isActive(w, 'relay') && age(w, c, 'relay') > 25) { const r = flagEnt(w, 'relay'); if (r) die(w, r, HUMAN); }
  },
  'salvage-rights': (w, c) => {
    if (isActive(w, 'salvage') && age(w, c, 'salvage') > 40 && every(w, 1)) {
      const ids = String(w.flags.convoy).split(',');
      for (const id of ids) { const e = w.get(+id); if (e) { e.amount -= 15; if (e.amount <= 0) w.kill(e); break; } }
    }
    if (isActive(w, 'hack') && age(w, c, 'hack') > 25 && every(w, 4)) {
      const runner = w.entities.find((e) => e.alive && e.team === HUMAN && e.kind === 'netrunner');
      const t = robots(w).find((e) => e.udef?.hackable);
      if (runner && t) convertUnit(w, t, runner);
    }
    if (isActive(w, 'fab') && age(w, c, 'fab') > 30) { const f = flagEnt(w, 'foundry'); if (f) die(w, f, HUMAN); }
  },
  'learning-curve': (w, c) => {
    if (isActive(w, 'exploit') && age(w, c, 'exploit') > 60 && every(w, 1)) {
      const A = w.axiom;
      let best: DamageType = 'kinetic', bm = -1;
      for (const t of ['kinetic', 'energy', 'explosive'] as DamageType[]) { const m = 1 - A.resist[t] + A.vuln[t]; if (m > bm) { bm = m; best = t; } }
      const t = robots(w)[0];
      if (t) applyDamage(w, t, 150, best, HUMAN, 0);
    }
    if (isActive(w, 'vaults')) {
      const vs = String(w.flags.vaults).split(',').map((id) => w.get(+id)).filter((e): e is Entity => !!e);
      if (vs.length === 2 && age(w, c, 'vaults') > 30) die(w, vs[0], HUMAN);
      if (vs.length === 1 && age(w, c, 'vaults') > 75) die(w, vs[0], HUMAN);
    }
  },
  'server-farm': (w, c) => {
    if (age(w, c, 'hold') < 0) return;
    const farms = String(w.flags.farms).split(',').map((id) => w.get(+id)).filter((e): e is Entity => !!e);
    const hold = (w.flags.hold as number) ?? 0;
    // drop a farm once mid-way to exercise the pause / "we lost a farm" path
    if (hold >= 90 && c.mark.dropped === undefined) c.mark.dropped = w.time;
    const dropping = c.mark.dropped !== undefined && w.time - c.mark.dropped < 12;
    farms.forEach((f, i) => {
      if (dropping && i === 0) { f.team = AXIOM; f.capture = -1; }
      else { f.team = HUMAN; f.capture = 1; }
    });
  },
  'hard-reset': (w, c) => {
    if (age(w, c, 'core') < 20) return;
    const core = flagEnt(w, 'core');
    if (core && every(w, 12)) {
      if (core.hp / core.maxHp > 0.12) applyDamage(w, core, core.maxHp * 0.15, 'explosive', HUMAN, 0);
      else die(w, core, HUMAN);
    }
    if (age(w, c, 'core') > 40 && every(w, 20)) { const v = String(w.flags.vaults).split(',').map((id) => w.get(+id)).find((e) => !!e); if (v) die(w, v, HUMAN); }
  },
};

// ------------------------------------------------------------------ scripted "new player" (replaces the Bot)
function placeNear(w: World, kind: string, x: number, y: number): Entity | null {
  for (let r = 3; r < 14; r++) for (let k = 0; k < r * 8; k++) {
    const a = (k / (r * 8)) * Math.PI * 2;
    const tx = Math.round(x + Math.cos(a) * r - 1), ty = Math.round(y + Math.sin(a) * r - 1);
    if (w.canPlace(kind, tx, ty).ok && w.canPlace(kind, tx - 1, ty - 1).ok) return w.spawnBuilding(kind, HUMAN, tx, ty, true);
  }
  return null;
}

const PLAYERS: Record<string, Cheat> = {
  // follows the tutorial literally and slowly, so both scripted Surges actually happen and the marked Relay is the target
  'first-light': (w, c) => {
    const hq = w.entities.find((e) => e.alive && e.team === HUMAN && e.kind === 'hq');
    if (!hq) return;
    const lazy = (id: string, s: number) => isActive(w, id) && age(w, c, id) > s && every(w, 1) && !c.mark['did:' + id];
    const did = (id: string) => { c.mark['did:' + id] = w.time; };
    if (lazy('harvest', 12)) { w.human.stats.scrapGathered += 45; did('harvest'); }
    if (lazy('gen', 20)) { placeNear(w, 'generator', hq.x, hq.y); did('gen'); }
    if (lazy('bar', 25)) { placeNear(w, 'barracks', hq.x, hq.y); did('bar'); }
    if (isActive(w, 'train') && age(w, c, 'train') > 10 && every(w, 8)) {
      const u = w.spawnUnit('rifleman', HUMAN, hq.x + 3, hq.y + 3);
      u.ax = u.x; u.ay = u.y;
      w.emit({ t: 'unit_ready', id: u.id, kind: u.kind, x: u.x, y: u.y });
    }
    if (lazy('turret', 30)) { const f = { x: hq.x + Math.sign(w.axiomStart.x - hq.x) * 6, y: hq.y + Math.sign(w.axiomStart.y - hq.y) * 6 }; placeNear(w, 'gun_turret', f.x, f.y); did('turret'); }
    if (isActive(w, 'relay') && age(w, c, 'relay') > 40) { const r = flagEnt(w, 'relay'); if (r) die(w, r, HUMAN); }
  },
};

// ------------------------------------------------------------------ checks
let failures = 0;
const fail = (m: string) => { failures++; console.log('  FAIL ' + m); };
const ok = (m: string) => console.log('  ok   ' + m);

function checkRadio(r: Run, label: string): void {
  if (r.radio.length < 4) fail(`${label}: only ${r.radio.length} radio lines`);
  for (const l of r.radio) {
    if (!SPEAKERS.includes(l.speaker)) fail(`${label}: unknown speaker "${l.speaker}"`);
    const n = visible(l.text).length;
    if (n > 160) fail(`${label}: radio line too long (${n}): ${visible(l.text)}`);
    if (/<(?!\/?kbd>|\/?b>)/.test(l.text)) fail(`${label}: unexpected markup in radio: ${l.text}`);
  }
  if (!r.radio.some((l) => /AXIOM/.test(l.speaker))) fail(`${label}: AXIOM never speaks`);
  // pacing: densest 20 s window
  let dense = 0;
  for (let i = 0; i < r.radio.length; i++) { let n = 0; for (let j = i; j < r.radio.length && r.radio[j].t - r.radio[i].t < 20; j++) n++; dense = Math.max(dense, n); }
  const span = r.radio.length > 1 ? (r.radio[r.radio.length - 1].t - r.radio[0].t) / (r.radio.length - 1) : 0;
  console.log(`       radio: ${r.radio.length} lines, avg gap ${span.toFixed(0)} s, densest 20 s window ${dense} lines`);
  if (dense > 5) fail(`${label}: ${dense} radio lines inside 20 s`);
}

function timeline(r: Run): string {
  return Object.keys(r.ctx.seenAt).map((id) => `${id}@${r.ctx.seenAt[id].toFixed(0)}${r.ctx.doneAt[id] !== undefined ? `→✓${r.ctx.doneAt[id].toFixed(0)}` : ''}`).join(' ');
}

const t0 = performance.now();
for (const m of MISSIONS) {
  if (onlyMission && m.id !== onlyMission) continue;
  console.log(`\n=== ${m.index}. ${m.name} (${m.id}) seed ${m.seed} ${m.mapSize}² ===`);
  if (!m.subtitle || m.briefing.length < 2 || m.briefing.length > 4) fail('briefing must have 2–4 paragraphs and a subtitle');

  // ---- soak
  const diffs: Difficulty[] = allDiffs ? ['recruit', 'veteran', 'nightmare'] : [diff];
  for (const d of diffs) {
    const s = run(m, d, minutes);
    const st = s.w.human.stats;
    console.log(`  soak[${d}]: ${s.result} at ${(s.time / 60).toFixed(1)} min | surges ${st.surgesSurvived}/${s.w.axiom.surgeN} killed ${st.killed} lost ${st.lost} hacked ${st.hacked} epochs ${s.w.axiom.epoch} | ${timeline(s)}`);
    for (const e of s.errors) fail(`soak[${d}] ${e}`);
    const first = Math.min(...Object.values(s.ctx.seenAt));
    if (!Number.isFinite(first) || first > 30) fail(`soak[${d}]: no objective within 30 s`); else ok(`soak[${d}]: first objective at ${first.toFixed(1)} s`);
    checkRadio(s, `soak[${d}]`);
    if (m.index === 1 && s.result === 'defeat') fail(`soak[${d}]: the tutorial Bot was defeated (${s.w.resultReason})`);
    if (transcript && d === diffs[0]) for (const l of s.radio) console.log(`       [${(l.t / 60 | 0)}:${String(Math.floor(l.t % 60)).padStart(2, '0')}] ${l.speaker}: ${visible(l.text)}`);
  }

  // ---- scripted new-player path (tutorial)
  if (PLAYERS[m.id]) {
    const p = run(m, diff, minutes, () => {}, PLAYERS[m.id]);
    const st = p.w.human.stats;
    console.log(`  path: ${p.result} at ${(p.time / 60).toFixed(1)} min | surges ${st.surgesSurvived}/${p.w.axiom.surgeN} (sizes scripted) lost ${st.lost} | ${timeline(p)}`);
    for (const e of p.errors) fail(`path ${e}`);
    if (p.result !== 'victory') fail(`scripted player path did not win (${p.result})`); else ok('scripted player path wins');
    if (m.id === 'first-light' && st.surgesSurvived < 2) fail('first-light: scripted path should survive two real Surges');
    checkRadio(p, 'path');
    if (transcript) for (const l of p.radio) console.log(`       [${(l.t / 60 | 0)}:${String(Math.floor(l.t % 60)).padStart(2, '0')}] ${l.speaker}: ${visible(l.text)}`);
  }

  // ---- win path
  const r = run(m, diff, minutes, CHEATS[m.id]);
  console.log(`  win:  ${r.result} at ${(r.time / 60).toFixed(1)} min — "${r.w.resultReason}" | ${timeline(r)}`);
  for (const e of r.errors) fail(`win ${e}`);
  if (r.result !== 'victory') fail(`win path did not reach victory (${r.result})`); else ok('victory fires when its trigger is satisfied');
  const open = r.w.objectives.filter((o) => !o.done && !o.text.startsWith('(Optional)'));
  if (r.result === 'victory' && open.length) fail(`objectives still open at victory: ${open.map((o) => o.id).join(', ')}`);
  checkRadio(r, 'win');
  if (m.id === 'server-farm' && !r.radio.some((l) => /lost a farm/.test(l.text))) fail('server-farm: losing a farm mid-hold produced no radio');
  if (m.id === 'hard-reset' && !r.w.entities.some((e) => e.alive && e.kind === 'colossus')) {
    // the failover Colossus must have spawned at <40% core integrity (it may have been stunned in place)
    if (!r.radio.some((l) => /failover/i.test(l.text))) fail('hard-reset: failover never triggered');
  }
}
console.log(`\n${failures ? `${failures} FAILURE(S)` : 'ALL CAMPAIGN CHECKS PASSED'} — ${((performance.now() - t0) / 1000).toFixed(1)} s`);
process.exit(failures ? 1 : 0);
