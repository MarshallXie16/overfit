import './_set';
import { Bot } from '../src/sim/bot';
import { generateWorld } from '../src/sim/mapgen';
import { step } from '../src/sim/step';
import { BUILDINGS, UNITS, RESEARCH } from '../src/sim/data/defs';
import { TICK_HZ, type Difficulty } from '../src/sim/types';
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const w = generateWorld({ mode: 'skirmish', difficulty: opt('diff','veteran') as Difficulty, seed: +opt('seed','1'), mapSize: +opt('size','96') });
const bot = new Bot(+opt('level','2'));
const sp = new Map<string, number>();
const add = (k: string, v: number) => sp.set(k, (sp.get(k) ?? 0) + v);
let lastScrap = w.human.scrap, lastG = 0;
const every = +opt('every', '120');
for (let i = 0; i < +opt('minutes','12')*60*TICK_HZ && !w.result; i++) {
  bot.think(w);
  step(w);
  for (const e of w.events) {
    if (e.t === 'build_place') add('bld:' + e.kind, BUILDINGS[e.kind as string].cost.scrap);
    if (e.t === 'train_queued') add(UNITS[e.kind as string].from === 'hq' ? 'engineers' : 'units', UNITS[e.kind as string].cost.scrap);
    if (e.t === 'research_start') add('research', RESEARCH[e.id as string].cost.scrap);
  }
  w.events.length = 0;
  if (i % (every * TICK_HZ) === 0 && i > 0) {
    const g = w.human.stats.scrapGathered;
    const tot = [...sp.values()].reduce((a, b) => a + b, 0);
    const bld = [...sp].filter(([k]) => k.startsWith('bld:')).reduce((a, [, v]) => a + v, 0);
    console.log(`t=${w.time.toFixed(0)} gathered ${g|0} (+${(g-lastG)|0}) spentTracked ${tot} | units ${sp.get('units')??0} eng ${sp.get('engineers')??0} bld ${bld} research ${sp.get('research')??0} | ${[...sp].filter(([k])=>k.startsWith('bld:')).map(([k,v])=>k.slice(4)+':'+v).join(' ')}`);
    lastG = g;
  }
}
