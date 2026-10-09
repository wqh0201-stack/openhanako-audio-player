#!/usr/bin/env node
/* ============================================================
   tools/verify-ui.mjs — 生产 ui/ 的无头验收（开发用）
   零业务依赖：起本地 HTTP 服务（ui/ + 假后端），用 puppeteer-core 驱动系统 Chrome：
     · 六种尺寸 × 浅深主题：跑页面内自检（?assert=1）+ 出截图（12 组布局自检）
     · 接线冒烟：拉列表 / 播放 / 上下首 / 歌词 / 导入链接 / 删除
     · 精修矩阵：312/465/1040 × 浅深 × 歌词开/关 + 312 档自检
     · 主题双保险：hana-css 注入 / palette 跟随系统深浅 / 无宿主兜底 / 宿主优先
   鉴权闸门（无票 403）与滚动条断言（悬停前后歌词宽度必须相等）都在本文件里，
   不许绕过。
   用法：node tools/verify-ui.mjs
   ============================================================ */
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const puppeteer = require(process.env.PUPPETEER_CORE || '/Volumes/SSD/hanadesk/鹈鹕/motion-reel/node_modules/puppeteer-core');
const CHROME = process.env.CHROME_BIN || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const uiDir = path.join(repo, 'ui');
const outDir = process.env.OUT_DIR || '/tmp/hap-verify';
const API = '/api/apps/hanako-audio-player/routes';
const COVER_FILE = path.join(repo, 'docs/player-ui/assets/demo-cover.png');
const COVER_SQUARE_FILE = path.join(repo, 'docs/player-ui/assets/demo-cover-square.png');
fs.mkdirSync(outDir, { recursive: true });

/* ---------- 假音频：30 秒静音 WAV（走 URL，不走 data URL） ----------
 * 30 秒是为了让接线冒烟不跟 1 秒音频的 ended 连锁自动切歌撞车（点完到断言
 * 有 0.7~0.9s 窗口，ended 恰好落在里面就会张冠李戴）；走 URL 同时让 <audio>
 * 真实经过 withSession 贴票路径，也避免 savePlaylist 把巨型 data URL 回写。 */
const WAV_SECONDS = 30;
const pcm = Buffer.alloc(44100 * 2 * WAV_SECONDS);
const wav = Buffer.alloc(44 + pcm.length);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(44100 * 2, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40);
pcm.copy(wav, 44);
const WAV_URL = `${API}/_fixture/audio.wav`;

/* ---------- 假播放列表（48 首，含在线曲目，测去重/歌词/删除） ---------- */
function makeTracks(n) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const online = i % 4 === 3;
    out.push(online
      ? { id: `netease:${900000 + i}`, name: `在线曲目 ${i + 1}`, url: `/api/apps/hanako-audio-player/routes/widget/api/music/go/${900000 + i}?server=netease`, mode: '在线', dur: 0, group: '在线音乐', pic: `${API}/_fixture/cover-square.png` }
      : { id: `fixture-${String(i + 1).padStart(2, '0')}.wav`, name: `本地曲目 ${i + 1}`, url: WAV_URL, mode: '本地', dur: 0, group: '本地音乐' });
  }
  // 前两首给封面图（一张方形 / 一张横幅），验「封面贴左不裁切」的两种画幅
  out[0].pic = `${API}/_fixture/cover-square.png`;
  out[1].pic = `${API}/_fixture/cover.png`;
  // 复刻罐头的真实数据：只有搜索词、没有 url/id 的旧版在线曲目
  for (let k = 0; k < 3; k++) {
    out.push({ name: `搜索曲目 ${k + 1}`, url: '', mode: '在线', dur: 0, group: '鸣潮', searchKey: `关键词 ${k + 1}`, searchServer: 'netease' });
  }
  return out;
}
const TRACKS = makeTracks(48);

function lrcFor(name) {
  return Array.from({ length: 40 }, (_, i) => `[00:0${Math.floor(i / 10)}.${String((i % 10) * 10).padStart(2, '0')}]${name} 第 ${i + 1} 行歌词`).join('\n');
}
function json(res, code, obj) {
  res.statusCode = code;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(obj));
}
function text(res, code, body, type) {
  res.statusCode = code;
  res.setHeader('content-type', type || 'text/plain; charset=utf-8');
  res.end(body);
}

const server = http.createServer((req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  const p = u.pathname;
  if (p === '/favicon.ico') { res.statusCode = 204; return res.end(); }

  // 复刻宿主鉴权：/routes/ 下的请求必须带 surface session（header 或 query），否则 403。
  // 少了这一层，前端忘了带票也会“假绿”——正是这次踩的坑。
  if (p.startsWith(API + '/')) {
    const hasHeader = (req.headers['x-hana-app-surface-session'] || '').trim();
    const hasQuery = (u.searchParams.get('appSurfaceSession') || '').trim();
    if (!hasHeader && !hasQuery) {
      return json(res, 403, { error: 'forbidden', reason: 'missing_credential', connectionKind: 'local' });
    }
  }

  // 假后端
  if (p === API + '/widget/api/playlist') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => json(res, 200, { ok: true, count: 0 }));
      return;
    }
    return json(res, 200, { ok: true, tracks: TRACKS, count: TRACKS.length });
  }
  if (p === API + '/api/track' && req.method === 'DELETE') return json(res, 200, { ok: true, removed: 1, count: TRACKS.length - 1 });
  if (p === API + '/widget/api/lrc/load') return json(res, 404, { ok: false, error: 'not found' });
  if (p === API + '/widget/api/lrc/save') return json(res, 200, { ok: true, filename: 'x.lrc' });
  if (p === API + '/widget/api/music/lrc') return text(res, 200, lrcFor('fixture'), 'text/plain; charset=utf-8');
  if (p === API + '/widget/api/music/lrc-proxy') return text(res, 200, lrcFor('proxy'), 'text/plain; charset=utf-8');
  if (p === API + '/widget/api/music/ttml') return text(res, 404, 'not in amll-db');
  if (p === API + '/widget/api/music/song') {
    const id = u.searchParams.get('id') || '0';
    return json(res, 200, { ok: true, track: { id: `netease:${id}`, title: `在线单曲 ${id}`, author: '测试歌手', url: `${API}/widget/api/music/go/${id}?server=netease`, pic: '', lrc: '' }, host: 'mock' });
  }
  if (p === API + '/_fixture/cover.png') {
    res.setHeader('content-type', 'image/png');
    return fs.createReadStream(COVER_FILE).pipe(res);
  }
  if (p === API + '/_fixture/cover-square.png') {
    res.setHeader('content-type', 'image/png');
    return fs.createReadStream(COVER_SQUARE_FILE).pipe(res);
  }
  if (p === API + '/_fixture/audio.wav') { res.setHeader('content-type', 'audio/wav'); return res.end(wav); }
  // 假主题样式表（真实宿主同款端点 /api/apps/theme.css，不需要 surface session）
  if (p === '/api/apps/theme.css') {
    const name = u.searchParams.get('theme') || '';
    const HOSTFIX = { '--bg': '#112233', '--bg-card': '#1B2E44', '--text': '#E8F2FF', '--text-muted': '#8FA8C0', '--text-light': '#8FA8C0', '--accent': '#22AA88', '--border': 'rgba(150,180,220,0.2)' };
    const vars = /dark/.test(name) ? THEME_VARS.dark : (/hostfix/.test(name) ? HOSTFIX : THEME_VARS.light);
    return text(res, 200, ':root{' + Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';') + ';}', 'text/css; charset=utf-8');
  }
  if (p === API + '/widget/api/music/search') {
    const kw = u.searchParams.get('keyword') || '';
    return json(res, 200, { ok: true, results: [{ id: `netease:${770000 + kw.length}`, title: `命中 ${kw}`, author: '搜索歌手', url: `${API}/widget/api/music/go/${770000 + kw.length}?server=netease`, pic: '', lrc: 'http://mock/lrc/' + encodeURIComponent(kw) }], host: 'mock', total: 1 });
  }
  if (p === API + '/widget/api/music/playlist') {
    const id = u.searchParams.get('id') || '0';
    const tracks = Array.from({ length: 5 }, (_, i) => ({ id: `netease:${id}${i}`, title: `歌单曲目 ${i + 1}`, author: '测试', url: `${API}/widget/api/music/go/${id}${i}?server=netease`, pic: '', lrc: '' }));
    return json(res, 200, { ok: true, tracks, host: 'mock' });
  }
  if (p === API + '/widget/api/import-file') {
    const src = u.searchParams.get('path') || '';
    const base = path.basename(src);
    return json(res, 200, { ok: true, id: base, name: base.replace(/\.\w+$/, ''), url: WAV_URL, mode: '本地' });
  }
  if (p === API + '/widget/api/scan-folder') return json(res, 200, { ok: true, files: [], count: 0 });
  if (p.startsWith(API + '/widget/api/music/go/')) { res.setHeader('content-type', 'audio/wav'); return res.end(wav); }
  if (p.startsWith(API + '/widget/media/')) { res.setHeader('content-type', 'audio/wav'); return res.end(wav); }
  if (p.startsWith(API + '/')) return json(res, 200, { ok: true });

  // ui/ 静态文件
  if (p.startsWith('/api/apps/hanako-audio-player/ui/')) {
    const rel = decodeURIComponent(p.slice('/api/apps/hanako-audio-player/ui/'.length)) || 'index.html';
    const f = path.join(uiDir, rel);
    if (!f.startsWith(uiDir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end('not found'); }
    res.setHeader('content-type', f.endsWith('.js') ? 'text/javascript; charset=utf-8' : f.endsWith('.json') ? 'application/json' : f.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    return fs.createReadStream(f).pipe(res);
  }
  // 直接按路径访问 ui/（页面以 /index.html 打开）
  const f = path.join(uiDir, decodeURIComponent(p === '/' ? 'index.html' : p));
  if (f.startsWith(uiDir) && fs.existsSync(f) && !fs.statSync(f).isDirectory()) {
    res.setHeader('content-type', f.endsWith('.js') ? 'text/javascript; charset=utf-8' : f.endsWith('.json') ? 'application/json' : f.endsWith('.css') ? 'text/css' : 'text/html; charset=utf-8');
    return fs.createReadStream(f).pipe(res);
  }
  res.statusCode = 404; res.end('not found');
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;

/* ---------- 主题夹具 ---------- */
const THEME_VARS = {
  light: { '--bg': '#F8F4ED', '--bg-card': '#FCFAF5', '--text': '#3B3D3F', '--text-muted': '#8E9196', '--text-light': '#6B6F73', '--accent': '#537D96', '--border': 'rgba(122,96,88,0.18)' },
  dark: { '--bg': '#3B4A54', '--bg-card': '#445560', '--text': '#E1EAF0', '--text-muted': '#9FB1BC', '--text-light': '#9FB1BC', '--accent': '#C99AAF', '--border': 'rgba(170,121,141,0.16)' }
};

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--force-device-scale-factor=1']
});

const report = { selfCheck: [], wiring: {}, runtimeErrors: [], expectedProbes: [], assertions: [] };

/* 断言登记：不通过就退非零，结果里逐条列出 */
function assert(name, ok, detail) {
  report.assertions.push({ name, ok: !!ok, detail: String(detail === undefined ? '' : detail) });
}
/* 预期噪声（文档已记）：降级链的探测性 404（离线库没命中 → 走在线）、
 * 切歌时 <audio> 主动 abort 媒体请求的 ERR_ABORTED。不计入致命错误，但逐条留档。 */
const EXPECTED_PROBE = /\/(widget\/api\/lrc\/load|widget\/api\/music\/ttml)(\?|$)/;

async function newPage() {
  const page = await browser.newPage();
  page.on('pageerror', (e) => report.runtimeErrors.push('pageerror: ' + String(e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const txt = m.text();
    /* 浏览器对 4xx 的固定播报不带 URL，改由 response 监听器带 URL 记录 */
    if (txt.indexOf('Failed to load resource') >= 0) return;
    report.runtimeErrors.push('console: ' + txt);
  });
  page.on('response', (r) => {
    if (r.status() < 400) return;
    const u = r.url();
    (EXPECTED_PROBE.test(u) ? report.expectedProbes : report.runtimeErrors).push(`http ${r.status()} ${u}`);
  });
  page.on('requestfailed', (r) => {
    const err = (r.failure() && r.failure().errorText) || '';
    const line = `reqfail: ${r.url()} ${err}`;
    /* 切歌时 <audio> 会主动 abort 上一个媒体请求，浏览器记 ERR_ABORTED —— 正常行为 */
    (err === 'net::ERR_ABORTED' ? report.expectedProbes : report.runtimeErrors).push(line);
  });
  await page.evaluateOnNewDocument(() => {
    window.__fixtureTheme = (mode) => {
      const light = { '--bg': '#F8F4ED', '--bg-card': '#FCFAF5', '--text': '#3B3D3F', '--text-muted': '#8E9196', '--text-light': '#6B6F73', '--accent': '#537D96', '--border': 'rgba(122,96,88,0.18)' };
      const dark = { '--bg': '#3B4A54', '--bg-card': '#445560', '--text': '#E1EAF0', '--text-muted': '#9FB1BC', '--text-light': '#9FB1BC', '--accent': '#C99AAF', '--border': 'rgba(170,121,141,0.16)' };
      const vars = mode === 'dark' ? dark : light;
      Object.entries(vars).forEach(([k, v]) => document.documentElement.style.setProperty(k, v));
      document.documentElement.setAttribute('data-theme', mode);
    };
  });
  return page;
}

/* ============ 1) 六尺寸 × 浅深：自检 + 截图 ============ */
const CASES = [
  ['card-465x930', 465, 930, 'index.html'],
  ['tall-585x1172', 585, 1172, 'index.html'],
  ['short-531x451', 531, 451, 'index.html'],
  ['card-560x616', 560, 616, 'index.html'],
  ['window-1040x740', 1040, 740, 'standalone.html'],
  ['window-1040x780', 1040, 780, 'standalone.html']
];
for (const [name, w, h, file] of CASES) {
  for (const theme of ['light', 'dark']) {
    const page = await newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.goto(`${BASE}/${file}?assert=1&shot=1&appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((t) => window.__fixtureTheme(t), theme);
    await new Promise((r) => setTimeout(r, 700));
    const result = await page.evaluate(() => window.__playerSelfCheck());
    report.selfCheck.push({ case: `${name}/${theme}`, passed: result.passed, failed: result.checks.filter((c) => !c.ok) });
    await page.screenshot({ path: path.join(outDir, `${name}-${theme}.png`) });
    await page.close();
  }
}

/* ============ 2) 接线冒烟 ============ */
{
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await new Promise((r) => setTimeout(r, 800));

  const w = {};
  w.queueRows = await page.$$eval('#queueList .q-row', (els) => els.length);
  w.firstTitle = await page.$eval('#trackTitle', (e) => e.textContent);
  // 第一首有封面：先截一张「有封面」状态
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-hit').click());
  await new Promise((r) => setTimeout(r, 600));
  w.coverState = await page.evaluate(() => ({
    nocover: document.getElementById('player').classList.contains('nocover'),
    titleColor: getComputedStyle(document.getElementById('trackTitle')).color
  }));
  await page.screenshot({ path: path.join(outDir, 'cover-465x930-light.png') });
  // 宽窗 + 封面（设计稿主展示态）
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await new Promise((r) => setTimeout(r, 500));
  await page.screenshot({ path: path.join(outDir, 'cover-1040x780-light.png') });
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await new Promise((r) => setTimeout(r, 400));

  // 播放第 3 首（本地）
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[2].querySelector('.q-hit').click());
  await new Promise((r) => setTimeout(r, 700));
  w.afterPlayLocal = await page.evaluate(() => ({
    playing: document.getElementById('player').getAttribute('data-playing'),
    title: document.getElementById('trackTitle').textContent,
    audioPaused: document.getElementById('audio').paused,
    audioSrc: (document.getElementById('audio').getAttribute('src') || '').slice(0, 40)
  }));

  // 播放第 4 首（在线）—— 验歌词降级链
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[3].querySelector('.q-hit').click());
  await new Promise((r) => setTimeout(r, 700));
  w.afterPlayOnline = await page.evaluate(() => ({
    title: document.getElementById('trackTitle').textContent,
    lyricLines: document.querySelectorAll('#lyrics .lyric-line').length,
    hasEmpty: !!document.querySelector('#lyrics .lyric-empty'),
    audioPaused: document.getElementById('audio').paused,
    // 歌词滚动条：平时 scrollbar-width 应为 none（藏起来），靠 :hover 才现身
    lyricScrollbarWidth: getComputedStyle(document.getElementById('lyrics')).scrollbarWidth,
    lyricScrolling: document.getElementById('lyrics').scrollHeight > document.getElementById('lyrics').clientHeight
  }));
  await page.screenshot({ path: path.join(outDir, 'lyrics-465x930-light.png') });
  // 悬停：滚动条应现形，但**歌词宽度不能变**（不抽动）
  w.lyricBeforeHover = await page.evaluate(() => {
    const el = document.getElementById('lyrics');
    return { clientWidth: el.clientWidth, offsetWidth: el.offsetWidth, sb: getComputedStyle(el).scrollbarColor };
  });
  await page.hover('#lyrics');
  await new Promise((r) => setTimeout(r, 350));
  w.lyricAfterHover = await page.evaluate(() => {
    const el = document.getElementById('lyrics');
    return { clientWidth: el.clientWidth, offsetWidth: el.offsetWidth, sb: getComputedStyle(el).scrollbarColor };
  });
  /* 滚动条断言（R1）：悬停前后歌词宽度必须相等 —— 滑块淡入不许挾压歌词 */
  assert('lyric-scrollbar-no-shift',
    w.lyricBeforeHover.clientWidth === w.lyricAfterHover.clientWidth &&
    w.lyricBeforeHover.offsetWidth === w.lyricAfterHover.offsetWidth &&
    w.lyricBeforeHover.sb !== w.lyricAfterHover.sb,
    JSON.stringify({ before: w.lyricBeforeHover, after: w.lyricAfterHover }));
  await page.mouse.move(2, 2);
  await new Promise((r) => setTimeout(r, 250));
  // 同一帧紧接关掉歌词：右侧换频谱，蒙层/渐变必须保持在线（R4）
  await page.evaluate(() => document.getElementById('lyricToggle').click());
  await new Promise((r) => setTimeout(r, 250));
  w.lyricsoffState = await page.evaluate(() => {
    const cs = (id) => getComputedStyle(document.getElementById(id)).display;
    return { wrap: cs('lyricWrap'), scrim: cs('lyricScrim'), spec: cs('spectrum') };
  });
  assert('spectrum-swap-scrim-stays',
    w.lyricsoffState.wrap === 'none' && w.lyricsoffState.scrim !== 'none' && w.lyricsoffState.spec !== 'none',
    JSON.stringify(w.lyricsoffState));
  await page.screenshot({ path: path.join(outDir, 'lyricsoff-465x930-light.png') });
  await page.evaluate(() => document.getElementById('lyricToggle').click());
  await new Promise((r) => setTimeout(r, 250));
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await new Promise((r) => setTimeout(r, 400));
  await page.screenshot({ path: path.join(outDir, 'lyrics-1040x780-light.png') });
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await new Promise((r) => setTimeout(r, 400));

  // 下一首
  await page.evaluate(() => document.getElementById('nextBtn').click());
  await new Promise((r) => setTimeout(r, 400));
  w.afterNext = await page.evaluate(() => ({ title: document.getElementById('trackTitle').textContent, idx: [...document.querySelectorAll('#queueList .q-row')].findIndex((r) => r.classList.contains('is-current')) }));

  // 旧版 searchKey 曲目：无 url → 搜索后播放
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#queueList .q-row')];
    const target = rows.find((r) => r.querySelector('.q-title').textContent.startsWith('搜索曲目'));
    target.querySelector('.q-hit').click();
  });
  await new Promise((r) => setTimeout(r, 900));
  w.searchKeyResolve = await page.evaluate(() => ({
    title: document.getElementById('trackTitle').textContent,
    audioPaused: document.getElementById('audio').paused,
    hasSrc: !!(document.getElementById('audio').getAttribute('src')),
    lyricLines: document.querySelectorAll('#lyrics .lyric-line').length
  }));

  // 播放模式循环
  await page.evaluate(() => { for (let i = 0; i < 3; i++) document.getElementById('modeBtn').click(); });
  w.modeTitle = await page.$eval('#modeBtn', (e) => e.title);

  // 歌词开关
  await page.evaluate(() => document.getElementById('lyricToggle').click());
  w.lyricsOff = await page.$eval('#player', (e) => e.getAttribute('data-lyrics'));
  await page.evaluate(() => document.getElementById('lyricToggle').click());
  w.lyricsOn = await page.$eval('#player', (e) => e.getAttribute('data-lyrics'));

  // 导入在线链接
  const before = await page.$$eval('#queueList .q-row', (els) => els.length);
  await page.evaluate(() => {
    document.getElementById('importBtn').click();
    const inp = document.getElementById('linkInput');
    inp.value = 'https://music.163.com/#/song?id=1234567';
    document.getElementById('linkAddBtn').click();
  });
  await new Promise((r) => setTimeout(r, 500));
  w.importAdded = (await page.$$eval('#queueList .q-row', (els) => els.length)) - before;
  w.importTitle = await page.$eval('#queueList .q-row:last-child .q-title', (e) => e.textContent);

  // 删除最后一首
  const n0 = await page.$$eval('#queueList .q-row', (els) => els.length);
  await page.evaluate(() => {
    const rows = document.querySelectorAll('#queueList .q-row');
    rows[rows.length - 1].querySelector('.q-more').click();
    document.getElementById('removeBtn').click();
  });
  await new Promise((r) => setTimeout(r, 400));
  w.removed = n0 - (await page.$$eval('#queueList .q-row', (els) => els.length));

  // 宽窗：抽屉
  await page.setViewport({ width: 1040, height: 740, deviceScaleFactor: 1 });
  await new Promise((r) => setTimeout(r, 400));
  await page.evaluate(() => document.getElementById('queueBtn').click());
  w.wideDrawer = await page.$eval('#player', (e) => e.getAttribute('data-drawer'));

  report.wiring = w;
  await page.close();
}

/* ============ 3) 精修矩阵：312 / 465 / 1040 × 浅深 × 歌词开/关 ============ */
const REFINE_CASES = [
  ['312x494', 312, 494, 'index.html'],
  ['465x930', 465, 930, 'index.html'],
  ['1040x780', 1040, 780, 'standalone.html']
];
report.refine = [];
report.narrowSelfCheck = [];
const accentByTheme = {};
for (const [name, w, h, file] of REFINE_CASES) {
  for (const theme of ['light', 'dark']) {
    for (const lyricsOn of [true, false]) {
      const page = await newPage();
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
      await page.goto(`${BASE}/${file}?assert=1&shot=1&appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
      await page.evaluate((t) => window.__fixtureTheme(t), theme);
      // 选中有封面 + 有歌词的在线曲目（紧凑布局下队列隐藏，程序化点击仍生效）
      await page.evaluate(() => {
        const rows = [...document.querySelectorAll('#queueList .q-row')];
        const target = rows.find((r) => r.querySelector('.q-title').textContent.startsWith('在线曲目')) || rows[0];
        target.querySelector('.q-hit').click();
      });
      await new Promise((r) => setTimeout(r, 900));
      if (!lyricsOn) {
        await page.evaluate(() => document.getElementById('lyricToggle').click());
        await new Promise((r) => setTimeout(r, 250));
      }
      const shotName = `refine-${name}-${theme}-lyrics-${lyricsOn ? 'on' : 'off'}.png`;
      await page.screenshot({ path: path.join(outDir, shotName) });
      report.refine.push(shotName);

      // R4：歌词 ⇄ 频谱互换，蒙层/渐变保持在线
      const swap = await page.evaluate(() => {
        const cs = (id) => getComputedStyle(document.getElementById(id)).display;
        return { wrap: cs('lyricWrap'), scrim: cs('lyricScrim'), spec: cs('spectrum') };
      });
      const swapOk = lyricsOn
        ? (swap.wrap !== 'none' && swap.scrim !== 'none' && swap.spec === 'none')
        : (swap.wrap === 'none' && swap.scrim !== 'none' && swap.spec !== 'none');
      assert(`lyrics-spectrum-swap:${shotName}`, swapOk, JSON.stringify(swap));

      // R5：高亮/激活态必须吃主题强调色
      accentByTheme[theme] = await page.evaluate(() => getComputedStyle(document.getElementById('playBtn')).backgroundColor);

      if (w === 312) {
        const res = await page.evaluate(() => window.__playerSelfCheck());
        report.narrowSelfCheck.push({
          case: `${name}/${theme}/lyrics-${lyricsOn ? 'on' : 'off'}`,
          passed: res.passed,
          failed: res.checks.filter((c) => !c.ok)
        });
      }
      await page.close();
    }
  }
}
assert('theme-accent-on-highlight',
  accentByTheme.light === 'rgb(83, 125, 150)' && accentByTheme.dark === 'rgb(201, 154, 175)',
  JSON.stringify(accentByTheme));

/* ============ 4) 主题双保险（R5 + macOS 夜间模式） ============
   优先级断言：宿主显式注入 > @media prefers-color-scheme 兑底 > 写死默认 */
report.theme = {};
{
  // (a) hana-css 初始注入：SDK 初始不拉样式表，App 自己补拉
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  const cssUrl = '/api/apps/theme.css?theme=hostfix';
  await page.goto(`${BASE}/index.html?appSurfaceSession=fake-ticket&shot=1&hana-theme=hostfix&hana-css=${encodeURIComponent(cssUrl)}`, { waitUntil: 'domcontentloaded' });
  await new Promise((r) => setTimeout(r, 500));
  const vals = await page.evaluate(() => ({
    accent: getComputedStyle(document.getElementById('playBtn')).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor
  }));
  report.theme.hanaCssInject = vals;
  assert('theme-hana-css-inject', vals.accent === 'rgb(34, 170, 136)' && vals.body === 'rgb(17, 34, 51)', JSON.stringify(vals));
  await page.screenshot({ path: path.join(outDir, 'theme-hostfix-inject.png') });
  await page.close();
}
{
  // (b) palette 对：宿主给深浅两套主题时，跟随 macOS 深浅自动切换
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  const q = new URLSearchParams({
    appSurfaceSession: 'fake-ticket',
    shot: '1',
    'hana-theme': 'palette-fix',
    'hana-palette-light-css': '/api/apps/theme.css?theme=palette-light-fix',
    'hana-palette-dark-css': '/api/apps/theme.css?theme=palette-dark-fix'
  });
  await page.goto(`${BASE}/index.html?${q}`, { waitUntil: 'domcontentloaded' });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await new Promise((r) => setTimeout(r, 500));
  const lightVals = await page.evaluate(() => ({
    accent: getComputedStyle(document.getElementById('playBtn')).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor
  }));
  await page.screenshot({ path: path.join(outDir, 'theme-palette-macos-light.png') });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await new Promise((r) => setTimeout(r, 300));
  const darkVals = await page.evaluate(() => ({
    accent: getComputedStyle(document.getElementById('playBtn')).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor
  }));
  await page.screenshot({ path: path.join(outDir, 'theme-palette-macos-dark.png') });
  report.theme.palette = { light: lightVals, dark: darkVals };
  assert('theme-palette-follows-macos',
    lightVals.accent === 'rgb(83, 125, 150)' && lightVals.body === 'rgb(248, 244, 237)' &&
    darkVals.accent === 'rgb(201, 154, 175)' && darkVals.body === 'rgb(59, 74, 84)',
    JSON.stringify({ light: lightVals, dark: darkVals }));
  await page.close();
}
{
  // (c) 无宿主注入：@media prefers-color-scheme 兑底接管（深板岩 / 暖纸）
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/index.html?appSurfaceSession=fake-ticket&shot=1`, { waitUntil: 'domcontentloaded' });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await new Promise((r) => setTimeout(r, 500));
  const darkVals = await page.evaluate(() => ({
    accent: getComputedStyle(document.getElementById('playBtn')).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor
  }));
  await page.screenshot({ path: path.join(outDir, 'theme-fallback-dark.png') });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await new Promise((r) => setTimeout(r, 300));
  const lightVals = await page.evaluate(() => ({
    accent: getComputedStyle(document.getElementById('playBtn')).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor
  }));
  await page.screenshot({ path: path.join(outDir, 'theme-fallback-light.png') });
  report.theme.fallback = { dark: darkVals, light: lightVals };
  assert('fallback-dark-slate',
    darkVals.accent === 'rgb(201, 154, 175)' && darkVals.body === 'rgb(52, 66, 75)', JSON.stringify(darkVals));
  assert('fallback-light-paper',
    lightVals.accent === 'rgb(83, 125, 150)' && lightVals.body === 'rgb(248, 244, 237)', JSON.stringify(lightVals));
  await page.close();
}
{
  // (d) 优先级：宿主显式值 > prefers-color-scheme 兑底（系统深色也不能盖掉宿主主题）
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  const cssUrl = '/api/apps/theme.css?theme=hostfix';
  await page.goto(`${BASE}/index.html?appSurfaceSession=fake-ticket&shot=1&hana-theme=hostfix&hana-css=${encodeURIComponent(cssUrl)}`, { waitUntil: 'domcontentloaded' });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await new Promise((r) => setTimeout(r, 500));
  const vals = await page.evaluate(() => ({ body: getComputedStyle(document.body).backgroundColor }));
  await page.screenshot({ path: path.join(outDir, 'theme-host-wins-over-dark.png') });
  assert('host-theme-wins-over-prefers', vals.body === 'rgb(17, 34, 51)', JSON.stringify(vals));
  await page.close();
}

await browser.close();
server.closeAllConnections();
server.close();

const failed = report.selfCheck.filter((c) => !c.passed);
const narrowFailed = report.narrowSelfCheck.filter((c) => !c.passed);
const assertFailed = report.assertions.filter((a) => !a.ok);
const realErrors = [...new Set(report.runtimeErrors)];
fs.writeFileSync(path.join(outDir, 'verify.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  selfCheckPassed: report.selfCheck.length - failed.length,
  selfCheckTotal: report.selfCheck.length,
  failedCases: failed.map((f) => ({ case: f.case, failed: f.failed.map((x) => x.name + ' | ' + x.detail) })),
  narrowSelfCheck: `${report.narrowSelfCheck.length - narrowFailed.length}/${report.narrowSelfCheck.length}`,
  narrowFailed: narrowFailed.map((f) => ({ case: f.case, failed: f.failed.map((x) => x.name + ' | ' + x.detail) })),
  assertions: `${report.assertions.length - assertFailed.length}/${report.assertions.length}`,
  failedAssertions: assertFailed,
  theme: report.theme,
  wiring: report.wiring,
  expectedProbes: [...new Set(report.expectedProbes)],
  runtimeErrors: realErrors.slice(0, 20),
  outDir
}, null, 2));
process.exit(failed.length || narrowFailed.length || assertFailed.length || realErrors.length ? 1 : 0);
