import './_set';
import { Bot } from '../src/sim/bot';
import { generateWorld } from '../src/sim/mapgen';
import { step } from '../src/sim/step';
import { HUMAN, AXIOM, TICK_HZ, type Difficulty } from '../src/sim/types';
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const w = generateWorld({ mode: 'skirmish', difficulty: opt('diff','veteran') as Difficulty, seed: +opt('seed','1'), mapSize: +opt('size','96') });
const bot = new Bot(+opt('level','1'));
const t0 = +opt('from','470'), t1 = +opt('to','560'), every = +opt('every','5');
for (let i = 0; i < t1*TICK_HZ && !w.result; i++) {
  bot.think(w);
  step(w);
  w.events.length = 0;
  if (w.time >= t0 && i % (every*TICK_HZ) === 0) {
    const hq = w.entities.find((e) => e.alive && e.kind === 'hq')!;
    const army = w.entities.filter((e) => e.alive && e.team === HUMAN && e.isUnit && e.kind !== 'engineer');
    const rob = w.entities.filter((e) => e.alive && e.team === AXIOM && e.isUnit && Math.hypot(e.x-hq.x, e.y-hq.y) < +opt("R","30"));
    const tur = w.entities.filter((e) => e.alive && e.team === HUMAN && e.isBuilding && (e.bdef?.weapon || e.kind==='wall'));
    const c = (arr: typeof army) => arr.length ? `(${(arr.reduce((a,e)=>a+e.x,0)/arr.length).toFixed(0)},${(arr.reduce((a,e)=>a+e.y,0)/arr.length).toFixed(0)})` : '-';
    const kinds = (arr: typeof army) => { const m = new Map<string,number>(); for (const e of arr) m.set(e.kind,(m.get(e.kind)??0)+1); return [...m].map(([k,v])=>k.slice(0,4)+v).join(' '); };
    const ord = (arr: typeof army) => { const m = new Map<string,number>(); for (const e of arr) { const k = (e.order?.type ?? 'idle') + (e.targetId ? '+t' : ''); m.set(k,(m.get(k)??0)+1);} return [...m].map(([k,v])=>k+':'+v).join(' '); };
    console.log(`t=${w.time.toFixed(0)} hq(${hq.x},${hq.y}) army ${army.length} ${c(army)} [${kinds(army)}] {${ord(army)}} | robots<30 ${rob.length} ${c(rob)} [${kinds(rob)}] {${ord(rob)}} | def ${tur.filter(t=>t.kind!=='wall').map(t=>t.kind.slice(0,3)+'@'+t.x.toFixed(0)+','+t.y.toFixed(0)+':'+(t.hp|0)).join(' ')} walls ${tur.filter(t=>t.kind==='wall').length} | mode ${bot.mode}`);
  }
}
