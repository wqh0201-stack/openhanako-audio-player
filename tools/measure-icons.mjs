#!/usr/bin/env node
/* tools/measure-icons.mjs — 量控制条每个图标在 24×24 viewBox 里的「实际内容包围盒」。
 * 用途：图标框都是 19px，但每个 symbol 在网格里占的视觉面积不同（音量偏小就是这么来的）。
 * 起个静态服务加载 ui/index.html，为每个 symbol 造一个 24×24 的 <use>，读 getBBox()。
 * 用法：node tools/measure-icons.mjs
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
const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json', '.txt': 'text/plain' };

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  let p = decodeURIComponent(u.pathname);
  if (p === '/') p = '/index.html';
  const file = path.join(uiDir, p);
  if (!file.startsWith(uiDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.statusCode = 404; return res.end('not found');
  }
  res.setHeader('content-type', MIME[path.extname(file)] || 'application/octet-stream');
  return fs.createReadStream(file).pipe(res);
});

const port = await new Promise((r) => server.listen(0, '127.0.0.1', () => r(server.address().port)));
const BASE = `http://127.0.0.1:${port}`;

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--no-sandbox'] });
const page = await browser.newPage();
await page.goto(`${BASE}/index.html`, { waitUntil: 'domcontentloaded' });

const ids = await page.evaluate(() => Array.from(document.querySelectorAll('svg.svg-defs symbol')).map((s) => s.id));

const rows = await page.evaluate((ids) => {
  const out = [];
  for (const id of ids) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '24');
    svg.setAttribute('height', '24');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.style.position = 'absolute';
    svg.style.left = '-9999px';
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    use.setAttribute('href', '#' + id);
    svg.appendChild(use);
    document.body.appendChild(svg);
    let b = { x: 0, y: 0, width: 0, height: 0 };
    try { b = use.getBBox(); } catch (e) { /* ignore */ }
    out.push({ id, x: +b.x.toFixed(2), y: +b.y.toFixed(2), w: +b.width.toFixed(2), h: +b.height.toFixed(2) });
    svg.remove();
  }
  return out;
}, ids);

// 当前控制条 CSS 里各图标的渲染框（px）
const BOX = {
  'i-search': 19, 'i-heart': 19, 'i-shuffle': 19, 'i-repeat': 19, 'i-repeat-one': 19,
  'i-prev': 18, 'i-next': 18, 'i-play': 19, 'i-pause': 19, 'i-list': 19, 'i-volume': 19, 'i-volume-mute': 19
};

console.log('id'.padEnd(16), 'bbox(x,y,w,h)'.padEnd(24), 'box(px)'.padEnd(8), 'visual(px)'.padEnd(12));
for (const r of rows) {
  const box = BOX[r.id];
  const vw = box ? (r.w / 24 * box).toFixed(1) : '-';
  const vh = box ? (r.h / 24 * box).toFixed(1) : '-';
  console.log(r.id.padEnd(16), `${r.x},${r.y},${r.w},${r.h}`.padEnd(24), String(box || '-').padEnd(8), (box ? `${vw} x ${vh}` : '-'));
}

await browser.close();
server.close();
