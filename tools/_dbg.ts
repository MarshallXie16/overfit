import { Bot } from '../src/sim/bot';
import { generateWorld } from '../src/sim/mapgen';
import { step } from '../src/sim/step';
import { HUMAN, AXIOM, TICK_HZ, type Difficulty } from '../src/sim/types';
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const w = generateWorld({ mode: 'skirmish', difficulty: opt('diff','veteran') as Difficulty, seed: +opt('seed','1'), mapSize: +opt('size','96') });
const bot = new Bot(+opt('level','1'));
const every = +opt('every','30');
const mins = +opt('minutes','10');
const evs = new Set(opt('ev','').split(',').filter(Boolean));
for (let i = 0; i < mins*60*TICK_HZ && !w.result; i++) {
  bot.think(w);
  const cmds = w.commands.slice();
  step(w);
  if (args.includes('--cmds')) for (const c of cmds) if (c.c !== 'order' || args.includes('--orders')) console.log(`  [${w.time.toFixed(1)}] cmd`, JSON.stringify(c));
  for (const e of w.events) if (evs.has(e.t)) console.log(`  [${w.time.toFixed(1)}] ev`, JSON.stringify(e));
  w.events.length = 0;
  if (i % (every*TICK_HZ) === 0) {
    const b = new Map<string, string>();
    for (const e of w.entities) if (e.alive && e.team === HUMAN && e.isBuilding) b.set(e.kind, (b.get(e.kind) ?? '') + (e.built ? 'B' : 's'));
    const u = new Map<string, number>();
    for (const e of w.entities) if (e.alive && e.team === HUMAN && e.isUnit) u.set(e.kind, (u.get(e.kind) ?? 0) + 1);
    const orders = new Map<string, number>();
    for (const e of w.entities) if (e.alive && e.team === HUMAN && e.kind === 'engineer') orders.set(e.order?.type ?? 'none', (orders.get(e.order?.type ?? 'none') ?? 0) + 1);
    const ax = w.entities.filter((e) => e.alive && e.team === AXIOM && e.isUnit).length;
    const bq = w.entities.filter((e) => e.alive && e.team === HUMAN && (e.kind === "barracks" || e.kind === "factory")).map((e) => e.kind[0] + ":" + e.prod.map((p) => p.kind.slice(0,3) + (p.t/p.total).toFixed(1)).join("+")).join(" ");
    console.log(`t=${w.time.toFixed(0)} inc ${bot.income.toFixed(1)} gath ${w.human.stats.scrapGathered|0} K ${w.human.stats.killed} L ${w.human.stats.lost} trained ${w.human.stats.trained} [${bq}] scrap ${w.human.scrap|0} data ${w.human.data|0} pop ${w.human.pop}/${w.human.popCap} pwr ${w.human.powerUsed}/${w.human.power} | ${[...b].map(([k,v])=>k+':'+v).join(' ')} | ${[...u].map(([k,v])=>k+':'+v).join(' ')} | eng ${[...orders].map(([k,v])=>k+':'+v).join(' ')} | robots ${ax} surge ${w.axiom.surgeN}${w.axiom.surgeActive?'*':''} T-${w.axiom.surgeT|0} mode ${bot.mode} res ${[...w.human.research].join(',')}`);
  }
}
console.log(w.result, (w.time/60).toFixed(1));
