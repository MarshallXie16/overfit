// End-to-end UI smoke test with real mouse/keyboard input.
// Usage: node tools/e2e.mjs [baseUrl=http://127.0.0.1:5173/] [outDir=output/e2e]
import { chromium } from 'playwright';
import fs from 'node:fs';

const base = process.argv[2] ?? 'http://127.0.0.1:5173/';
const out = process.argv[3] ?? 'output/e2e';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const errors = [];
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
await page.addInitScript(() => localStorage.setItem('overfit.settings', JSON.stringify({ edgeScroll: false, master: 0 })));
await page.goto(base + '?quick=1&seed=7', { waitUntil: 'load' });
await page.waitForFunction(() => window.overfit?.session?.ctl, null, { timeout: 20000 });
await page.waitForTimeout(500);

const results = [];
const check = (name, ok, info = '') => { results.push({ name, ok, info }); console.log(`${ok ? 'PASS' : 'FAIL'} ${name} ${info}`); };
const shot = (n) => page.screenshot({ path: `${out}/${n}.png` });
const S = () => page.evaluate(() => {
  const s = window.overfit.session; const w = s.world;
  return {
    scrap: w.human.scrap, time: w.time, sel: s.ctl.selection.length,
    ents: w.entities.filter((e) => e.alive && e.team === 1).map((e) => ({ id: e.id, kind: e.kind, x: e.x, y: e.y, order: e.order?.type ?? null, built: e.built })),
  };
});
const toScreen = (x, y) => page.evaluate(([x, y]) => window.overfit.session.r.worldToScreen(x, y), [x, y]);

// 1. box select everything around HQ
let st = await S();
const hq = st.ents.find((e) => e.kind === 'hq');
const c = await toScreen(hq.x, hq.y);
await page.mouse.move(c.x - 170, c.y - 170);
await page.mouse.down();
await page.mouse.move(c.x + 170, c.y + 170, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(150);
st = await S();
check('box select', st.sel >= 6, `selected ${st.sel}`);
await shot('01-select');

// 2. right-click scrap with engineers only
const engs = st.ents.filter((e) => e.kind === 'engineer');
await page.evaluate((ids) => window.overfit.session.ctl.setSelection(ids), engs.map((e) => e.id));
const scrap = await page.evaluate(([x, y]) => {
  const w = window.overfit.session.world;
  let best = null, bd = 1e9;
  for (const e of w.entities) if (e.alive && e.cat === 'resource' && w.explored[(e.y | 0) * w.w + (e.x | 0)]) { const d = Math.hypot(e.x - x, e.y - y); if (d < bd) { bd = d; best = { x: e.x, y: e.y, id: e.id }; } }
  return best;
}, [hq.x, hq.y]);
if (scrap) {
  const sc = await toScreen(scrap.x, scrap.y);
  await page.mouse.click(sc.x, sc.y, { button: 'right' });
  await page.waitForTimeout(300);
  st = await S();
  check('harvest order via right-click', st.ents.filter((e) => e.kind === 'engineer' && e.order === 'harvest').length === engs.length, JSON.stringify(st.ents.filter((e) => e.kind === 'engineer').map((e) => e.order)));
} else check('scrap visible near HQ', false);

// 3. build a generator via hotkeys + click
await page.evaluate((id) => window.overfit.session.ctl.setSelection([id]), engs[0].id);
await page.keyboard.press('b');
await page.keyboard.press('g');
await page.waitForTimeout(100);
const mode = await page.evaluate(() => window.overfit.session.ctl.mode);
check('placement mode', mode.m === 'place' && mode.kind === 'generator', JSON.stringify(mode));
// find a valid spot
const spot = await page.evaluate(([x, y]) => {
  const w = window.overfit.session.world;
  for (let r = 4; r < 14; r++) for (let a = 0; a < 24; a++) {
    const tx = Math.round(x + Math.cos(a / 24 * 6.283) * r), ty = Math.round(y + Math.sin(a / 24 * 6.283) * r);
    if (w.canPlace('generator', tx, ty).ok) return { tx, ty };
  }
  return null;
}, [hq.x, hq.y]);
const gp = await toScreen(spot.tx + 1, spot.ty + 1);
await page.mouse.move(gp.x, gp.y);
await page.waitForTimeout(100);
await shot('02-ghost');
await page.mouse.click(gp.x, gp.y);
await page.waitForTimeout(200);
st = await S();
const gen = st.ents.find((e) => e.kind === 'generator');
check('generator placed', !!gen, `scrap ${st.scrap}`);

// 4. let time pass at 2x and confirm it builds
await page.evaluate(() => { const s = window.overfit.session; s.speedIdx = 3; });
await page.waitForFunction(() => window.overfit.session.world.entities.some((e) => e.kind === 'generator' && e.built), null, { timeout: 30000 }).catch(() => {});
st = await S();
check('generator completes', !!st.ents.find((e) => e.kind === 'generator' && e.built), `t=${st.time.toFixed(1)}`);
await shot('03-built');

// 5. attack-move with riflemen via A + click
const rif = st.ents.filter((e) => e.kind === 'rifleman');
await page.evaluate((ids) => window.overfit.session.ctl.setSelection(ids), rif.map((e) => e.id));
await page.keyboard.press('a');
const am = await toScreen(hq.x + 6, hq.y - 4);
await page.mouse.click(am.x, am.y);
await page.waitForTimeout(150);
st = await S();
check('attack-move', st.ents.filter((e) => e.kind === 'rifleman' && e.order === 'amove').length >= 1, JSON.stringify(st.ents.filter((e) => e.kind === 'rifleman').map((e) => e.order)));

// 6. control group + recall
await page.keyboard.down('Control'); await page.keyboard.press('1'); await page.keyboard.up('Control');
await page.evaluate(() => window.overfit.session.ctl.setSelection([]));
await page.keyboard.press('1');
st = await S();
check('control group recall', st.sel === rif.length, `sel ${st.sel}`);

// 7. pause menu
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
const paused = await page.evaluate(() => window.overfit.session.world.paused && !!document.querySelector('.overlay'));
check('esc opens pause menu', paused);
await shot('04-pause');
await page.keyboard.press('Escape');
await page.waitForTimeout(200);
check('esc resumes', await page.evaluate(() => !window.overfit.session.world.paused && !document.querySelector('.overlay')));

// 8. run to first surge, watch perf
await page.evaluate(() => { const w = window.overfit.session.world; w.axiom.surgeT = 3; });
await page.waitForTimeout(9000);
const perf = await page.evaluate(() => ({ fps: window.overfit.session.fps, step: window.overfit.session.stepMs, robots: window.overfit.session.world.axiom.units, surge: window.overfit.session.world.axiom.surgeN }));
check('surge launched', perf.surge >= 1, JSON.stringify(perf));
await shot('05-surge');

console.log(`\n${results.filter((r) => r.ok).length}/${results.length} passed; console errors: ${errors.length}`);
for (const e of errors.slice(0, 10)) console.log('  ERR', e);
await browser.close();
process.exit(results.every((r) => r.ok) && errors.length === 0 ? 0 : 1);
