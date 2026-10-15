// Converts dist-single/index.html into artifact-page content (no document skeleton):
// <title>, the inlined <style> blocks, the body markup and the inline module script.
import fs from 'node:fs';
const src = fs.readFileSync('dist-single/index.html', 'utf8');
const head = src.slice(src.indexOf('<head>') + 6, src.indexOf('</head>'));
const body = src.slice(src.indexOf('<body>') + 6, src.lastIndexOf('</body>'));
const styles = [...head.matchAll(/<style[^>]*>[\s\S]*?<\/style>/g)].map((m) => m[0]);
const scripts = [...head.matchAll(/<script type="module"[^>]*>[\s\S]*?<\/script>/g)].map((m) => m[0].replace(' crossorigin', ''));
const bodyNoScript = body.replace(/<script type="module" src="[^"]*"><\/script>/g, '');
const out = [
  '<title>OVERFIT</title>',
  '<meta name="description" content="A browser RTS: hold the line against an ever-growing robot swarm that retrains on how you fight.">',
  '<style>html,body{height:100%;margin:0;background:#07090c;color:#d6e2e0;overflow:hidden}</style>',
  ...styles,
  bodyNoScript.trim(),
  ...scripts,
].join('\n');
fs.mkdirSync('artifact', { recursive: true });
fs.writeFileSync('artifact/overfit.html', out);
console.log('artifact/overfit.html', (out.length / 1024).toFixed(0) + ' KB', `styles ${styles.length} scripts ${scripts.length}`);
