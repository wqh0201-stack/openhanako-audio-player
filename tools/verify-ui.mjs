#!/usr/bin/env node
/* ============================================================
   tools/verify-ui.mjs — 生产 ui/ 的无头验收（开发用）
   零业务依赖：起本地 HTTP 服务（ui/ + 假后端），用 puppeteer-core 驱动系统 Chrome：
     · 六种尺寸 × 浅深主题：跑页面内自检（?assert=1）+ 出截图
     · 接线冒烟：多歌单切换 / 本地文件夹 / 导入 / 播放 / 歌词 / 删除 / 抽屉
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
fs.mkdirSync(outDir, { recursive: true });

/* ---------- 假音频：1 秒静音 WAV ---------- */
const pcm = Buffer.alloc(44100 * 2);
const wav = Buffer.alloc(44 + pcm.length);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(44100 * 2, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40);
pcm.copy(wav, 44);
const WAV_URL = 'data:audio/wav;base64,' + wav.toString('base64');
const COVER = `${API}/_fixture/cover.png`;
const goUrl = (id) => `${API}/widget/api/music/go/${id}?server=netease`;

/* ---------- 假播放列表（多歌单：本地为空 + 两个导入歌单） ----------
 *  · local   ：0 首（验证「没设文件夹 → 引导」）
 *  · imp:1   ：20 首在线
 *  · imp:2   ：3 首与 imp:1 同 id（跨列表重复，去重键必须含 list 才不会被并掉）
 *             + 3 首旧版 searchKey 曲目（无 url，测现搜现播）
 */
function makeTracks() {
  const out = [];
  for (let i = 0; i < 20; i++) {
    out.push({
      id: `netease:${900000 + i}`, name: `歌单一曲目 ${i + 1}`, url: goUrl(900000 + i),
      mode: '在线', dur: 0, group: '在线音乐', list: 'imp:1',
      pic: i % 5 === 0 ? COVER : ''
    });
  }
  for (let i = 0; i < 3; i++) {
    out.push({
      id: `netease:${900000 + i}`, name: `歌单一曲目 ${i + 1}`, url: goUrl(900000 + i),
      mode: '在线', dur: 0, group: '鸣潮', list: 'imp:2'
    });
  }
  for (let k = 0; k < 3; k++) {
    out.push({
      name: `搜索曲目 ${k + 1}`, url: '', mode: '在线', dur: 0, group: '鸣潮',
      list: 'imp:2', searchKey: `关键词 ${k + 1}`, searchServer: 'netease'
    });
  }
  return out;
}
const TRACKS = makeTracks();

/* ---------- 旧数据夹具（无 list 字段，用于测迁移） ----------
 * 复刻罐头真实的 playlist.json 形状：只有 name/url/mode/dur/group。
 *  · mode 本地 → local；在线按 group 各自成一个导入列表；group 缺失 → 未分类
 */
const OLD_TRACKS = [];
for (let i = 0; i < 3; i++) OLD_TRACKS.push({ name: `旧本地 ${i + 1}`, url: WAV_URL, mode: '本地', dur: 0, group: '本地音乐' });
for (let i = 0; i < 4; i++) OLD_TRACKS.push({ name: `鸣潮曲 ${i + 1}`, url: '', mode: '在线', dur: 0, group: '鸣潮', searchKey: `鸣潮 ${i + 1}`, searchServer: 'netease' });
for (let i = 0; i < 3; i++) OLD_TRACKS.push({ name: `在线曲 ${i + 1}`, url: '', mode: '在线', dur: 0, group: '在线音乐', searchKey: `在线 ${i + 1}`, searchServer: 'netease' });
for (let i = 0; i < 2; i++) OLD_TRACKS.push({ name: `未分类曲 ${i + 1}`, url: '', mode: '在线', dur: 0, group: '', searchKey: `未分类 ${i + 1}`, searchServer: 'netease' });

/* 假后端状态：POST /playlist 会落盘，GET 优先返回落盘值（测迁移幂等） */
let fixtureMode = 'main';
let persistedPlaylist = null;

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
      req.on('end', () => {
        try { const j = JSON.parse(body); persistedPlaylist = Array.isArray(j.tracks) ? j.tracks : null; } catch { persistedPlaylist = null; }
        json(res, 200, { ok: true, count: persistedPlaylist ? persistedPlaylist.length : 0 });
      });
      return;
    }
    const tracks = persistedPlaylist || (fixtureMode === 'migrate' ? OLD_TRACKS : TRACKS);
    return json(res, 200, { ok: true, tracks, count: tracks.length });
  }
  if (p === API + '/__fixture/reset') {
    fixtureMode = u.searchParams.get('mode') || 'main';
    persistedPlaylist = null;
    return json(res, 200, { ok: true, mode: fixtureMode });
  }
  if (p === API + '/api/track' && req.method === 'DELETE') {
    // 带上 list 时只删该列表里的那一份
    return json(res, 200, { ok: true, removed: 1, count: TRACKS.length - 1, list: u.searchParams.get('list') });
  }
  if (p === API + '/widget/api/lrc/load') return json(res, 404, { ok: false, error: 'not found' });
  if (p === API + '/widget/api/lrc/save') return json(res, 200, { ok: true, filename: 'x.lrc' });
  if (p === API + '/widget/api/music/lrc') return text(res, 200, lrcFor('fixture'), 'text/plain; charset=utf-8');
  if (p === API + '/widget/api/music/lrc-proxy') return text(res, 200, lrcFor('proxy'), 'text/plain; charset=utf-8');
  if (p === API + '/widget/api/music/ttml') return text(res, 404, 'not in amll-db');
  if (p === API + '/widget/api/music/song') {
    const id = u.searchParams.get('id') || '0';
    return json(res, 200, { ok: true, track: { id: `netease:${id}`, title: `在线单曲 ${id}`, author: '测试歌手', url: goUrl(id), pic: '', lrc: '' }, host: 'mock' });
  }
  if (p === API + '/_fixture/cover.png') {
    res.setHeader('content-type', 'image/png');
    return fs.createReadStream(COVER_FILE).pipe(res);
  }
  if (p === API + '/widget/api/music/search') {
    const kw = u.searchParams.get('keyword') || '';
    return json(res, 200, { ok: true, results: [{ id: `netease:${770000 + kw.length}`, title: `命中 ${kw}`, author: '搜索歌手', url: goUrl(770000 + kw.length), pic: '', lrc: 'http://mock/lrc/' + encodeURIComponent(kw) }], host: 'mock', total: 1 });
  }
  if (p === API + '/widget/api/music/playlist') {
    const id = u.searchParams.get('id') || '0';
    const tracks = Array.from({ length: 5 }, (_, i) => ({ id: `netease:${id}${i}`, title: `歌单曲目 ${i + 1}`, author: '测试', url: goUrl(`${id}${i}`), pic: '', lrc: '' }));
    return json(res, 200, { ok: true, tracks, host: 'mock' });
  }
  if (p === API + '/widget/api/import-file') {
    const src = u.searchParams.get('path') || '';
    const base = path.basename(src);
    return json(res, 200, { ok: true, id: base, name: base.replace(/\.\w+$/, ''), url: WAV_URL, mode: '本地' });
  }
  if (p === API + '/widget/api/scan-folder') {
    // 固定文件夹扫描：返回 3 个本地文件
    const files = Array.from({ length: 3 }, (_, i) => ({ id: `scan-${i + 1}.mp3`, name: `扫描曲目 ${i + 1}`, url: WAV_URL, mode: '本地' }));
    return json(res, 200, { ok: true, files, count: files.length });
  }
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

const browser = await puppeteer.launch({
  executablePath: CHROME, headless: 'new',
  args: ['--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--autoplay-policy=no-user-gesture-required', '--force-device-scale-factor=1']
});

const report = { selfCheck: [], wiring: {}, darkFallback: {}, runtimeErrors: [] };

async function newPage() {
  const page = await browser.newPage();
  page.on('pageerror', (e) => report.runtimeErrors.push('pageerror: ' + String(e)));
  page.on('console', (m) => {
    if (m.type() !== 'error') return;
    const t = m.text();
    // 预期噪声：离线歌词库 404 → 前端走在线歌词（假后端刻意返回 404）
    if (/Failed to load resource.*404/.test(t)) return;
    report.runtimeErrors.push('console: ' + t);
  });
  page.on('requestfailed', (r) => report.runtimeErrors.push('reqfail: ' + r.url() + ' ' + (r.failure() && r.failure().errorText)));
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const tabLabels = (page) => page.$$eval('#listTabs .list-tab', (els) => els.map((e) => e.textContent.trim()));
const rowCount = (page) => page.$$eval('#queueList .q-row', (els) => els.length);
const activeTab = (page) => page.$eval('#listTabs .list-tab.is-active', (e) => e.getAttribute('data-list'));
const rowTitles = (page) => page.$$eval('#queueList .q-row .q-title', (els) => els.map((e) => e.textContent));
const dupUids = (page) => page.evaluate(() => {
  const seen = {}, dup = [];
  document.querySelectorAll('#queueList .q-row').forEach((r) => {
    const u = r.getAttribute('data-uid');
    if (seen[u]) dup.push(u); else seen[u] = 1;
  });
  return dup;
});
const clickTab = (page, id) => page.evaluate((listId) => {
  const b = document.querySelector('#listTabs .list-tab[data-list="' + listId + '"]');
  if (b) b.click();
}, id);
const geom = (page) => page.evaluate(() => {
  const r = (id) => { const e = document.getElementById(id); const b = e.getBoundingClientRect(); return [Math.round(b.left), Math.round(b.top), Math.round(b.width), Math.round(b.height)]; };
  return { sceneTop: r('sceneTop'), controls: r('controls'), tabs: r('listTabs'), listTop: Math.round(document.getElementById('queueList').getBoundingClientRect().top) };
});

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
    await sleep(700);
    const result = await page.evaluate(() => window.__playerSelfCheck());
    report.selfCheck.push({ case: `${name}/${theme}`, passed: result.passed, failed: result.checks.filter((c) => !c.ok) });
    await page.screenshot({ path: path.join(outDir, `${name}-${theme}.png`) });
    await page.close();
  }
}

/* ============ 2) 接线冒烟：多歌单切换 ============ */
{
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await sleep(800);

  const w = {};
  w.tabs = await tabLabels(page);
  w.activeList = await activeTab(page);
  // 本地页：没设文件夹 → 引导（不是空白）
  w.localGuide = await page.evaluate(() => ({
    rows: document.querySelectorAll('#queueList .q-row').length,
    hasPickBtn: !!document.getElementById('localPickBtn'),
    text: (document.querySelector('#queueList .q-guide-text') || {}).textContent || ''
  }));
  await page.screenshot({ path: path.join(outDir, 'list-local-empty-465x930-light.png') });

  const geoBefore = await geom(page);

  // 切到导入歌单 1：只换内容，顶栏/控制条不动
  await clickTab(page, 'imp:1');
  await sleep(350);
  w.imp1 = { rows: await rowCount(page), first: (await rowTitles(page))[0], dup: await dupUids(page) };
  w.geoStableOnSwitch = JSON.stringify(await geom(page)) === JSON.stringify(geoBefore);
  await page.screenshot({ path: path.join(outDir, 'list-imp1-465x930-light.png') });

  // 切到导入歌单 2：含跨列表重复 id + searchKey 曲目
  await clickTab(page, 'imp:2');
  await sleep(350);
  w.imp2 = { rows: await rowCount(page), dup: await dupUids(page), titles: await rowTitles(page) };
  await page.screenshot({ path: path.join(outDir, 'list-imp2-465x930-light.png') });

  // 跨列表重复：imp:1 与 imp:2 各有 3 首同 id，两边都必须各自保留（列表内无重复、跨列表不并）
  w.crossList = {
    imp1Rows: w.imp1.rows,
    imp2Rows: w.imp2.rows,
    imp2HasSearch: w.imp2.titles.some((t) => t.startsWith('搜索曲目'))
  };

  // 回到本地页，选文件夹（stub 宿主 pick）
  await clickTab(page, 'local');
  await sleep(250);
  await page.evaluate(() => {
    if (window.hana && window.hana.resources) {
      window.hana.resources.pick = () => Promise.resolve({ resources: [{ path: '/Users/fake/Music' }] });
    }
  });
  await page.evaluate(() => document.getElementById('localPickBtn').click());
  await sleep(700);
  w.localAfterPick = { rows: await rowCount(page), dup: await dupUids(page), first: (await rowTitles(page))[0] };
  await page.screenshot({ path: path.join(outDir, 'list-local-465x930-light.png') });

  // 播放本地曲目
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-hit').click());
  await sleep(700);
  w.afterPlayLocal = await page.evaluate(() => ({
    playing: document.getElementById('player').getAttribute('data-playing'),
    title: document.getElementById('trackTitle').textContent,
    audioPaused: document.getElementById('audio').paused
  }));

  // 切到歌单 1，播放带封面的在线曲目（歌词降级链）
  await clickTab(page, 'imp:1');
  await sleep(300);
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-hit').click());
  await sleep(700);
  w.afterPlayOnline = await page.evaluate(() => ({
    title: document.getElementById('trackTitle').textContent,
    lyricLines: document.querySelectorAll('#lyrics .lyric-line').length,
    hasEmpty: !!document.querySelector('#lyrics .lyric-empty'),
    audioPaused: document.getElementById('audio').paused,
    lyricScrolling: document.getElementById('lyrics').scrollHeight > document.getElementById('lyrics').clientHeight,
    nocover: document.getElementById('player').classList.contains('nocover')
  }));
  await page.screenshot({ path: path.join(outDir, 'cover-465x930-light.png') });

  // 悬停歌词：滚动条现形但歌词宽度不变（不抽动）
  w.lyricBeforeHover = await page.evaluate(() => { const el = document.getElementById('lyrics'); return { clientWidth: el.clientWidth, offsetWidth: el.offsetWidth }; });
  await page.hover('#lyrics');
  await sleep(350);
  w.lyricAfterHover = await page.evaluate(() => { const el = document.getElementById('lyrics'); return { clientWidth: el.clientWidth, offsetWidth: el.offsetWidth }; });
  await page.mouse.move(2, 2);
  await sleep(200);

  // 歌词开关
  await page.evaluate(() => document.getElementById('lyricToggle').click());
  w.lyricsOff = await page.$eval('#player', (e) => e.getAttribute('data-lyrics'));
  await page.evaluate(() => document.getElementById('lyricToggle').click());
  w.lyricsOn = await page.$eval('#player', (e) => e.getAttribute('data-lyrics'));

  // 下一首（在歌单内）
  await page.evaluate(() => document.getElementById('nextBtn').click());
  await sleep(400);
  w.afterNext = await page.evaluate(() => ({
    title: document.getElementById('trackTitle').textContent,
    activeList: document.querySelector('#listTabs .list-tab.is-active').getAttribute('data-list')
  }));

  // 旧版 searchKey 曲目：切到歌单 2，点「搜索曲目」→ 现搜现播
  await clickTab(page, 'imp:2');
  await sleep(250);
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#queueList .q-row')];
    const target = rows.find((r) => r.querySelector('.q-title').textContent.startsWith('搜索曲目'));
    target.querySelector('.q-hit').click();
  });
  await sleep(900);
  w.searchKeyResolve = await page.evaluate(() => ({
    title: document.getElementById('trackTitle').textContent,
    audioPaused: document.getElementById('audio').paused,
    hasSrc: !!(document.getElementById('audio').getAttribute('src'))
  }));

  // 播放模式循环
  await page.evaluate(() => { for (let i = 0; i < 3; i++) document.getElementById('modeBtn').click(); });
  w.modeTitle = await page.$eval('#modeBtn', (e) => e.title);

  // 导入在线歌单 → 新列表出现并激活
  const tabsBefore = (await tabLabels(page)).length;
  await page.evaluate(() => {
    document.getElementById('importBtn').click();
    document.getElementById('linkInput').value = 'https://music.163.com/#/playlist?id=888';
    document.getElementById('linkAddBtn').click();
  });
  await sleep(600);
  w.importPlaylist = {
    tabsBefore,
    tabsAfter: (await tabLabels(page)).length,
    active: await activeTab(page),
    rows: await rowCount(page)
  };
  await page.screenshot({ path: path.join(outDir, 'list-imported-465x930-light.png') });

  // 导入在线单曲 → 归入当前导入列表
  const beforeSingle = await rowCount(page);
  await page.evaluate(() => {
    document.getElementById('importBtn').click();
    document.getElementById('linkInput').value = 'https://music.163.com/#/song?id=1234567';
    document.getElementById('linkAddBtn').click();
  });
  await sleep(600);
  w.importSingle = { before: beforeSingle, after: await rowCount(page), active: await activeTab(page) };

  // 删除最后一首
  const n0 = await rowCount(page);
  await page.evaluate(() => {
    const rows = document.querySelectorAll('#queueList .q-row');
    rows[rows.length - 1].querySelector('.q-more').click();
    document.getElementById('removeBtn').click();
  });
  await sleep(400);
  w.removed = n0 - (await rowCount(page));

  // 宽窗：抽屉 + 列表页截图（浅 / 深）
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await sleep(400);
  await page.evaluate(() => document.getElementById('queueBtn').click());
  w.wideDrawer = await page.$eval('#player', (e) => e.getAttribute('data-drawer'));
  await page.screenshot({ path: path.join(outDir, 'list-1040x780-light.png') });
  await page.evaluate((t) => window.__fixtureTheme(t), 'dark');
  await sleep(300);
  await page.screenshot({ path: path.join(outDir, 'list-1040x780-dark.png') });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await sleep(200);
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await sleep(300);
  await page.evaluate((t) => window.__fixtureTheme(t), 'dark');
  await sleep(250);
  await page.screenshot({ path: path.join(outDir, 'list-imported-465x930-dark.png') });

  report.wiring = w;
  await page.close();
}

/* ============ 3) 夜间兜底：宿主没注入主题时跟随 prefers-color-scheme ============ */
{
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  // 不调 __fixtureTheme —— 模拟宿主完全没注入主题变量的情况
  await page.goto(`${BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await sleep(600);
  const dark = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return { hkBg: cs.getPropertyValue('--hk-bg').trim(), hkText: cs.getPropertyValue('--hk-text').trim() };
  });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await sleep(150);
  const light = await page.evaluate(() => {
    const cs = getComputedStyle(document.documentElement);
    return { hkBg: cs.getPropertyValue('--hk-bg').trim(), hkText: cs.getPropertyValue('--hk-text').trim() };
  });
  await page.screenshot({ path: path.join(outDir, 'darkfallback-465x930.png') });
  report.darkFallback = { dark, light, changed: dark.hkBg !== light.hkBg };
  await page.close();
}

/* ============ 4) 旧数据迁移：无 list 字段 → 本地 + 按 group 分导入列表（幂等） ============ */
let migration = {};
{
  await fetch(`${BASE}${API}/__fixture/reset?mode=migrate&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await sleep(800);

  const tabInfo = () => page.$$eval('#listTabs .list-tab', (els) => els.map((e) => ({ list: e.getAttribute('data-list'), label: e.textContent.trim(), title: e.getAttribute('title') })));
  const countAll = async () => {
    const tabs = (await tabInfo()).map((t) => t.list);
    let total = 0;
    const per = {};
    for (const id of tabs) {
      await clickTab(page, id);
      await sleep(120);
      const n = await rowCount(page);
      per[id] = n;
      total += n;
    }
    return { total, per };
  };

  const first = await tabInfo();
  const firstCounts = await countAll();
  migration = {
    firstTabs: first,
    firstCounts,
    expectedTotal: OLD_TRACKS.length
  };
  await page.screenshot({ path: path.join(outDir, 'migrated-465x930-light.png') });

  // 重新加载：已带 list 字段，结构必须不变（幂等）
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await sleep(800);
  const secondTabs = (await tabInfo()).map((t) => t.list);
  const secondCounts = await countAll();
  migration.reloadTabs = secondTabs;
  migration.reloadTotal = secondCounts.total;
  migration.idempotent =
    secondTabs.length === first.length &&
    secondCounts.total === firstCounts.total &&
    firstCounts.total === OLD_TRACKS.length;

  report.migration = migration;
  await page.close();
}

await browser.close();
server.closeAllConnections();
server.close();

const failed = report.selfCheck.filter((c) => !c.passed);
const wiringOk =
  report.wiring.imp1 && report.wiring.imp1.rows === 20 &&
  report.wiring.imp1.dup.length === 0 &&
  report.wiring.imp2 && report.wiring.imp2.rows === 6 &&
  report.wiring.imp2.dup.length === 0 &&
  report.wiring.crossList && report.wiring.crossList.imp2HasSearch === true &&
  report.wiring.geoStableOnSwitch === true &&
  report.wiring.localAfterPick && report.wiring.localAfterPick.rows === 3 &&
  report.wiring.localAfterPick.dup.length === 0 &&
  report.wiring.importPlaylist && report.wiring.importPlaylist.tabsAfter === report.wiring.importPlaylist.tabsBefore + 1 &&
  report.wiring.importSingle && report.wiring.importSingle.after === report.wiring.importSingle.before + 1 &&
  report.wiring.removed === 1 &&
  report.darkFallback.changed === true;
const migrationOk = report.migration && report.migration.idempotent === true &&
  report.migration.firstTabs.map((t) => t.label).join(',') === '本地,1,2,3' &&
  report.migration.firstCounts.per['local'] === 3 &&
  report.migration.firstCounts.per['imp:1'] === 4 &&
  report.migration.firstCounts.per['imp:2'] === 3 &&
  report.migration.firstCounts.per['imp:3'] === 2;

fs.writeFileSync(path.join(outDir, 'verify.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  selfCheckPassed: report.selfCheck.length - failed.length,
  selfCheckTotal: report.selfCheck.length,
  failedCases: failed.map((f) => ({ case: f.case, failed: f.failed.map((x) => x.name + ' | ' + x.detail) })),
  wiringOk,
  migrationOk,
  migration: report.migration,
  wiring: report.wiring,
  darkFallback: report.darkFallback,
  runtimeErrors: [...new Set(report.runtimeErrors)].slice(0, 20),
  outDir
}, null, 2));
process.exit(failed.length || !wiringOk || !migrationOk || report.runtimeErrors.length ? 1 : 0);
