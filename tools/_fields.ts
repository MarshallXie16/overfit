import './_set';
import { Bot } from '../src/sim/bot';
import { generateWorld } from '../src/sim/mapgen';
import { step } from '../src/sim/step';
import { HUMAN, AXIOM, TICK_HZ, type Difficulty } from '../src/sim/types';
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const w = generateWorld({ mode: 'skirmish', difficulty: opt('diff','veteran') as Difficulty, seed: +opt('seed','1'), mapSize: +opt('size','96') });
const bot = new Bot(+opt('level','2'));
const cl: { x: number; y: number; ids: number[] }[] = [];
for (const r of w.entities) if (r.cat === 'resource') { let c = cl.find((k) => Math.hypot(k.x - r.x, k.y - r.y) < 5.5); if (!c) { c = { x: r.x, y: r.y, ids: [] }; cl.push(c); } c.ids.push(r.id); }
const hq = w.entities.find((e) => e.kind === 'hq')!;
const marks = opt('at', '240,480,600,720').split(',').map(Number);
for (let i = 0; i <= Math.max(...marks)*TICK_HZ && !w.result; i++) {
  bot.think(w); step(w); w.events.length = 0;
  if (marks.includes(i / TICK_HZ)) {
    console.log(`--- t=${w.time.toFixed(0)} hq(${hq.x},${hq.y}) axiom(${w.axiomStart.x},${w.axiomStart.y})`);
    const engs = w.entities.filter((e) => e.alive && e.kind === 'engineer');
    const drops = w.entities.filter((e) => e.alive && e.team === HUMAN && e.bdef?.dropoff);
    for (const c of cl) {
      const amt = c.ids.reduce((a, id) => a + (w.get(id)?.amount ?? 0), 0);
      const nodeIds = new Set(c.ids);
      const n = engs.filter((e) => e.order?.type === 'harvest' && nodeIds.has(e.order.id)).length;
      const dd = Math.min(...drops.map((d) => Math.hypot(d.x - c.x, d.y - c.y) - d.size / 2));
      const ax = Math.min(...w.entities.filter((e) => e.alive && e.team === AXIOM && e.isBuilding).map((b) => Math.hypot(b.x - c.x, b.y - c.y)));
      console.log(`  field @${c.x.toFixed(0)},${c.y.toFixed(0)} hqDist ${Math.hypot(c.x - hq.x, c.y - hq.y).toFixed(0)} amount ${amt} drop ${dd.toFixed(1)} creep ${w.creepAt(c.x, c.y).toFixed(1)} axStruct ${ax.toFixed(0)} explored ${w.explored[(c.y|0)*w.w+(c.x|0)]} eng ${n}`);
    }
    const wr = w.entities.filter((e) => e.alive && e.cat === 'wreck');
    console.log(`  wrecks ${wr.length} (${wr.reduce((a, r) => a + r.amount, 0)}) eng on wrecks ${engs.filter((e) => e.order?.type === 'harvest' && w.get(e.order.id)?.cat === 'wreck').length} engs ${engs.length} orders ${[...new Set(engs.map(e=>e.order?.type ?? 'none'))].map(k=>k+':'+engs.filter(e=>(e.order?.type??'none')===k).length).join(' ')}`);
  }
}
