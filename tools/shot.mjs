// Usage: node tools/shot.mjs <url> <out.png> [waitMs=1500] [width=1440] [height=900]
// Headless screenshot via system Chrome. Prints console errors/warnings from the page.
import { chromium } from 'playwright';
const [url, out, waitMs = '1500', w = '1440', h = '900'] = process.argv.slice(2);
if (!url || !out) { console.error('usage: node tools/shot.mjs <url> <out.png> [waitMs] [w] [h]'); process.exit(1); }
const browser = await chromium.launch({ channel: 'chrome', args: ['--use-angle=metal', '--enable-gpu'] });
const page = await browser.newPage({ viewport: { width: +w, height: +h } });
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log(`[${m.type()}]`, m.text()); });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(+waitMs);
await page.screenshot({ path: out });
await browser.close();
console.log('saved', out);
