import './_set';
import { Bot } from '../src/sim/bot';
import { generateWorld } from '../src/sim/mapgen';
import { step } from '../src/sim/step';
import { TICK_HZ, type Difficulty } from '../src/sim/types';
const args = process.argv.slice(2);
const opt = (k: string, d: string) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : d; };
const w = generateWorld({ mode: 'skirmish', difficulty: opt('diff','veteran') as Difficulty, seed: +opt('seed','1'), mapSize: +opt('size','96') });
const bot = new Bot(+opt('level','2'));
const ids = opt('ids','6').split(',').map(Number);
const t0 = +opt('from','0'), t1 = +opt('to','60'), every = +opt('every','2');
const R = +opt('r', '0');
for (let i = 0; i < t1*TICK_HZ && !w.result; i++) {
  bot.think(w);
  step(w);
  w.events.length = 0;
  if (w.time >= t0 && i % Math.round(every*TICK_HZ) === 0) {
    for (const id of ids) {
      const e = w.byId.get(id);
      if (!e) { console.log(`t=${w.time.toFixed(1)} #${id} gone`); continue; }
      const tile = (x: number, y: number) => w.inBounds(x|0,y|0) ? w.grid.walk[(y|0)*w.w+(x|0)] : -1;
      console.log(`t=${w.time.toFixed(1)} ${e.kind}#${id} t${e.team} @${e.x.toFixed(2)},${e.y.toFixed(2)} walk=${tile(e.x,e.y)} order=${JSON.stringify(e.order)} q=${e.queue.length} tgt=${e.targetId} path=${e.path ? e.path.length + '@' + e.pathI + ' ->' + e.path.map(p=>p.x.toFixed(1)+','+p.y.toFixed(1)).slice(e.pathI, e.pathI+2).join(' ') : 'null'} stuck=${e.stuckT.toFixed(1)} v=${e.vx.toFixed(2)},${e.vy.toFixed(2)} hp=${e.hp|0}`);
      if (R > 0) {
        let s = '';
        for (let y = Math.floor(e.y) - R; y <= Math.floor(e.y) + R; y++) { let row = ''; for (let x = Math.floor(e.x) - R; x <= Math.floor(e.x) + R; x++) { const c = tile(x+0.5,y+0.5); const here = x === Math.floor(e.x) && y === Math.floor(e.y); row += here ? '@' : c === 0 ? '#' : c === 3 ? 'B' : c === 2 ? '~' : c === 1 ? '.' : ' '; } s += '   ' + row + '\n'; }
        console.log(s);
      }
    }
  }
}
