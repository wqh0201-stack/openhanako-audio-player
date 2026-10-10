#!/usr/bin/env node
/* tools/icon-preview.mjs — 开发用：音量图标候选画法/尺寸与参考图标的并排对比。
 * 用法：node tools/icon-preview.mjs → /tmp/hap-icons/volume.png
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
await page.setViewport({ width: 820, height: 520, deviceScaleFactor: 2 });
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });

/* 喇叭：小 = 现有；大 = 等比放大（9×15 网格单位） */
const SPK_S = 'M4.4 9.4h3.2l4.2-3.4v12l-4.2-3.4H4.4z';
const SPK_B = 'M3.5 8.5h4l5-4v15l-5-4H3.5z';
/* 弧线（同心，半张角 40°） */
const S_A = ['M14.85 9.56a3.8 3.8 0 0 1 0 4.88', 'M16.92 7.82a6.5 6.5 0 0 1 0 8.36', 'M18.99 6.08a9.2 9.2 0 0 1 0 11.84'];
const B_A = ['M15.41 9.56a3.8 3.8 0 0 1 0 4.88', 'M17.56 7.76a6.6 6.6 0 0 1 0 8.48', 'M19.70 5.96a9.4 9.4 0 0 1 0 12.08'];
const B_T = ['M14.80 10.07a3 3 0 0 1 0 3.86', 'M16.48 8.66a5.2 5.2 0 0 1 0 6.68', 'M18.17 7.24a7.4 7.4 0 0 1 0 9.52'];

await page.evaluate((SPK_S, SPK_B, S_A, B_A, B_T) => {
  const defs = document.querySelector('svg.svg-defs') || document.body;
  const add = (id, paths) => {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'symbol');
    s.setAttribute('id', id); s.setAttribute('viewBox', '0 0 24 24');
    s.innerHTML = paths.map((d) => `<path d="${d}"/>`).join('');
    defs.appendChild(s);
  };
  const set = (p, arcs) => [p].concat(arcs);
  add('S1', set(SPK_S, S_A.slice(0, 1))); add('S2', set(SPK_S, S_A.slice(0, 2))); add('S3', set(SPK_S, S_A));
  add('B1', set(SPK_B, B_A.slice(0, 1))); add('B2', set(SPK_B, B_A.slice(0, 2))); add('B3', set(SPK_B, B_A));
  add('T1', set(SPK_B, B_T.slice(0, 1))); add('T2', set(SPK_B, B_T.slice(0, 2))); add('T3', set(SPK_B, B_T));
  const st = document.createElement('style');
  st.textContent = `
    body{margin:0;background:#414D56;color:#E1EAF0;font:12px/1.4 -apple-system,sans-serif}
    .board{position:fixed;inset:0;z-index:99999;background:#414D56;overflow:auto;padding:8px 14px}
    .row{display:flex;align-items:center;gap:3px;padding:6px 0;border-bottom:1px solid rgba(255,255,255,.10)}
    .lbl{width:180px;opacity:.82;flex:0 0 auto;font-size:11px}
    .cell{width:44px;height:44px;display:inline-flex;align-items:center;justify-content:center;color:#9FB1BC}
    .sep{width:1px;height:30px;background:rgba(255,255,255,.25);margin:0 6px}
    .icon{fill:none;stroke:currentColor;stroke-linecap:round;stroke-linejoin:round}
  `;
  document.head.appendChild(st);
  const board = document.createElement('div'); board.className = 'board';
  const ic = (id, px, sw) => `<svg class="icon" width="${px}" height="${px}" viewBox="0 0 24 24" style="stroke-width:${sw}"><use href="#${id}"/></svg>`;
  const ref = () => ic('i-search', 21, 1.65) + ic('i-heart', 19, 1.65) + ic('i-shuffle', 19, 1.65);
  const row = (label, html) => { const r = document.createElement('div'); r.className = 'row'; r.innerHTML = `<div class="lbl">${label}</div>` + html; board.appendChild(r); };
  row('参考：search21 heart19 shuffle19', ref());
  row('A 现版 小喇叭 @22 · 1.43', ic('S1', 22, 1.43) + ic('S2', 22, 1.43) + ic('S3', 22, 1.43) + '<span class="sep"></span>' + ref());
  row('B 小喇叭 @26 · 1.21', ic('S1', 26, 1.21) + ic('S2', 26, 1.21) + ic('S3', 26, 1.21) + '<span class="sep"></span>' + ref());
  row('C 小喇叭 @28 · 1.12', ic('S1', 28, 1.12) + ic('S2', 28, 1.12) + ic('S3', 28, 1.12) + '<span class="sep"></span>' + ref());
  row('D 大喇叭 @23 · 1.36', ic('B1', 23, 1.36) + ic('B2', 23, 1.36) + ic('B3', 23, 1.36) + '<span class="sep"></span>' + ref());
  row('E 大喇叭 @25 · 1.25', ic('B1', 25, 1.25) + ic('B2', 25, 1.25) + ic('B3', 25, 1.25) + '<span class="sep"></span>' + ref());
  row('F 大喇叭+紧弧 @24 · 1.31', ic('T1', 24, 1.31) + ic('T2', 24, 1.31) + ic('T3', 24, 1.31) + '<span class="sep"></span>' + ref());
  row('G 大喇叭+紧弧 @26 · 1.21', ic('T1', 26, 1.21) + ic('T2', 26, 1.21) + ic('T3', 26, 1.21) + '<span class="sep"></span>' + ref());
  document.body.appendChild(board);
}, SPK_S, SPK_B, S_A, B_A, B_T);

await page.screenshot({ path: path.join(outDir, 'volume.png'), fullPage: true });
console.log('wrote', path.join(outDir, 'volume.png'));
await browser.close();
server.close();
