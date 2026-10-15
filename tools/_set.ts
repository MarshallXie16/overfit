import { AXIOM_BAL } from '../src/sim/ai/axiom';
import { BOT_LEVELS } from '../src/sim/bot';
import { BUILDINGS, PROTOCOLS, RESEARCH, UNITS } from '../src/sim/data/defs';
import { ECON } from '../src/sim/systems/units';
import { DIFF } from '../src/sim/world';
const args = process.argv.slice(2);
const i = args.indexOf('--set');
const sets = i >= 0 ? args[i + 1] : process.env.SET ?? '';
const ROOTS: Record<string, unknown> = { AXIOM_BAL, ECON, UNITS, BUILDINGS, RESEARCH, PROTOCOLS, DIFF, BOT: BOT_LEVELS };
for (const kv of sets.split(',').filter(Boolean)) {
  const [path, raw] = kv.split('=');
  const keys = path.split('.');
  let o = ROOTS[keys[0]] as Record<string, unknown>;
  for (let k = 1; k < keys.length - 1; k++) o = o[keys[k]] as Record<string, unknown>;
  o[keys[keys.length - 1]] = JSON.parse(raw);
}
