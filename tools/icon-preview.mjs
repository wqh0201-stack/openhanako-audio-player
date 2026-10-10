#!/usr/bin/env node
/* tools/icon-preview.mjs — 开发用：渲染控制条音量图标的候选画法/尺寸，肉眼校准。
 * 用法：node tools/icon-preview.mjs   → /tmp/hap-icons/volume.png
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER_CORE || '/Volumes/SSD/hanadesk/鹈鹕/motion-reel/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uiDir = path.join(repo, 'ui');
const outDir = '/tmp/hap-icons';
fs.mkdirSync(outDir, { recursive: true });
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  let p = decodeURIComponent(u.pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(uiDir, p);
  if (!file.startsWith(uiDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('nf'); }
  res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
  return fs.createReadStream(file).pipe(res);
});
const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${port}`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.setViewport({ width: 760, height: 420, deviceScaleFactor: 2 });
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });

/* 候选音量画法：扬声器沿用现有的，三档弧线同心（圆心 ≈ 扬声器嘴 x=11.94, y=12），
 * 半张角 40°，半径 3.8 / 6.5 / 9.2（间距 2.7）。 */
const SPEAKER = 'M4.4 9.4h3.2l4.2-3.4v12l-4.2-3.4H4.4z';
const A1 = 'M14.85 9.56a3.8 3.8 0 0 1 0 4.88';
const A2 = 'M16.92 7.82a6.5 6.5 0 0 1 0 8.36';
const A3 = 'M18.99 6.08a9.2 9.2 0 0 1 0 11.84';

await page.evaluate((SPEAKER, A1, A2, A3) => {
  const defs = document.querySelector('svg.svg-defs') || document.body;
  const add = (id, paths) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
    s.setAttribute('id', id); s.setAttribute('viewBox', '0 0 24 24');
    s.innerHTML = paths.map((d) => `<path d="${d}"/>`).join('');
    defs.appendChild(s);
  };
  add('v-1', [SPEAKER, A1]);
  add('v-2', [SPEAKER, A1, A2]);
  add('v-3', [SPEAKER, A1, A2, A3]);
  add('v-mute', [SPEAKER, 'M15 9.6 19.6 14.4M19.6 9.6 15 14.4']);
  const st = document.createElement('style');
  st.textContent = `
    body { margin:0; background:#414D56; color:#E1EAF0; font:12px/1.4 -apple-system,sans-serif; }
    .board { position:fixed; inset:0; z-index:99999; background:#414D56; overflow:auto; padding:10px 16px; }
    .row { display:flex; align-items:center; gap:2px; padding:7px 0; border-bottom:1px solid rgba(255,255,255,.10); }
    .lbl { width:150px; opacity:.8; flex:0 0 auto; }
    .cell { width:46px; height:46px; display:inline-flex; align-items:center; justify-content:center; color:#9FB1BC; }
    .icon { fill:none; stroke:currentColor; stroke-linecap:round; stroke-linejoin:round; }
    .icon.solid { fill:currentColor; stroke-width:1.3; }
  `;
  document.head.appendChild(st);
  const board = document.createElement('div'); board.className = 'board';
  const icon = (id, px, sw, solid) => `<svg class="icon${solid ? ' solid' : ''}" width="${px}" height="${px}" viewBox="0 0 24 24"${solid ? '' : ` style="stroke-width:${sw}"`}><use href="#${id}"/></svg>`;
  const row = (label, html) => { const r = document.createElement('div'); r.className = 'row'; r.innerHTML = `<div class="lbl">${label}</div>` + html; board.appendChild(r); };
  row('参考 shuffle 19/1.65', icon('i-shuffle', 19, 1.65) + icon('i-search', 19, 1.65) + icon('i-heart', 19, 1.65));
  row('旧音量 19 / 28（28=太粗）', icon('i-volume', 19, 1.65) + icon('i-volume', 28, 1.65) + icon('i-volume-mute', 28, 1.65));
  row('新 1/2/3 @19 · 1.65', icon('v-1', 19, 1.65) + icon('v-2', 19, 1.65) + icon('v-3', 19, 1.65) + icon('v-mute', 19, 1.65));
  row('新 1/2/3 @22 · 1.43', icon('v-1', 22, 1.43) + icon('v-2', 22, 1.43) + icon('v-3', 22, 1.43) + icon('v-mute', 22, 1.43));
  row('新 1/2/3 @24 · 1.31', icon('v-1', 24, 1.31) + icon('v-2', 24, 1.31) + icon('v-3', 24, 1.31) + icon('v-mute', 24, 1.31));
  row('新 1/2/3 @26 · 1.21', icon('v-1', 26, 1.21) + icon('v-2', 26, 1.21) + icon('v-3', 26, 1.21) + icon('v-mute', 26, 1.21));
  row('新 @22 与参考并排', icon('i-search', 21, 1.65) + icon('i-heart', 19, 1.65) + icon('i-shuffle', 19, 1.65) + icon('v-1', 22, 1.43) + icon('v-2', 22, 1.43) + icon('v-3', 22, 1.43));
  document.body.appendChild(board);
}, SPEAKER, A1, A2, A3);

await page.screenshot({ path: path.join(outDir, 'volume.png'), fullPage: true });
console.log('wrote', path.join(outDir, 'volume.png'));
await browser.close();
server.close();
