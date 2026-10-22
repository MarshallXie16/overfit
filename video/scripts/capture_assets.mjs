// capture_assets.mjs — real screenshots of the live OVERFIT build for the intro film.
//   node scripts/capture_assets.mjs [baseUrl] [outDir=assets]
// Uses system Chrome (WebGL via Metal) like the game's own tools/shot.mjs. 1920x1080 at 2x.
import { chromium } from 'playwright';
import fs from 'node:fs';
const base = process.argv[2] ?? 'https://marshallxie16.github.io/overfit/';
const out = process.argv[3] ?? 'assets';
fs.mkdirSync(out, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2 });
await ctx.addInitScript(() => localStorage.setItem('overfit.settings', JSON.stringify({ master: 0, sfx: 0, music: 0, edgeScroll: false, quality: 1, showFps: false, advisor: true, difficulty: 'veteran', fpsCap: 60, renderScale: 'sharp' })));
const page = await ctx.newPage();
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text()); });
const shot = async (name) => { await page.screenshot({ path: `${out}/${name}.png` }); console.log('shot', name); };
const el = async (sel, name) => { const h = await page.$(sel); if (!h) return console.log('missing', sel); await h.screenshot({ path: `${out}/${name}.png` }); console.log('crop', name); };
const wait = (ms) => page.waitForTimeout(ms);

// ---- title + menus
await page.goto(base, { waitUntil: 'load' });
await page.waitForFunction(() => window.overfit?.session, null, { timeout: 60000 });
await wait(8000);                                   // let the attract demo build something
await shot('title');
await page.evaluate(() => { document.querySelector('.overlay.title').style.visibility = 'hidden'; });
await wait(400); await shot('title-demo');
await page.evaluate(() => { document.querySelector('.overlay.title').style.visibility = ''; });
await el('.title-wrap .logo', 'ui-logo-wordmark');
await el('.title-wrap', 'ui-title-wrap');
await el('.title-menu', 'ui-title-menu');
await page.click('[data-a=campaign]'); await wait(500); await shot('menu-campaign'); await el('.overlay .dialog', 'ui-dialog-campaign');
const firstMission = await page.$('[data-m]'); if (firstMission) { await firstMission.click(); await wait(500); await shot('menu-briefing'); await el('.overlay .dialog', 'ui-dialog-briefing'); }
await page.evaluate(() => window.overfit.menus.title()); await wait(300);
await page.click('[data-a=endless]'); await wait(500); await shot('menu-endless'); await el('.overlay .dialog', 'ui-dialog-endless');
await page.evaluate(() => window.overfit.menus.title()); await wait(300);
await page.click('[data-a=howto]'); await wait(500); await shot('menu-howto');

// ---- skirmish
await page.goto(base + '?quick=1&seed=7', { waitUntil: 'load' });
await page.waitForFunction(() => window.overfit?.session?.ctl, null, { timeout: 60000 });
await wait(1500);
await shot('game-00-start');
const info = await page.evaluate(() => { const w = window.overfit.session.world; const kinds = {}; for (const e of w.entities) if (e.alive) kinds[`${e.team}:${e.cat}:${e.kind}`] = (kinds[`${e.team}:${e.cat}:${e.kind}`] || 0) + 1; return { time: w.time, tick: w.tick, w: w.w, h: w.h, kinds }; });
console.log(JSON.stringify(info));
const hq = await page.evaluate(() => { const s = window.overfit.session, w = s.world; const e = w.entities.find((e) => e.kind === 'hq' && e.team === 1); return { ...s.r.worldToScreen(e.x, e.y), wx: e.x, wy: e.y }; });
await page.mouse.move(hq.x - 180, hq.y - 180); await page.mouse.down(); await page.mouse.move(hq.x + 180, hq.y + 180, { steps: 8 }); await page.mouse.up(); await wait(300);
await shot('game-01-select');
await el('#hud .selpanel', 'hud-selpanel-multi'); await el('#hud .cmdcard', 'hud-cmdcard-multi');
const eng = await page.evaluate(() => { const s = window.overfit.session, w = s.world; const e = w.entities.find((e) => e.alive && e.kind === 'engineer' && e.team === 1); s.ctl.setSelection([e.id]); return e.id; });
await wait(200); await el('#hud .selpanel', 'hud-selpanel-engineer');
await page.keyboard.press('b'); await wait(250); await shot('game-02-build-menu'); await el('#hud .cmdcard', 'hud-cmdcard-build');
await page.keyboard.press('Escape'); await wait(200);
await el('#hud .topbar', 'hud-topbar-0'); await el('#hud .model', 'hud-model-epoch0'); await el('#hud .protocols', 'hud-protocols-0'); await el('#hud .minimap', 'hud-minimap-0'); await el('#hud .objectives', 'hud-objectives');

// fast-forward the sim with a bot on the human side; keep the camera on the hottest fight
const ff = (ticks) => page.evaluate(async (ticks) => {
  const s = window.overfit.session, w = s.world, D = window.overfitDebug;
  if (!s.bot) s.bot = new D.Bot(2);
  for (let i = 0; i < ticks; i++) { s.bot.think(w); D.step(w); if (i % 100 === 99) { w.events = w.events.slice(-40); await new Promise((r) => setTimeout(r, 0)); } if (w.result) break; }
  w.events = w.events.slice(-40);
  const ax = w.axiom || {};
  return { time: w.time, tick: w.tick, result: w.result, epoch: ax.epoch, swarm: w.entities.filter((e) => e.alive && e.team === 2 && e.cat === 'unit').length, army: w.entities.filter((e) => e.alive && e.team === 1 && e.cat === 'unit').length };
}, ticks);
const aim = (zoom) => page.evaluate((zoom) => {
  const s = window.overfit.session, w = s.world;
  const hu = w.entities.filter((e) => e.alive && e.team === 1 && e.cat === 'unit'), ro = w.entities.filter((e) => e.alive && e.team === 2 && e.cat === 'unit');
  let best = null, bd = 1e9;
  for (const a of hu) for (const b of ro) { const d = Math.hypot(a.x - b.x, a.y - b.y); if (d < bd) { bd = d; best = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }; } }
  if (!best) { const e = w.entities.find((e) => e.kind === 'hq' && e.team === 1); best = { x: e.x, y: e.y }; }
  s.r.cam.x = best.x; s.r.cam.y = best.y; s.r.cam.zoom = zoom; if (s.camTarget) { s.camTarget.x = best.x; s.camTarget.y = best.y; }
  return { ...best, dist: bd };
}, zoom);
const stages = [[1800, '10'], [2400, '20'], [2400, '30'], [2400, '40'], [3600, '50']];
for (const [ticks, tag] of stages) {
  const st = await ff(ticks); console.log('ff', tag, JSON.stringify(st));
  const a = await aim(1.3); console.log('aim', JSON.stringify(a));
  await wait(700); await shot(`game-${tag}-fight-z13`);
  await aim(0.9); await wait(700); await shot(`game-${tag}-fight-z09`);
  await page.evaluate((hq) => { const s = window.overfit.session; s.r.cam.x = hq.wx + 4; s.r.cam.y = hq.wy - 2; s.r.cam.zoom = 1.1; if (s.camTarget) { s.camTarget.x = hq.wx + 4; s.camTarget.y = hq.wy - 2; } }, hq);
  await wait(700); await shot(`game-${tag}-base`);
  await el('#hud .model', `hud-model-${tag}`); await el('#hud .minimap', `hud-minimap-${tag}`); await el('#hud .topbar', `hud-topbar-${tag}`); await el('#hud .protocols', `hud-protocols-${tag}`);
  const ann = await page.evaluate(() => document.querySelector('#hud .announce')?.textContent?.trim() || '');
  if (ann) { console.log('announce:', ann); await el('#hud .announce', `hud-announce-${tag}`); }
  if (st.result) { await wait(1500); await shot(`game-${tag}-end`); break; }
}
await browser.close();
console.log('done');
