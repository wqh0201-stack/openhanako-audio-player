#!/usr/bin/env node
/* ============================================================
   tools/verify-ui.mjs — 生产 ui/ 的无头验收（开发用）
   零业务依赖：起本地 HTTP 服务（ui/ + 假后端），用 puppeteer-core 驱动系统 Chrome：
     · 六种尺寸 × 浅深主题：跑页面内自检（?assert=1）+ 出截图（12 组布局自检）
     · 接线冒烟：多歌单切换 / 本地文件夹 / 重命名 / 导入 / 播放 / 歌词 / 删除 / 抽屉
     · 精修矩阵：312/465/1040 × 浅深 × 歌词开/关 + 312 档自检
     · 主题双保险：hana-css 注入 / palette 跟随系统深浅 / 无宿主兜底 / 宿主优先
     · 夜间兜底：宿主没注入主题时跟随 prefers-color-scheme
     · 旧数据迁移：无 list 字段 → 按 group 分导入列表（幂等）
     · 拖拽生命周期：pagehide 落盘 → reload 恢复 + 续播
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
/* 深色封面夹具：右缘确实深，用来验证「深底 → 浅字」那条分支。
 * 由 tools/make-fixture-covers.mjs 生成（纯 Node 手写 PNG，可复现）。 */
const COVER_DARK_FILE = path.join(repo, 'docs/player-ui/assets/demo-cover-dark.png');
const COVER_LIGHT_FILE = path.join(repo, 'docs/player-ui/assets/demo-cover-light.png');
fs.mkdirSync(outDir, { recursive: true });

/* ---------- 假音频：30 秒静音 WAV（走 URL，不走 data URL） ----------
 * 30 秒是为了让接线冒烟不跟 1 秒音频的 ended 连锁自动切歌撞车（点完到断言
 * 有 0.7~0.9s 窗口，ended 恰好落在里面就会张冠李戴）；走 URL 同时让 <audio>
 * 真实经过 withSession 贴票路径，也避免 savePlaylist 把巨型 data URL 回写。
 * 带 Range 支持（真实后端 /widget/media 也是 Range；无 Range 会不可 seek，
 * 续播断言会假红）。 */
const WAV_SECONDS = 30;
const pcm = Buffer.alloc(44100 * 2 * WAV_SECONDS);
const wav = Buffer.alloc(44 + pcm.length);
wav.write('RIFF', 0); wav.writeUInt32LE(36 + pcm.length, 4); wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(44100, 24); wav.writeUInt32LE(44100 * 2, 28); wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(pcm.length, 40);
pcm.copy(wav, 44);
const WAV_URL = `${API}/_fixture/audio.wav`;
const COVER = `${API}/_fixture/cover.png`;
const COVER_SQUARE = `${API}/_fixture/cover-square.png`;
const COVER_DARK = `${API}/_fixture/cover-dark.png`;
const COVER_LIGHT = `${API}/_fixture/cover-light.png`;
const goUrl = (id) => `${API}/widget/api/music/go/${id}?server=netease`;

/* ---------- 假播放列表（多歌单：本地为空 + 两个导入歌单） ----------
 *  · local   ：0 首（验证「没设文件夹 → 引导」）
 *  · imp:1   ：20 首在线（前两首带封面，一方一横幅，验封面两种画幅）
 *  · imp:2   ：3 首与 imp:1 同 id（跨列表重复，去重键必须含 list 才不会被并掉）
 *             + 3 首旧版 searchKey 曲目（无 url，测现搜现播）
 */
function makeTracks() {
  const out = [];
  for (let i = 0; i < 20; i++) {
    out.push({
      id: `netease:${900000 + i}`, name: `在线曲目 ${i + 1}`, url: goUrl(900000 + i),
      mode: '在线', dur: 0, group: '在线音乐', list: 'imp:1',
      pic: i % 5 === 0 ? COVER : ''
    });
  }
  out[0].pic = COVER_SQUARE;   // 方形封面（右缘上浅下深）
  out[1].pic = COVER;          // 横幅封面
  out[2].pic = COVER_DARK;     // 深色封面（右缘极深，走「深纱+纸字」）
  out[4].pic = COVER_LIGHT;    // 真·浅底封面（整张浅，走「浅纱+墨字」）
  out[5] = { id: 'netease:900099', name: '无词纯音乐', url: goUrl(900099), mode: '在线', dur: 0, group: '在线音乐', list: 'imp:1', pic: COVER_DARK };  // 无歌词曲目（假后端对其返回空 LRC）；配深色封面，供「无词 + 深底」验证
  out[6] = { id: 'netease:900098', name: '占位词纯音乐', url: goUrl(900098), mode: '在线', dur: 0, group: '在线音乐', list: 'imp:1', pic: COVER_LIGHT };  // 歌词源回「这似乎是一首纯音乐」占位句，应被当无词
  for (let i = 0; i < 3; i++) {
    out.push({
      id: `netease:${900000 + i}`, name: `在线曲目 ${i + 1}`, url: goUrl(900000 + i),
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
/* 播放状态（跨文档）：POST 落盘，GET 取回 */
let playbackState = null;
/* 搜索请求计数（测歌手补齐的次数 / 幂等） */
let searchHits = 0;
/* 歌单真名夹具：导入歌单时假后端附带 meta.name（模拟后端问网易云官方接口） */
const PLAYLIST_META = { name: 'Can_0201喜欢的音乐', creator: 'Can_0201', cover: '', trackCount: 905 };

/* ---------- 主题夹具 ---------- */
const THEME_VARS = {
  light: { '--bg': '#F8F4ED', '--bg-card': '#FCFAF5', '--text': '#3B3D3F', '--text-muted': '#8E9196', '--text-light': '#6B6F73', '--accent': '#537D96', '--border': 'rgba(122,96,88,0.18)' },
  dark: { '--bg': '#3B4A54', '--bg-card': '#445560', '--text': '#E1EAF0', '--text-muted': '#9FB1BC', '--text-light': '#9FB1BC', '--accent': '#C99AAF', '--border': 'rgba(170,121,141,0.16)' }
};

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
/* 假音频流：带 Range 支持（真实后端 /widget/media 也是 Range；无 Range 会不可 seek） */
function serveAudio(req, res) {
  const total = wav.length;
  res.setHeader('content-type', 'audio/wav');
  res.setHeader('accept-ranges', 'bytes');
  const range = req.headers.range;
  if (range) {
    const m = /^bytes=(\d+)-(\d*)$/.exec(range);
    if (m) {
      const start = parseInt(m[1], 10);
      const end = m[2] ? parseInt(m[2], 10) : total - 1;
      res.statusCode = 206;
      res.setHeader('content-range', `bytes ${start}-${end}/${total}`);
      res.setHeader('content-length', String(end - start + 1));
      return res.end(wav.subarray(start, end + 1));
    }
  }
  res.setHeader('content-length', String(total));
  return res.end(wav);
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
    playbackState = null;
    searchHits = 0;
    return json(res, 200, { ok: true, mode: fixtureMode });
  }
  if (p === API + '/api/playback-state') {
    if (req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        try { playbackState = JSON.parse(body); } catch { playbackState = null; }
        json(res, 200, { ok: true });
      });
      return;
    }
    return json(res, 200, { ok: true, state: playbackState });
  }
  if (p === API + '/api/track' && req.method === 'DELETE') {
    // 带上 list 时只删该列表里的那一份
    return json(res, 200, { ok: true, removed: 1, count: TRACKS.length - 1, list: u.searchParams.get('list') });
  }
  if (p === API + '/widget/api/lrc/load') return json(res, 404, { ok: false, error: 'not found' });
  if (p === API + '/widget/api/lrc/save') return json(res, 200, { ok: true, filename: 'x.lrc' });
  if (p === API + '/widget/api/music/lrc') {
    const id = u.searchParams.get('id') || '';
    if (id === '900099') return text(res, 200, '', 'text/plain; charset=utf-8');  // 无词纯音乐
    if (id === '900098') return text(res, 200, '[00:00.00]这似乎是一首纯音乐呢，请尽情欣赏它吧！', 'text/plain; charset=utf-8');  // 占位词纯音乐
    return text(res, 200, lrcFor('fixture'), 'text/plain; charset=utf-8');
  }
  if (p === API + '/widget/api/music/lrc-proxy') {
    return text(res, 200, lrcFor('proxy'), 'text/plain; charset=utf-8');
  }
  if (p === API + '/widget/api/music/ttml') return text(res, 404, 'not in amll-db');
  if (p === API + '/widget/api/music/song') {
    const id = u.searchParams.get('id') || '0';
    return json(res, 200, { ok: true, track: { id: `netease:${id}`, title: `在线单曲 ${id}`, author: '测试歌手', url: goUrl(id), pic: '', lrc: '' }, host: 'mock' });
  }
  if (p === API + '/_fixture/cover.png') {
    res.setHeader('content-type', 'image/png');
    return fs.createReadStream(COVER_FILE).pipe(res);
  }
  if (p === API + '/_fixture/cover-square.png') {
    res.setHeader('content-type', 'image/png');
    return fs.createReadStream(COVER_SQUARE_FILE).pipe(res);
  }
  if (p === API + '/_fixture/cover-dark.png') {
    res.setHeader('content-type', 'image/png');
    return fs.createReadStream(COVER_DARK_FILE).pipe(res);
  }
  if (p === API + '/_fixture/cover-light.png') {
    res.setHeader('content-type', 'image/png');
    return fs.createReadStream(COVER_LIGHT_FILE).pipe(res);
  }
  if (p === API + '/_fixture/audio.wav') return serveAudio(req, res);
  // 假主题样式表（真实宿主同款端点 /api/apps/theme.css，不需要 surface session）
  if (p === '/api/apps/theme.css') {
    const name = u.searchParams.get('theme') || '';
    const HOSTFIX = { '--bg': '#112233', '--bg-card': '#1B2E44', '--text': '#E8F2FF', '--text-muted': '#8FA8C0', '--text-light': '#8FA8C0', '--accent': '#22AA88', '--border': 'rgba(150,180,220,0.2)' };
    const vars = /dark/.test(name) ? THEME_VARS.dark : (/hostfix/.test(name) ? HOSTFIX : THEME_VARS.light);
    return text(res, 200, ':root{' + Object.entries(vars).map(([k, v]) => `${k}:${v}`).join(';') + ';}', 'text/css; charset=utf-8');
  }
  if (p === API + '/widget/api/music/search') {
    searchHits++;
    const kw = u.searchParams.get('keyword') || '';
    return json(res, 200, { ok: true, results: [{ id: `netease:${770000 + kw.length}`, title: `命中 ${kw}`, author: '搜索歌手', url: goUrl(770000 + kw.length), pic: '', lrc: 'http://mock/lrc/' + encodeURIComponent(kw) }], host: 'mock', total: 1 });
  }
  if (p === API + '/widget/api/music/hot') {
    const results = Array.from({ length: 3 }, (_, i) => ({ id: `netease:${780000 + i}`, title: `热门推荐 ${i + 1}`, author: `推荐歌手 ${i + 1}`, url: goUrl(780000 + i), pic: '', lrc: '' }));
    return json(res, 200, { ok: true, results, host: 'mock' });
  }
  if (p === API + '/widget/api/music/charts') {
    return json(res, 200, { ok: true,
      charts: [{ id: '3778678', name: '热歌榜', pic: '', note: '每天更新', kind: 'chart' }],
      sheets: [{ id: '8904187604', name: '超火rap', pic: '', note: '109 首', kind: 'sheet' }],
      host: 'mock' });
  }
  if (p === API + '/widget/api/music/chart-tracks') {
    const id = u.searchParams.get('id') || '0';
    const results = Array.from({ length: 2 }, (_, i) => ({ id: `netease:${id}${i}`, title: `榜单曲 ${i + 1}`, author: '榜单歌手', url: goUrl(`${id}${i}`), pic: '', lrc: '' }));
    return json(res, 200, { ok: true, results, name: '热歌榜', host: 'mock' });
  }
  if (p === API + '/widget/api/music/radios') {
    return json(res, 200, { ok: true, results: [
      { id: '1230174483', name: '你，静不下来', pic: '', category: '情感', programCount: 73, subCount: 11595 },
      { id: '1225587488', name: '有声短剧', pic: '', category: '有声书', programCount: 46, subCount: 2097 }
    ], host: 'mock' });
  }
  if (p === API + '/widget/api/music/radio-programs') {
    const rid = u.searchParams.get('radioId') || '0';
    const results = Array.from({ length: 2 }, (_, i) => ({ id: `netease:${rid}0${i}`, title: `电台节目 ${i + 1}`, author: '主播', url: goUrl(`${rid}0${i}`), pic: '', dur: 2900, lrc: '' }));
    return json(res, 200, { ok: true, results, host: 'mock' });
  }
  if (p === API + '/widget/api/music/playlist') {
    const id = u.searchParams.get('id') || '0';
    const tracks = Array.from({ length: 5 }, (_, i) => ({ id: `netease:${id}${i}`, title: `歌单曲目 ${i + 1}`, author: '测试', url: goUrl(`${id}${i}`), pic: '', lrc: '' }));
    const server = u.searchParams.get('server') || 'netease';
    return json(res, 200, { ok: true, tracks, host: 'mock', ...(server === 'netease' ? { meta: PLAYLIST_META } : {}) });
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
  if (p.startsWith(API + '/widget/api/music/go/')) return serveAudio(req, res);
  if (p.startsWith(API + '/widget/media/')) return serveAudio(req, res);
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
  // 不传 --hide-scrollbars：之前它会藏住滚动条缺陷，等于把这类问题藏起来
  args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required', '--force-device-scale-factor=1']
});

const report = { selfCheck: [], wiring: {}, four: {}, darkFallback: {}, runtimeErrors: [], expectedProbes: [], assertions: [], refine: [], narrowSelfCheck: [], theme: {}, ambient: {} };

/* 断言登记：不通过就退非零，结果里逐条列出 */
function assert(name, ok, detail) {
  report.assertions.push({ name, ok: !!ok, detail: String(detail === undefined ? '' : detail) });
}
/* 预期噪声（文档已记）：降级链的探测性 404（离线库没命中 → 走在线）、
 * 切歌/卸载时 <audio> 主动 abort 媒体请求的 ERR_ABORTED。不计入致命错误，但逐条留档。 */
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
    /* 切歌/卸载时 <audio> 会主动 abort 上一个媒体请求，浏览器记 ERR_ABORTED —— 正常行为 */
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

/* ============ 2) 接线冒烟：多歌单切换 + 舞台呈现 ============ */
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
  await clickTab(page, 'local');
  await sleep(250);
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

  // 切到歌单 1，播放带封面的在线曲目（歌词降级链 + 有封面压字态）
  await clickTab(page, 'imp:1');
  await sleep(300);
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-hit').click());
  await sleep(700);
  w.coverState = await page.evaluate(() => ({
    nocover: document.getElementById('player').classList.contains('nocover'),
    titleColor: getComputedStyle(document.getElementById('trackTitle')).color
  }));
  w.afterPlayOnline = await page.evaluate(() => ({
    title: document.getElementById('trackTitle').textContent,
    lyricLines: document.querySelectorAll('#lyrics .lyric-line').length,
    hasEmpty: !!document.querySelector('#lyrics .lyric-empty'),
    audioPaused: document.getElementById('audio').paused,
    lyricScrolling: document.getElementById('lyrics').scrollHeight > document.getElementById('lyrics').clientHeight,
    nocover: document.getElementById('player').classList.contains('nocover')
  }));
  await page.screenshot({ path: path.join(outDir, 'cover-465x930-light.png') });
  // 宽窗 + 封面（设计稿主展示态）
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await sleep(500);
  await page.screenshot({ path: path.join(outDir, 'cover-1040x780-light.png') });
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await sleep(400);

  // 悬停歌词：滚动条现形但歌词宽度不变（不抽动）
  w.lyricBeforeHover = await page.evaluate(() => { const el = document.getElementById('lyrics'); return { clientWidth: el.clientWidth, offsetWidth: el.offsetWidth, sb: getComputedStyle(el).scrollbarColor }; });
  await page.hover('#lyrics');
  await sleep(350);
  w.lyricAfterHover = await page.evaluate(() => { const el = document.getElementById('lyrics'); return { clientWidth: el.clientWidth, offsetWidth: el.offsetWidth, sb: getComputedStyle(el).scrollbarColor }; });
  /* 滚动条断言（R1）：悬停前后歌词宽度必须相等 —— 滑块淡入不许挾压歌词 */
  assert('lyric-scrollbar-no-shift',
    w.lyricBeforeHover.clientWidth === w.lyricAfterHover.clientWidth &&
    w.lyricBeforeHover.offsetWidth === w.lyricAfterHover.offsetWidth &&
    w.lyricBeforeHover.sb !== w.lyricAfterHover.sb,
    JSON.stringify({ before: w.lyricBeforeHover, after: w.lyricAfterHover }));
  await page.mouse.move(2, 2);
  await sleep(250);
  await page.screenshot({ path: path.join(outDir, 'lyrics-465x930-light.png') });

  // 无词曲目：右侧换频谱，蒙层/渐变必须保持在线（R4）。
  // 现在歌词显隐不再由按钮控制，而是「有词就显、没词才出频谱」——
  // 所以这里直接播“无词纯音乐”（夹具里 id 900099，假后端对它回空 LRC）。
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#queueList .q-row')];
    const target = rows.find((r) => r.querySelector('.q-title').textContent.startsWith('无词纯音乐'));
    if (target) target.querySelector('.q-hit').click();
  });
  await sleep(700);
  w.lyricsoffState = await page.evaluate(() => {
    const cs = (id) => getComputedStyle(document.getElementById(id)).display;
    const rip = document.getElementById('rippleCanvas');
    return { wrap: cs('lyricWrap'), scrim: cs('lyricScrim'), ripple: rip ? cs('rippleCanvas') : 'none' };
  });
  assert('ripple-layer-when-no-lyrics',
    w.lyricsoffState.wrap === 'none' && w.lyricsoffState.scrim !== 'none' && w.lyricsoffState.ripple !== 'none',
    JSON.stringify(w.lyricsoffState));
  await page.screenshot({ path: path.join(outDir, 'no-lyrics-ripple-465x930-light.png') });
  // 切回有词曲目：歌词层回来
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#queueList .q-row')];
    const target = rows.find((r) => r.querySelector('.q-title').textContent.startsWith('在线曲目'));
    if (target) target.querySelector('.q-hit').click();
  });
  await sleep(700);
  w.lyricsBackState = await page.evaluate(() => {
    const cs = (id) => getComputedStyle(document.getElementById(id)).display;
    return { wrap: cs('lyricWrap') };
  });
  assert('lyrics-return-when-track-has-lyrics',
    w.lyricsBackState.wrap !== 'none',
    JSON.stringify(w.lyricsBackState));
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await sleep(400);
  await page.screenshot({ path: path.join(outDir, 'lyrics-1040x780-light.png') });
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await sleep(400);

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
    hasSrc: !!(document.getElementById('audio').getAttribute('src')),
    lyricLines: document.querySelectorAll('#lyrics .lyric-line').length
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

  // 重命名当前导入列表（内联编辑，不用模态）
  await page.evaluate(() => document.getElementById('renameBtn').click());
  await sleep(150);
  const hasInput = await page.evaluate(() => !!document.getElementById('listNameInput'));
  await page.evaluate(() => {
    const inp = document.getElementById('listNameInput');
    inp.value = '我的歌单';
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  });
  await sleep(200);
  w.rename = {
    hasInput,
    headerTitle: await page.$eval('#queueTitle', (e) => e.textContent),
    tabTitle: await page.$eval('#listTabs .list-tab.is-active', (e) => e.getAttribute('title'))
  };
  await page.screenshot({ path: path.join(outDir, 'rename-465x930-light.png') });

  // 导入在线单曲 → 归入当前激活列表（当前是刚导入的歌单）
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

/* ============ 2c) 动效（BRIEF-MOTION）：隐现/3行聚焦/频谱兜底/按压 ============ */
const motion = {};
{
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await sleep(800);
  await clickTab(page, 'imp:1');
  await sleep(300);
  // 有歌词：3 行聚焦 —— 非邻行 opacity 应明显低于当前行
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-hit').click());
  await sleep(900);
  motion.focus = await page.evaluate(() => {
    const cur = document.querySelector('.lyric-line.is-current');
    const near = document.querySelector('.lyric-line.is-near');
    const far = [...document.querySelectorAll('.lyric-line')].find((e) => !e.classList.contains('is-current') && !e.classList.contains('is-near'));
    const op = (e) => e ? +parseFloat(getComputedStyle(e).opacity).toFixed(2) : null;
    return { cur: op(cur), near: op(near), far: op(far), layout: document.getElementById('player').getAttribute('data-layout') };
  });
  assert('motion-three-line-focus',
    motion.focus.layout !== 'wide' && motion.focus.cur > motion.focus.far && motion.focus.near > motion.focus.far && motion.focus.far <= 0.3,
    JSON.stringify(motion.focus));

  // 换层（motion 4）：有词曲目 ⇄ 无词曲目 互斥切换，且蒙层/渐变始终在线。
  // 不再由按钮驱动（按钮已删）——改由「有词/无词曲目」驱动，确定性更强。
  motion.crossfade = await page.evaluate(async () => {
    const vis = (id) => getComputedStyle(document.getElementById(id)).display;
    const rows = () => [...document.querySelectorAll('#queueList .q-row')];
    const pick = (kw) => { const r = rows().find((x) => x.querySelector('.q-title').textContent.startsWith(kw)); if (r) r.querySelector('.q-hit').click(); return !!r; };
    const has = () => document.getElementById('player').getAttribute('data-haslyrics');
    // 已经在有词曲目上（上面刚播过）
    const withLyrics = { wrap: vis('lyricWrap'), scrim: vis('lyricScrim'), has: has() };
    // 切到无词曲目（“无词纯音乐”，假后端回空 LRC）
    pick('无词纯音乐');
    await new Promise((r) => setTimeout(r, 800));
    const noLyrics = { wrap: vis('lyricWrap'), scrim: vis('lyricScrim'), has: has() };
    // 再切回有词曲目
    pick('在线曲目');
    await new Promise((r) => setTimeout(r, 800));
    const back = { wrap: vis('lyricWrap'), has: has() };
    return { withLyrics, noLyrics, back };
  });
  assert('motion-lyric-crossfade',
    motion.crossfade.withLyrics.wrap !== 'none' && motion.crossfade.withLyrics.has === '1' &&
    motion.crossfade.noLyrics.wrap === 'none' && motion.crossfade.noLyrics.scrim !== 'none' &&
    motion.crossfade.noLyrics.has === '0' &&
    motion.crossfade.back.wrap !== 'none' && motion.crossfade.back.has === '1',
    JSON.stringify(motion.crossfade));

  // 歌词跟随 3s 自动回归：滚动（wheel）后停 3.4s 应回到跟随（is-browsing 消失）
  motion.follow = await page.evaluate(async () => {
    const wrap = document.getElementById('lyricWrap');
    const ls = document.getElementById('lyrics');
    wrap.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    const browsingNow = ls.classList.contains('is-browsing');
    await new Promise((r) => setTimeout(r, 3400));
    return { browsingNow, browsingAfter: ls.classList.contains('is-browsing') };
  });
  assert('motion-follow-auto-resume',
    motion.follow.browsingNow === true && motion.follow.browsingAfter === false,
    JSON.stringify(motion.follow));

  // 鼠标悬停移动不算「浏览」：不应重置 3s 回归（桌面下否则永不回归）
  motion.followMouse = await page.evaluate(async () => {
    const wrap = document.getElementById('lyricWrap');
    const ls = document.getElementById('lyrics');
    wrap.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }));
    await new Promise((r) => setTimeout(r, 60));
    for (let i = 0; i < 5; i++) {
      wrap.dispatchEvent(new PointerEvent('pointermove', { pointerType: 'mouse', bubbles: true }));
      await new Promise((r) => setTimeout(r, 400));
    }
    const browsingMid = ls.classList.contains('is-browsing');
    await new Promise((r) => setTimeout(r, 1600));
    return { browsingMid, browsingAfter: ls.classList.contains('is-browsing') };
  });
  assert('motion-follow-mouse-ignored',
    motion.followMouse.browsingMid === true && motion.followMouse.browsingAfter === false,
    JSON.stringify(motion.followMouse));

  // 无歌词 → 自动出频谱（不再显「暂无歌词」）
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#queueList .q-row')];
    const t = rows.find((r) => r.querySelector('.q-title').textContent.startsWith('无词'));
    if (t) t.querySelector('.q-hit').click();
  });
  await sleep(900);
  motion.nolyr = await page.evaluate(() => ({
    haslyrics: document.getElementById('player').getAttribute('data-haslyrics'),
    rippleShown: !!(document.getElementById('rippleCanvas') && getComputedStyle(document.getElementById('rippleCanvas')).display !== 'none'),
    emptyShown: !!document.querySelector('#lyrics .lyric-empty')
  }));
  assert('motion-ripple-when-no-lyrics',
    motion.nolyr.haslyrics === '0' && motion.nolyr.emptyShown === false,
    JSON.stringify(motion.nolyr));

  // 指针涟漪：手动喂一圈，波列表增长；不读音频（无 captureStream 依赖）
  motion.ripple = await page.evaluate(() => {
    const dbg = window.__playerDebug;
    if (!dbg || typeof dbg.ripplePoke !== 'function') return { ok: false, reason: 'no-hook' };
    const before = dbg.rippleState();
    const n = dbg.ripplePoke(0.4, 0.5, true);
    return { ok: true, exists: before.exists !== false, beforeWaves: before.waves, afterWaves: n };
  });
  assert('motion-ripple-poke-adds-wave',
    motion.ripple.ok === true && motion.ripple.afterWaves >= 1 &&
    motion.ripple.afterWaves > (motion.ripple.beforeWaves || 0),
    JSON.stringify(motion.ripple));

  // 音频反应：喂一个强低频 → 走 readSignal 的鼓点分支落一个波（真机接同源音频后同一条路径）
  motion.audio = await page.evaluate(() => {
    const dbg = window.__playerDebug;
    if (!dbg || typeof dbg.rippleAudioPoke !== 'function') return { ok: false, reason: 'no-hook' };
    const st = dbg.rippleAudio();
    const before = st.waves;
    const after = dbg.rippleAudioPoke(0.08);
    return { ok: true, ready: st.ready, beforeWaves: before, afterWaves: after };
  });
  assert('motion-ripple-reactive-to-audio',
    motion.audio.ok === true && motion.audio.afterWaves > (motion.audio.beforeWaves || 0),
    JSON.stringify(motion.audio));

  // 按钮按压：:active 样式存在（scale）—— 检查样式表里确实写了
  motion.press = await page.evaluate(() => {
    const el = document.getElementById('playBtn');
    const cs = getComputedStyle(el).transitionProperty || '';
    return { trans: cs };
  });
  assert('motion-press-feedback',
    /transform/.test(motion.press.trans),
    JSON.stringify(motion.press));

  // 队列退场（宽窗抽屉）：关闭瞬间仍挂载（is-q-leaving），动画后才卸载
  {
    const p2 = await newPage();
    await p2.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
    await p2.goto(`${BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
    await sleep(700);
    motion.queueExit = await p2.evaluate(async () => {
      const player = document.getElementById('player');
      const q = document.getElementById('queue');
      document.getElementById('queueBtn').click();   // 打开抽屉
      await new Promise((r) => setTimeout(r, 380));
      const opened = { drawer: player.getAttribute('data-drawer'), disp: getComputedStyle(q).display };
      document.getElementById('queueBtn').click();   // 关闭
      await new Promise((r) => setTimeout(r, 70));
      const leaving = { drawer: player.getAttribute('data-drawer'), cls: player.classList.contains('is-q-leaving'), disp: getComputedStyle(q).display };
      await new Promise((r) => setTimeout(r, 320));
      const settled = { cls: player.classList.contains('is-q-leaving'), disp: getComputedStyle(q).display };
      return { opened, leaving, settled };
    });
    assert('motion-queue-exit-anim',
      motion.queueExit.opened.disp !== 'none' && motion.queueExit.leaving.cls === true &&
      motion.queueExit.leaving.disp !== 'none' && motion.queueExit.settled.cls === false &&
      motion.queueExit.settled.disp === 'none',
      JSON.stringify(motion.queueExit));
    await p2.close();
  }

  // 矮卡整页交叉：点开队列时舞台仍在场（左滑出）而不是瞬间消失
  {
    const p3 = await newPage();
    await p3.setViewport({ width: 531, height: 451, deviceScaleFactor: 1 });
    await p3.goto(`${BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
    await sleep(700);
    motion.compactEnter = await p3.evaluate(async () => {
      const player = document.getElementById('player');
      const scene = document.getElementById('scene');
      const q = document.getElementById('queue');
      document.getElementById('queueBtn').click();
      await new Promise((r) => setTimeout(r, 70));
      const mid = { page: player.getAttribute('data-page'), cls: player.classList.contains('is-q-in'), scene: getComputedStyle(scene).display, queue: getComputedStyle(q).display };
      await new Promise((r) => setTimeout(r, 300));
      const settled = { cls: player.classList.contains('is-q-in'), scene: getComputedStyle(scene).display, queue: getComputedStyle(q).display };
      return { mid, settled };
    });
    assert('motion-compact-queue-enter',
      motion.compactEnter.mid.cls === true && motion.compactEnter.mid.scene !== 'none' &&
      motion.compactEnter.mid.queue !== 'none' && motion.compactEnter.settled.cls === false &&
      motion.compactEnter.settled.scene === 'none' && motion.compactEnter.settled.queue !== 'none',
      JSON.stringify(motion.compactEnter));
    await p3.close();
  }

  report.motion = motion;
  await page.close();
}

/* ============ 2b) 四项改造：来源重做 / 真名压缩 / 歌手补齐 / 歌单可删 ============ */
{
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await sleep(800);

  const w2 = {};
  const metaText = () => page.$eval('#trackMeta', (e) => e.textContent);
  const tabInfo2 = () => page.$$eval('#listTabs .list-tab', (els) => els.map((e) => ({ list: e.getAttribute('data-list'), label: e.textContent.trim(), title: e.getAttribute('title') })));

  // ---- (a) 元信息行：本地曲目 →「来源·本地」
  await clickTab(page, 'local');
  await sleep(200);
  await page.evaluate(() => {
    if (window.hana && window.hana.resources) window.hana.resources.pick = () => Promise.resolve({ resources: [{ path: '/Users/fake/Music' }] });
  });
  await page.evaluate(() => document.getElementById('localPickBtn').click());
  await sleep(700);
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-hit').click());
  await sleep(400);
  w2.localMeta = await metaText();
  assert('meta-source-local', w2.localMeta === '来源·本地', w2.localMeta);
  await page.screenshot({ path: path.join(outDir, 'source-local-465x930-light.png') });

  // ---- (b) 元信息行：在线曲目 →「来源·<歌单名>」（间隔点格式）
  await clickTab(page, 'imp:1');
  await sleep(250);
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-hit').click());
  await sleep(400);
  w2.onlineMeta = await metaText();
  assert('meta-source-format', w2.onlineMeta.indexOf('来源·') === 0 && w2.onlineMeta.length > 3, w2.onlineMeta);
  await page.screenshot({ path: path.join(outDir, 'source-online-465x930-light.png') });

  // ---- (c) 队列第二行：没有 artist 就留空（不让 group 冒充）
  await clickTab(page, 'imp:2');
  await sleep(250);
  w2.queueArtists = await page.$$eval('#queueList .q-row .q-artist', (els) => els.map((e) => e.textContent.trim()));
  assert('queue-artist-empty-when-none',
    w2.queueArtists.length > 0 && w2.queueArtists.every((a) => a === ''),
    JSON.stringify(w2.queueArtists));

  // ---- (c2) 我的喜欢：红心加入 / 切换条出现「我的喜欢」/ 跨列表同曲同亮 / 取消不动原歌单
  const favState = () => page.evaluate(() => ({
    onRows: [...document.querySelectorAll('#queueList .q-row .q-fav.is-on')].length,
    total: document.querySelectorAll('#queueList .q-row .q-fav').length,
    tabs: [...document.querySelectorAll('#listTabs .list-tab')].map((e) => e.getAttribute('data-list'))
  }));
  // imp:2 首行点亮红心
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-fav').click());
  await sleep(250);
  w2.favAfterAdd = await favState();
  assert('fav-row-toggles-on',
    w2.favAfterAdd.onRows === 1 && w2.favAfterAdd.tabs.indexOf('fav') >= 0,
    JSON.stringify(w2.favAfterAdd));

  // 切到「我的喜欢」：只收到那一首，元信息行显示「来源·我的喜欢」
  await clickTab(page, 'fav');
  await sleep(250);
  w2.favList = { rows: await rowCount(page), first: (await rowTitles(page))[0] };
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-hit').click());
  await sleep(350);
  w2.favMeta = await metaText();
  assert('fav-list-collects-and-labels',
    w2.favList.rows === 1 && w2.favMeta === '来源·我的喜欢',
    JSON.stringify({ rows: w2.favList.rows, meta: w2.favMeta }));
  await page.screenshot({ path: path.join(outDir, 'fav-465x930-light.png') });

  // 跨列表同亮：imp:1 与 imp:2 各有一首同 id（在线曲目 1 = netease:900000）。
  // 在 imp:2 点亮后，切到 imp:1 同名 id 那颗心也应亮 —— 证明红心按稳定 id 判，不按 uid。
  await clickTab(page, 'imp:1');
  await sleep(250);
  const crossFav = await page.evaluate(() => {
    const row = [...document.querySelectorAll('#queueList .q-row')].find((r) => r.getAttribute('data-id') === 'netease:900000');
    return { found: !!row, on: !!(row && row.querySelector('.q-fav.is-on')), onRows: document.querySelectorAll('#queueList .q-fav.is-on').length };
  });
  w2.favCrossList = crossFav;
  assert('fav-state-by-stable-id-cross-list', crossFav.found === true && crossFav.on === true, JSON.stringify(crossFav));

  // 取消喜欢：从「我的喜欢」移出，原歌单那份纹丝不动
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-fav').click());
  await sleep(250);
  const afterUnfav = await page.evaluate(() => ({
    onRowsImp1: document.querySelectorAll('#queueList .q-fav.is-on').length,
    rowsImp1: document.querySelectorAll('#queueList .q-row').length
  }));
  await clickTab(page, 'fav');
  await sleep(250);
  const favAfterUnfav = await page.evaluate(() => document.querySelectorAll('#queueList .q-row').length);
  w2.favUnfav = { afterUnfav, favRows: favAfterUnfav };
  assert('fav-unfav-keeps-original-list',
    afterUnfav.onRowsImp1 === 0 && afterUnfav.rowsImp1 === 20 && favAfterUnfav === 0,
    JSON.stringify(w2.favUnfav));

  // 「我的喜欢」不可删：长按不弹删除浮层
  await page.evaluate(() => {
    const tab = document.querySelector('#listTabs .list-tab[data-list="fav"]');
    tab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
  await sleep(700);
  const favPopOpen = await page.evaluate(() => !document.getElementById('listPop').hidden);
  await page.evaluate(() => {
    const tab = document.querySelector('#listTabs .list-tab[data-list="fav"]');
    tab.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  assert('fav-not-deletable', favPopOpen === false, String(favPopOpen));
  await clickTab(page, 'imp:2');
  await sleep(200);

  // ---- (c3) 播放页红心（曲名下方 meta 旁）：跟着当前曲换，点亮后同步到队列行
  await clickTab(page, 'imp:1');
  await sleep(200);
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-hit').click());
  await sleep(350);
  const stageFavBefore = await page.evaluate(() => ({
    hidden: document.getElementById('stageFavBtn').hidden,
    pressed: document.getElementById('stageFavBtn').getAttribute('aria-pressed'),
    // 图标必须在（曾经是空标签导致红心看不见）
    hasIcon: !!document.querySelector('#stageFavBtn .icon use'),
    svgW: Math.round((document.querySelector('#stageFavBtn .icon') || {getBoundingClientRect:()=>({width:0})}).getBoundingClientRect().width)
  }));
  await page.evaluate(() => document.getElementById('stageFavBtn').click());
  await sleep(300);
  const stageFavAfter = await page.evaluate(() => ({
    pressed: document.getElementById('stageFavBtn').getAttribute('aria-pressed'),
    on: document.getElementById('stageFavBtn').classList.contains('is-on'),
    rowOn: document.querySelectorAll('#queueList .q-fav.is-on').length
  }));
  w2.stageFav = { before: stageFavBefore, after: stageFavAfter };
  assert('stage-fav-toggles-and-syncs-row',
    stageFavBefore.hidden === false && stageFavBefore.pressed === 'false' &&
    stageFavBefore.hasIcon === true && stageFavBefore.svgW >= 11 &&
    stageFavAfter.on === true && stageFavAfter.pressed === 'true' && stageFavAfter.rowOn === 1,
    JSON.stringify(w2.stageFav));
  // 心收回（不留侧效给后续用例）
  await page.evaluate(() => document.getElementById('stageFavBtn').click());
  await sleep(250);

  // ---- (c2b) 控制条常驻红心：纯图标（无「喜欢」文字）+ 点亮 + 与播放页/队列行同步
  const ctlFavBefore = await page.evaluate(() => ({
    pressed: document.getElementById('favBtn').getAttribute('aria-pressed'),
    text: document.getElementById('favBtn').textContent.trim(),
    hasIcon: !!document.querySelector('#favBtn .icon use'),
    isBar: document.getElementById('favBtn').classList.contains('fav-btn-bar')
  }));
  await page.evaluate(() => document.getElementById('favBtn').click());
  await sleep(250);
  const ctlFavAfter = await page.evaluate(() => ({
    pressed: document.getElementById('favBtn').getAttribute('aria-pressed'),
    on: document.getElementById('favBtn').classList.contains('is-on'),
    stageOn: document.getElementById('stageFavBtn').classList.contains('is-on'),
    rowOn: document.querySelectorAll('#queueList .q-fav.is-on').length
  }));
  w2.ctlFav = { before: ctlFavBefore, after: ctlFavAfter };
  assert('control-bar-fav-toggles',
    ctlFavBefore.pressed === 'false' && ctlFavBefore.text === '' &&
    ctlFavBefore.hasIcon === true && ctlFavBefore.isBar === true &&
    ctlFavAfter.on === true && ctlFavAfter.pressed === 'true' &&
    ctlFavAfter.stageOn === true && ctlFavAfter.rowOn === 1,
    JSON.stringify(w2.ctlFav));
  await page.evaluate(() => document.getElementById('favBtn').click());   // 收回
  await sleep(250);

  // ---- (c2c) 切回列表自动居中正在播的那首
  // 播 imp:1 靠后的一首，手动滚到顶，切走再切回 —— 它应被滚回可视区中部。
  await page.evaluate(() => {
    const rows = document.querySelectorAll('#queueList .q-row');
    rows[15].querySelector('.q-hit').click();
  });
  await sleep(400);
  await page.evaluate(() => { document.getElementById('queueList').scrollTop = 0; });
  await clickTab(page, 'imp:2');
  await sleep(200);
  await clickTab(page, 'imp:1');
  await sleep(350);
  const centerAfter = await page.evaluate(() => {
    const list = document.getElementById('queueList');
    const cur = list.querySelector('.q-row.is-current');
    if (!cur) return { found: false };
    const rowMid = cur.offsetTop + cur.offsetHeight / 2 - list.scrollTop;
    return { found: true, scrolled: list.scrollTop > 0, rowMid: Math.round(rowMid), viewMid: Math.round(list.clientHeight / 2) };
  });
  w2.centerOnSwitch = centerAfter;
  assert('queue-center-on-list-switch',
    centerAfter.found === true && centerAfter.scrolled === true &&
    Math.abs(centerAfter.rowMid - centerAfter.viewMid) <= 40,   // 居中容差 40px（半行高量级）
    JSON.stringify(w2.centerOnSwitch));

  // 回到 imp:2（(d) 补全歌手针对的就是这个列表里的 searchKey 曲目）
  await clickTab(page, 'imp:2');
  await sleep(200);

  // ---- (d) 歌手补齐：searchKey 曲目补 author，且幂等
  const hitsBefore = searchHits;
  await page.evaluate(() => document.querySelector('[data-import="backfill"]').click());
  let filled = 0;
  for (let i = 0; i < 60; i++) {
    await sleep(150);
    filled = await page.evaluate(() => {
      const rows = [...document.querySelectorAll('#queueList .q-row')];
      return rows.filter((r) => r.querySelector('.q-title').textContent.startsWith('搜索曲目') && r.querySelector('.q-artist').textContent.trim()).length;
    });
    if (filled >= 3) break;
  }
  w2.backfill = { searchHitsDelta: searchHits - hitsBefore, filledRows: filled };
  assert('backfill-fills-artist', filled === 3 && searchHits - hitsBefore === 3, JSON.stringify(w2.backfill));
  await page.screenshot({ path: path.join(outDir, 'backfill-465x930-light.png') });

  // 幂等：再跑一次，不再发起搜索
  const hits2 = searchHits;
  await page.evaluate(() => document.querySelector('[data-import="backfill"]').click());
  await sleep(700);
  w2.backfillIdempotent = { searchHitsDelta: searchHits - hits2 };
  assert('backfill-idempotent', searchHits - hits2 === 0, JSON.stringify(w2.backfillIdempotent));

  // ---- (e) 歌单真名：导入歌单后切换条显示压缩名、title 是完整名
  await page.evaluate(() => {
    document.getElementById('importBtn').click();
    document.getElementById('linkInput').value = 'https://music.163.com/#/playlist?id=888';
    document.getElementById('linkAddBtn').click();
  });
  await sleep(700);
  const afterImport = await tabInfo2();
  const imported = afterImport.find((t) => t.title === PLAYLIST_META.name);
  w2.realName = { tabs: afterImport, imported };
  assert('list-realname-compressed',
    !!imported && imported.label === 'Can_0201' && imported.title === 'Can_0201喜欢的音乐',
    JSON.stringify(imported));
  await page.screenshot({ path: path.join(outDir, 'list-realname-465x930-light.png') });

  // ---- (f) 长按导入列表 → 弹删除浮层（不误切列表），取消后无变化
  await clickTab(page, 'imp:2');
  await sleep(200);
  const tabsBeforePress = (await tabInfo2()).map((t) => t.list).join(',');
  await page.evaluate(() => {
    const tab = document.querySelector('#listTabs .list-tab[data-list="imp:2"]');
    tab.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
  });
  await sleep(700);
  const popAfterPress = await page.evaluate(() => ({
    open: !document.getElementById('listPop').hidden,
    title: document.getElementById('listPopTitle').textContent,
    activeList: document.querySelector('#listTabs .list-tab.is-active').getAttribute('data-list')
  }));
  await page.evaluate(() => {
    const tab = document.querySelector('#listTabs .list-tab[data-list="imp:2"]');
    tab.dispatchEvent(new PointerEvent('pointerup', { bubbles: true }));
  });
  await page.evaluate(() => document.getElementById('listCancelBtn').click());
  await sleep(200);
  const popClosed = await page.evaluate(() => document.getElementById('listPop').hidden);
  w2.longPress = { popAfterPress, popClosed, tabsUnchanged: (await tabInfo2()).map((t) => t.list).join(',') === tabsBeforePress };
  assert('list-longpress-opens-pop',
    popAfterPress.open === true && popAfterPress.title.indexOf('删除') === 0 && popAfterPress.activeList === 'imp:2',
    JSON.stringify(w2.longPress));
  assert('list-longpress-cancel', popClosed === true && w2.longPress.tabsUnchanged === true, JSON.stringify(w2.longPress));

  // ---- (g) 右键删除「正在播的那首」所在的列表：播放不中断，列表从切换条消失
  await clickTab(page, 'imp:1');
  await sleep(250);
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-hit').click());
  await sleep(900);
  const before = await page.evaluate(() => ({
    playing: document.getElementById('player').getAttribute('data-playing'),
    title: document.getElementById('trackTitle').textContent,
    paused: document.getElementById('audio').paused,
    rows: document.querySelectorAll('#queueList .q-row').length,
    activeList: document.querySelector('#listTabs .list-tab.is-active').getAttribute('data-list'),
    currentUid: (document.querySelector('#queueList .q-row.is-current') || {}).getAttribute
      ? document.querySelector('#queueList .q-row.is-current').getAttribute('data-uid') : ''
  }));
  await page.evaluate(() => {
    const tab = document.querySelector('#listTabs .list-tab[data-list="imp:1"]');
    tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  });
  await sleep(250);
  const popTitle = await page.$eval('#listPopTitle', (e) => e.textContent);
  await page.screenshot({ path: path.join(outDir, 'list-delete-confirm-465x930-light.png') });
  await page.evaluate(() => document.getElementById('listDeleteBtn').click());
  await sleep(700);
  const after = await page.evaluate(() => ({
    playing: document.getElementById('player').getAttribute('data-playing'),
    title: document.getElementById('trackTitle').textContent,
    paused: document.getElementById('audio').paused,
    activeList: document.querySelector('#listTabs .list-tab.is-active').getAttribute('data-list'),
    tabs: [...document.querySelectorAll('#listTabs .list-tab')].map((e) => e.getAttribute('data-list'))
  }));
  w2.deletePlaying = { before, popTitle, after };
  assert('list-delete-while-playing',
    before.playing === '1' && before.paused === false && before.rows === 20 &&
    before.activeList === 'imp:1' && String(before.currentUid).indexOf('imp:1|') === 0 &&
    after.playing === '1' && after.paused === false && after.title === before.title &&
    after.tabs.indexOf('imp:1') < 0 && after.activeList === 'local',
    JSON.stringify(w2.deletePlaying));
  assert('list-delete-confirm-title', popTitle.indexOf('删除') === 0, popTitle);

  // 被删列表的曲目不再出现；其余列表不受影响
  const remaining = await tabInfo2();
  const perList = {};
  for (const t of remaining) {
    await clickTab(page, t.list);
    await sleep(150);
    perList[t.list] = await rowCount(page);
  }
  w2.afterDelete = { tabs: remaining.map((t) => t.list), perList };
  assert('list-delete-others-intact',
    remaining.some((t) => t.list === 'imp:2') && perList['imp:2'] === 6 &&
    remaining.every((t) => t.list !== 'imp:1'),
    JSON.stringify(w2.afterDelete));

  // 本地列表不可删（右键不弹浮层）
  await page.evaluate(() => {
    const tab = document.querySelector('#listTabs .list-tab[data-list="local"]');
    tab.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
  });
  await sleep(150);
  const localPopOpen = await page.evaluate(() => !document.getElementById('listPop').hidden);
  assert('list-local-not-deletable', localPopOpen === false, String(localPopOpen));

  /* 歌词跨源兜底：拿「标题+歌手」去别的平台搜时，匹配规则必须保守。
   * 纯函数，不依赖网络（走 __playerDebug 钩子）；防「纯音乐被配成同名歌曲」这类乱配。 */
  const lyricMatch = await page.evaluate(() => {
    const D = window.__playerDebug;
    const mk = (title, author) => ({ title, author, url: 'x' });
    const hit = (list, t, a) => { const r = D.pickLyricHit(list, t, a); return r ? (r.title + '/' + r.author) : null; };
    return {
      exact: hit([mk('晴天', '周杰伦')], '晴天', '某某'),                 // 同名直取
      bracketVersion: hit([mk('晴天 (Live版)', '周杰伦')], '晴天', ''),     // 括号版本注记 → 归一后同名
      wrongTitle: hit([mk('雨天', '周杰伦')], '晴天', '周杰伦'),           // 标题不同不取
      authorPreferred: hit([mk('晴天', '林俊杰'), mk('晴天', '周杰伦')], '晴天', '周杰伦'), // 同名时作者对得上的优先
      emptyList: hit([], '晴天', '周杰伦'),
      noUrl: (function () { const r = D.pickLyricHit([{ title: '晴天', author: '周杰伦' }], '晴天', '周杰伦'); return r ? 'has' : 'null'; })()  // 无 url 的结果不取
    };
  });
  assert('lyric-crosssource-match-rules',
    lyricMatch.exact === '晴天/周杰伦' && lyricMatch.bracketVersion === '晴天 (Live版)/周杰伦' &&
    lyricMatch.wrongTitle === null && lyricMatch.authorPreferred === '晴天/周杰伦' &&
    lyricMatch.emptyList === null && lyricMatch.noUrl === 'null',
    JSON.stringify(lyricMatch));

  /* 占位词识别：纯音乐占位句（「这似乎是一首纯音乐呢」等）当空处理，不占歌词层 */
  const placeholder = await page.evaluate(() => {
    const D = window.__playerDebug;
    if (!D || typeof D.lyricIsPlaceholder !== 'function') return { ok: false, reason: 'no-hook' };
    const one = (t) => D.lyricIsPlaceholder([{ t: 0, text: t }]);
    return {
      ok: true,
      pure: one('这似乎是一首纯音乐呢，请尽情欣赏它吧！'),
      enjoy: one('纯音乐，请欣赏'),
      real: one('作词 : ACAね'),
      real2: one('おはよう　おつかれ')
    };
  });
  assert('lyric-placeholder-treated-as-empty',
    placeholder.ok === true && placeholder.pure === true && placeholder.enjoy === true &&
    placeholder.real === false && placeholder.real2 === false,
    JSON.stringify(placeholder));

  /* 音频反应链**只走 captureStream**（非破坏性副本）：同源拿数据、跨源抛错退回纯指针。
   * **绝不能**回到 createMediaElementSource —— 跨源会输出全零（静音）且不可逆。源码级守卫，去注释后再查。 */
  const codeNoComments = fs.readFileSync(path.join(uiDir, 'app.js'), 'utf-8')
    .replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  assert('reactive-uses-captureStream-not-mediaElementSource',
    /\.captureStream\s*\(/.test(codeNoComments) && !/createMediaElementSource\s*\(/.test(codeNoComments),
    JSON.stringify({ usesCaptureStream: /\.captureStream\s*\(/.test(codeNoComments), callsOldApi: /createMediaElementSource\s*\(/.test(codeNoComments) }));

  report.four = w2;
  await page.close();
}

/* ============ 2c) 搜索页：左下角入口（仅独立窗）+ 搜索行尾红心落库 + 点播 ============ */
{
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/standalone.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await sleep(700);

  const s = {};
  // 入口仅独立窗口（wide）可见；现在长在按钮行最左，与最右队列左右对称；歌名居中显示
  s.entryVisibleWide = await page.evaluate(() => {
    const b = document.getElementById('searchEntryBtn');
    const r = b.getBoundingClientRect();
    const row = b.closest('.btn-row');
    const leftCell = row.querySelector('.cell-left');
    const qb = document.getElementById('queueBtn');
    const ct = document.getElementById('ctlTitle');
    const pr = document.getElementById('playBtn').getBoundingClientRect();
    const rr = row.getBoundingClientRect();
    return {
      shown: getComputedStyle(b).display !== 'none' && r.width > 0,
      firstInRow: !!leftCell && leftCell.firstElementChild === b,
      qbIconOnly: getComputedStyle(qb.querySelector('.qb-label')).display === 'none',
      titleShown: getComputedStyle(ct).display !== 'none' && ct.textContent.trim().length > 0,
      playCentered: Math.abs((pr.left + pr.width / 2) - (rr.left + rr.width / 2)) < 2
    };
  });
  assert('search-entry-visible-in-window', s.entryVisibleWide.shown === true, JSON.stringify(s.entryVisibleWide));
  assert('ctl-endpoints-symmetric-wide',
    s.entryVisibleWide.firstInRow === true && s.entryVisibleWide.qbIconOnly === true && s.entryVisibleWide.titleShown === true,
    JSON.stringify(s.entryVisibleWide));
  assert('ctl-play-centered-wide', s.entryVisibleWide.playCentered === true, JSON.stringify(s.entryVisibleWide));

  // 窄卡（compact 高<560）下入口与歌名都应隐藏
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await sleep(300);
  s.entryHiddenCard = await page.evaluate(() => {
    const b = document.getElementById('searchEntryBtn');
    return getComputedStyle(b).display === 'none' || b.getBoundingClientRect().width === 0;
  });
  assert('search-entry-hidden-in-card', s.entryHiddenCard === true, String(s.entryHiddenCard));
  s.titleHiddenCard = await page.evaluate(() => getComputedStyle(document.getElementById('ctlTitle')).display === 'none');
  assert('ctl-title-hidden-in-card', s.titleHiddenCard === true, String(s.titleHiddenCard));

  // 回到独立窗，开搜索页 → 直接喂假结果 → 点行尾红心 → 曲目落进「我的喜欢」
  await page.setViewport({ width: 1040, height: 780, deviceScaleFactor: 1 });
  await sleep(300);
  await clickTab(page, 'imp:1');
  await sleep(200);
  const beforeRows = await page.evaluate(() => document.querySelectorAll('#queueList .q-row').length);
  await page.evaluate(() => {
    window.__playerDebug.renderDiscover({ hot: [], charts: [], sheets: [], radios: [] });
    window.__playerDebug.openSearch();
    window.__playerDebug.renderResults([
      { id: 'netease:770001', title: '搜索命中曲', author: '搜索歌手', url: '/api/apps/hanako-audio-player/routes/widget/api/music/go/770001?server=netease', pic: '' }
    ]);
  });
  await sleep(200);
  s.pageOpen = await page.evaluate(() => ({ open: window.__playerDebug.searchState().open, rows: document.querySelectorAll('#searchList .search-row').length, favBtns: document.querySelectorAll('#searchList .search-fav').length }));
  assert('search-page-lists-results',
    s.pageOpen.open === true && s.pageOpen.rows === 1 && s.pageOpen.favBtns === 1,
    JSON.stringify(s.pageOpen));
  // 搜索页只盖舞台，不得遮住底部控制条（罐头拍板）
  s.coversControls = await page.evaluate(() => {
    const sp = document.getElementById('searchPage').getBoundingClientRect();
    const ctl = document.getElementById('controls').getBoundingClientRect();
    return { searchBottom: Math.round(sp.bottom), controlsTop: Math.round(ctl.top), spW: Math.round(sp.width), frameW: Math.round(document.getElementById('frame').getBoundingClientRect().width) };
  });
  assert('search-page-not-cover-controls',
    s.coversControls.searchBottom <= s.coversControls.controlsTop + 1,
    JSON.stringify(s.coversControls));
  await page.screenshot({ path: path.join(outDir, 'search-page-1040x780-light.png') });

  // 行尾红心：点一下 = 收藏到「我的喜欢」（加入与心是同一件事）
  await page.evaluate(() => document.querySelector('#searchList .search-fav').click());
  await sleep(300);
  s.afterAdd = await page.evaluate(() => ({
    favOn: !!document.querySelector('#searchList .search-fav.is-on'),
    inFav: Array.prototype.some.call(document.querySelectorAll('#listTabs .list-tab'), (e) => e.getAttribute('data-list') === 'fav')
  }));
  // 拍板：搜索行尾红心 = 收藏，落「我的喜欢」（不再新建隐形「搜索」歌单）
  await clickTab(page, 'fav');
  await sleep(250);
  s.favRows = await page.evaluate(() => ({
    count: document.querySelectorAll('#queueList .q-row').length,
    hasNew: Array.prototype.some.call(document.querySelectorAll('#queueList .q-title'), (e) => e.textContent === '搜索命中曲')
  }));
  assert('search-fav-toggles-fav',
    s.afterAdd.favOn === true && s.afterAdd.inFav === true && s.favRows.hasNew === true,
    JSON.stringify({ afterAdd: s.afterAdd, favRows: s.favRows }));

  // 点搜索结果行 = 直接播（不落喜欢）；播过的自动进「最近播放」
  await page.evaluate(() => {
    window.__playerDebug.openSearch();
    window.__playerDebug.renderResults([
      { id: 'netease:770002', title: '点播命中曲', author: '点播歌手', url: '/api/apps/hanako-audio-player/routes/widget/api/music/go/770002?server=netease', pic: '' }
    ]);
  });
  await sleep(200);
  s.playHit = await page.evaluate(() => ({ hits: document.querySelectorAll('#searchList .search-hit').length }));
  await page.evaluate(() => document.querySelector('#searchList .search-hit').click());
  await sleep(600);
  s.afterPlay = await page.evaluate(() => ({
    playing: document.getElementById('player').getAttribute('data-playing'),
    title: document.getElementById('trackTitle').textContent,
    recentTab: Array.prototype.some.call(document.querySelectorAll('#listTabs .list-tab'), (e) => e.getAttribute('data-list') === 'recent')
  }));
  assert('search-hit-plays-directly',
    s.playHit.hits === 1 && s.afterPlay.playing === '1' && s.afterPlay.title === '点播命中曲' && s.afterPlay.recentTab === true,
    JSON.stringify({ playHit: s.playHit, afterPlay: s.afterPlay }));
  // 播放 ≠ 喜欢：点行播放不点亮红心（罐头拍板：播放就是播放，不一定喜欢）
  s.playNotLike = await page.evaluate(() => ({
    favOn: !!document.querySelector('#searchList .search-fav.is-on')
  }));
  assert('play-does-not-fav',
    s.playNotLike.favOn === false,
    JSON.stringify(s.playNotLike));
  // 切到最近播放：刚才点播的那首应在里面
  await clickTab(page, 'recent');
  await sleep(300);
  s.recentList = await page.evaluate(() => ({
    count: document.querySelectorAll('#queueList .q-row').length,
    hasPlayed: Array.prototype.some.call(document.querySelectorAll('#queueList .q-title'), (e) => e.textContent === '点播命中曲')
  }));
  assert('recent-list-records-played',
    s.recentList.count >= 1 && s.recentList.hasPlayed === true,
    JSON.stringify(s.recentList));

  // Esc 关闭搜索页（退场动画 290ms 后才 hidden）
  await page.keyboard.press('Escape');
  await sleep(420);
  s.closed = await page.evaluate(() => window.__playerDebug.searchState().open);
  assert('search-page-esc-closes', s.closed === false, String(s.closed));

  // 入口按钮 toggle：点一下开、再点一下关（与队列抽屉同一交互）
  await page.evaluate(() => document.getElementById('searchEntryBtn').click());
  await sleep(360);
  s.toggleOpen = await page.evaluate(() => window.__playerDebug.searchState().open);
  await page.evaluate(() => document.getElementById('searchEntryBtn').click());
  await sleep(420);
  s.toggleClosed = await page.evaluate(() => window.__playerDebug.searchState().open);
  assert('search-entry-toggles',
    s.toggleOpen === true && s.toggleClosed === false,
    JSON.stringify({ open: s.toggleOpen, closed: s.toggleClosed }));

  // 搜歌手 / 搜歌曲：范围切换按钮存在且能切（后台同一关键词接口，侧重不同）
  await page.evaluate(() => { window.__playerDebug.renderDiscover({ hot: [], charts: [], sheets: [], radios: [] }); window.__playerDebug.openSearch(); });
  await sleep(150);
  s.scopeButtons = await page.evaluate(() => Array.from(document.querySelectorAll('#searchScope .search-scope-btn')).map((b) => b.getAttribute('data-scope')));
  await page.evaluate(() => document.querySelector('#searchScope .search-scope-btn[data-scope="artist"]').click());
  await sleep(120);
  s.scopeAfter = await page.evaluate(() => window.__playerDebug.searchState().scope);
  assert('search-scope-song-and-artist',
    s.scopeButtons.join(',') === 'song,artist' && s.scopeAfter === 'artist',
    JSON.stringify({ buttons: s.scopeButtons, after: s.scopeAfter }));

  // 推荐区：清空关键词/重开搜索时展示热门 + 榜单 + 电台三块
  await page.evaluate(() => {
    window.__playerDebug.renderDiscover({
      hot: [{ id: 'netease:780001', title: '热门推荐 1', author: '推荐歌手 1', url: '/api/apps/hanako-audio-player/routes/widget/api/music/go/780001?server=netease', pic: '' }],
      charts: [{ id: '3778678', name: '热歌榜', pic: '', note: '每天更新' }],
      sheets: [{ id: '8904187604', name: '超火rap', pic: '', note: '109 首' }],
      radios: [{ id: '1230174483', name: '你，静不下来', pic: '', category: '情感', programCount: 73 }]
    });
    window.__playerDebug.openSearch();
    window.__playerDebug.clearSearch();
  });
  await sleep(500);
  s.discover = await page.evaluate(() => ({
    discoverVisible: window.__playerDebug.searchState().discoverVisible,
    hotRows: document.querySelectorAll('#hotList .search-row').length,
    hotFirst: (document.querySelector('#hotList .q-title') || {}).textContent || '',
    chartCards: document.querySelectorAll('#chartsGrid .discover-card').length,
    chartFirst: (document.querySelector('#chartsGrid .discover-card-name') || {}).textContent || '',
    radioCards: document.querySelectorAll('#radiosGrid .discover-card').length,
    radioFirst: (document.querySelector('#radiosGrid .discover-card-name') || {}).textContent || ''
  }));
  assert('search-discover-three-blocks',
    s.discover.discoverVisible === true && s.discover.hotRows === 1 && s.discover.hotFirst === '热门推荐 1' &&
    s.discover.chartCards === 2 && s.discover.chartFirst === '热歌榜' &&
    s.discover.radioCards === 1 && s.discover.radioFirst === '你，静不下来',
    JSON.stringify(s.discover));
  await page.screenshot({ path: path.join(outDir, 'search-discover-1040x780-light.png') });

  // 点一张榜单 → 拉曲目进结果区（推荐区隐去）
  await page.evaluate(() => document.querySelector('#chartsGrid .discover-card').click());
  await sleep(400);
  s.chartOpen = await page.evaluate(() => ({
    rows: document.querySelectorAll('#searchList .search-row').length,
    discoverVisible: window.__playerDebug.searchState().discoverVisible,
    first: (document.querySelector('#searchList .q-title') || {}).textContent || ''
  }));
  assert('search-chart-opens-tracks',
    s.chartOpen.rows === 2 && s.chartOpen.discoverVisible === false && s.chartOpen.first === '榜单曲 1',
    JSON.stringify(s.chartOpen));

  // 「返回」分层退：详情层 → 推荐区（不关搜索）→ 再按才退出搜索（罐头拍板）
  await page.evaluate(() => document.getElementById('searchBackBtn').click());
  await sleep(250);
  s.back1 = await page.evaluate(() => ({ open: window.__playerDebug.searchState().open, discover: window.__playerDebug.searchState().discoverVisible, label: (document.querySelector('#searchBackBtn span') || {}).textContent }));
  await page.evaluate(() => document.getElementById('searchBackBtn').click());
  await sleep(420);
  s.back2 = await page.evaluate(() => window.__playerDebug.searchState().open);
  assert('search-back-layered',
    s.back1.open === true && s.back1.discover === true && s.back2 === false,
    JSON.stringify({ back1: s.back1, back2: s.back2 }));

  // 点一档电台 → 拉节目进结果区（每期是可播长音频）
  await page.evaluate(() => { window.__playerDebug.clearSearch(); });
  await sleep(400);
  await page.evaluate(() => document.querySelector('#radiosGrid .discover-card').click());
  await sleep(400);
  s.radioOpen = await page.evaluate(() => ({
    rows: document.querySelectorAll('#searchList .search-row').length,
    first: (document.querySelector('#searchList .q-title') || {}).textContent || ''
  }));
  assert('search-radio-opens-programs',
    s.radioOpen.rows === 2 && s.radioOpen.first === '电台节目 1',
    JSON.stringify(s.radioOpen));

  report.search = s;
  await page.close();
}

/* ============ 3) 精修矩阵：312 / 465 / 1040 × 浅深 × 歌词开/关 ============ */
/* 先复位夹具：上一段接线冒烟改过歌单（删了 imp:1）也留了播放态；不复位这里
 * 拍到的就是那个残局（无封面的歌单曲目），看不出封面/环境色的真实效果。 */
await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
const REFINE_CASES = [
  ['312x494', 312, 494, 'index.html'],
  ['465x930', 465, 930, 'index.html'],
  ['1040x780', 1040, 780, 'standalone.html']
];
const accentByTheme = {};
for (const [name, w, h, file] of REFINE_CASES) {
  for (const theme of ['light', 'dark']) {
    /* 歌词开/关这条轴已不存（歌词随歌曲有无自动切换），改成
     * 「有词曲目 / 无词曲目」两种内容，尺寸 × 主题 × 内容 = 12 张。 */
    for (const lyricsOn of [true, false]) {
      const page = await newPage();
      await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
      await page.goto(`${BASE}/${file}?assert=1&shot=1&appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
      await page.evaluate((t) => window.__fixtureTheme(t), theme);
      // 切到歌单 1，按本档需要选「有词」或「无词」曲目
      await clickTab(page, 'imp:1');
      for (let _w = 0; _w < 20 && (await page.$$eval('#queueList .q-row', (e) => e.length)) === 0; _w++) await sleep(100);
      await sleep(200);
      await page.evaluate((wantLyrics) => {
        const rows = [...document.querySelectorAll('#queueList .q-row')];
        if (wantLyrics) {
          const t = rows.find((r) => r.querySelector('.q-title').textContent.startsWith('在线曲目')) || rows[0];
          if (t) t.querySelector('.q-hit').click();
        } else {
          const t = rows.find((r) => r.querySelector('.q-title').textContent.startsWith('无词纯音乐'));
          if (t) t.querySelector('.q-hit').click();
        }
      }, lyricsOn);
      await sleep(950);
      const shotName = `refine-${name}-${theme}-lyrics-${lyricsOn ? 'on' : 'off'}.png`;
      await page.screenshot({ path: path.join(outDir, shotName) });
      report.refine.push(shotName);

      // 有词 → 歌词层；无词 → 只剩封面 + 涟漪（涟漪常驻）。两种下蒙层/渐变都要在线。
      const swap = await page.evaluate(() => {
        const cs = (id) => getComputedStyle(document.getElementById(id)).display;
        return { wrap: cs('lyricWrap'), scrim: cs('lyricScrim'), has: document.getElementById('player').getAttribute('data-haslyrics') };
      });
      const swapOk = lyricsOn
        ? (swap.wrap !== 'none' && swap.scrim !== 'none' && swap.has === '1')
        : (swap.wrap === 'none' && swap.scrim !== 'none' && swap.has === '0');
      assert(`lyrics-crossfade:${shotName}`, swapOk, JSON.stringify(swap));

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

/* ============ 3b) 环境色：封面右缘取色 → 竖向渐变铺满 + 歌词薄纱可读性 ============
   ① 渐变确实写进 --ambient-gradient；② 深底封面选深纱（首段近深色）且歌词
   对比度够；③ .stage-ambient 铺满 scene 且不是 --hk-surface 单色；
   ④ 无封面 / 取色失败（getImageData 抛 SecurityError）优雅退回；
   ⑤ 封面右缘 mask 淡出；⑥ 歌词薄纱只罩阅读列，R4 语义保留。
   对比度用 :root 的 --veil-* 独立算一遍（不是读 app 的内部状态）：
   字色先按自身 alpha 合成到薄纱上，再与薄纱后的背景算 WCAG 比。
   阈值：中部（歌词真正落的那段）≥ 4.5；最差段位（极端封面）≥ 3.0（大字）。 */
/* 背景已从「采样渐变」改为「封面模糊铺底」：
   - 底图 = .cover-haze（封面模糊放大，常驻）；取色只用来定字色极性 data-ambient。
   - 采样只用于对比度闸门；这里独立算：拖当前封面到 canvas，取「屏上可见带」均色
     作为背景基色（模糊保持均色不变，所以均色是可信近似），再合成纱 → 与字色算 WCAG 比。
   断言：底图存在且带封面 url、不是 12 段纯色渐变（防回退）、无封面/取色失败优雅退回。 */
const AMBIENT_PROBE = async () => {
  const player = document.getElementById('player');
  const scene = document.getElementById('scene');
  const ambient = document.getElementById('stageAmbient');
  const haze = document.getElementById('coverHaze');
  const scrim = document.getElementById('lyricScrim');
  const cover = document.getElementById('cover');
  const pcs = getComputedStyle(player);
  const hex = (s) => { const m = /^#([0-9a-f]{6})$/i.exec(String(s || '').trim()); if (!m) return null; const v = parseInt(m[1], 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  const over = (fg, bg, a) => [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)];
  const rs = getComputedStyle(document.documentElement);
  const pol = player.getAttribute('data-ambient');
  const veil = pol === 'dark' ? hex(rs.getPropertyValue('--veil-ink')) : hex(rs.getPropertyValue('--veil-paper'));
  const va = parseFloat(pol === 'dark' ? rs.getPropertyValue('--veil-ink-a') : rs.getPropertyValue('--veil-paper-a'));
  const textRGB = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const s = getComputedStyle(el).color;
    let m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+))?\)/.exec(s);
    if (m) return { rgb: [+m[1], +m[2], +m[3]], a: m[4] === undefined ? 1 : +m[4], raw: s };
    m = /color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/.exec(s);
    if (m) return { rgb: [+m[1] * 255, +m[2] * 255, +m[3] * 255], a: m[4] === undefined ? 1 : +m[4], raw: s };
    return null;
  };

  // 背景 = 封面主色调平色（--ambient-color），不再要 canvas 重算
  const ambColor = (() => {
    const s = pcs.getPropertyValue('--ambient-color').trim();
    const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(s);
    return m ? [+m[1], +m[2], +m[3]] : null;
  })();
  const coverHasUrl = /url\(/.test(pcs.getPropertyValue('--cover-image') || '') || /url\(/.test(getComputedStyle(cover).backgroundImage || '');

  const contrastAt = (sel, base) => {
    const t = textRGB(sel);
    if (!t || !base || !veil) return null;
    const bg = over(veil, base, va);
    return +ratio(over(t.rgb, bg, t.a), bg).toFixed(2);
  };

  const sb = scene.getBoundingClientRect();
  const ab = ambient.getBoundingClientRect();
  const cb = scrim.getBoundingClientRect();
  return {
    polarity: pol,
    ambientOk: player.classList.contains('ambient-ok'),
    nocover: player.classList.contains('nocover'),
    ambientColor: ambColor,
    scene: [Math.round(sb.width), Math.round(sb.height)],
    ambient: [Math.round(ab.width), Math.round(ab.height)],
    coverHasUrl,
    scrim: getComputedStyle(scrim).display,
    scrimTop: Math.round(cb.top - sb.top),
    scrimLeft: Math.round(cb.left - sb.left),
    contentX: Math.round(parseFloat(pcs.getPropertyValue('--content-x')) || 0),
    lyricTop: Math.round(parseFloat(pcs.getPropertyValue('--lyric-top')) || 0),
    coverW: pcs.getPropertyValue('--cover-w').trim(),
    coverBox: (() => { const r = cover.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })(),
    /* 封面三边锚定：left/top/bottom 都贴 scene 边（允许宽出被裁） */
    coverAnchored: (() => {
      const r = cover.getBoundingClientRect();
      return Math.abs(r.left - sb.left) <= 1 && Math.abs(r.top - sb.top) <= 1 && Math.abs(r.bottom - sb.bottom) <= 1;
    })(),
    seam: pcs.getPropertyValue('--seam').trim(),
    band: pcs.getPropertyValue('--band').trim(),
    /* 舞台底部渐隐已撤（2026-10-09 罐头拍板）：.scene::after 不该再生成 —— 底边硬切到控制条，
     * 全屏只留歌词那侧往左的淡入（.lyric-scrim）。这里做反断言，防回归。 */
    bottomFade: (() => {
      const cs = getComputedStyle(scene, '::after');
      return { content: cs.content, bg: (cs.backgroundImage || 'none').slice(0, 60) };
    })(),
    surfaceRGB: hex(rs.getPropertyValue('--hk-surface')),
    /* .frame 的背景色 = 圆角处露出来的颜色（.player 满铺盖住其余部分）——
     * 必须是卡面色 --hk-surface，不能是页面色 --hk-bg。 */
    frameBg: (() => {
      const m = /rgb\((\d+),\s*(\d+),\s*(\d+)\)/.exec(getComputedStyle(document.querySelector('.frame')).backgroundColor || '');
      return m ? [+m[1], +m[2], +m[3]] : null;
    })(),
    /* 顶部圆角：卡片壳自己补（宿主只在独立窗里裁）。顺手把 data-shell 切成 window 再读一次，
     * 不用额外开页（开页会写 playback-state，撞后面的生命周期用例）。 */
    corners: (() => {
      const read = () => {
        const cs = getComputedStyle(player);
        return { tl: parseFloat(cs.borderTopLeftRadius) || 0, bl: parseFloat(cs.borderBottomLeftRadius) || 0 };
      };
      const card = read();
      document.body.setAttribute('data-shell', 'window');
      const win = read();
      document.body.setAttribute('data-shell', 'card');
      return { card, win };
    })(),
    coverMask: (getComputedStyle(cover).maskImage || getComputedStyle(cover).webkitMaskImage || '').slice(0, 120),
    scrimMask: (getComputedStyle(scrim).maskImage || getComputedStyle(scrim).webkitMaskImage || '').slice(0, 120),
    lyricsTextAlign: getComputedStyle(document.getElementById('lyrics')).textAlign,
    contrastMid: { current: contrastAt('.lyric-line.is-current', ambColor), near: contrastAt('.lyric-line.is-near', ambColor) },
    contrastWorst: { current: contrastAt('.lyric-line.is-current', ambColor), near: contrastAt('.lyric-line.is-near', ambColor) },
    textColor: { current: (textRGB('.lyric-line.is-current') || {}).raw || null, near: (textRGB('.lyric-line.is-near') || {}).raw || null }
  };
};
let ambient = {};
{
  /* 先复位夹具：上一段接线冒烟删过歌单、也留了播放态，不复位 imp:1 就不在了 */
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/index.html?assert=1&shot=1&appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await clickTab(page, 'imp:1');
  await sleep(250);
  const playRow = (i) => page.evaluate((idx) => {
    document.querySelectorAll('#queueList .q-row')[idx].querySelector('.q-hit').click();
  }, i);

  // ① 真·浅底封面（整张浅）→ 浅纱 + 墨字
  await playRow(4);
  await sleep(950);
  ambient.light = await page.evaluate(AMBIENT_PROBE);
  await page.screenshot({ path: path.join(outDir, 'ambient-light-465x930.png') });

  // ①b 方形封面（可见段上浅下深）→ 不论择哪态纱，字必须可读（对比度断言）
  await playRow(0);
  await sleep(950);
  ambient.mixed = await page.evaluate(AMBIENT_PROBE);
  await page.screenshot({ path: path.join(outDir, 'ambient-mixed-465x930.png') });

  // ② 深底封面 → 深纱 + 纸字
  await playRow(2);
  await sleep(950);
  ambient.dark = await page.evaluate(AMBIENT_PROBE);
  await page.screenshot({ path: path.join(outDir, 'ambient-dark-465x930.png') });

  // ③ 无封面曲目 → 退回纸面兜底
  await playRow(3);
  await sleep(800);
  ambient.nocover = await page.evaluate(AMBIENT_PROBE);
  await page.screenshot({ path: path.join(outDir, 'ambient-nocover-465x930.png') });

  // ④ 取色失败：getImageData 抛 SecurityError（模拟非 CORS 封面 / 解码失败）
  await page.evaluate(() => {
    const orig = CanvasRenderingContext2D.prototype.getImageData;
    CanvasRenderingContext2D.prototype.getImageData = function () {
      if (window.__ambientFail) throw new DOMException('tainted canvas', 'SecurityError');
      return orig.apply(this, arguments);
    };
    window.__ambientFail = true;
  });
  await playRow(1);   // 横幅封面：本页还没取过色 → 触发一次失败
  await sleep(950);
  ambient.fail = await page.evaluate(AMBIENT_PROBE);
  await page.screenshot({ path: path.join(outDir, 'ambient-fail-465x930.png') });

  assert('ambient-dominant-color-applied:light',
    ambient.light.ambientOk === true && !!ambient.light.ambientColor &&
    (ambient.light.ambientColor[0] + ambient.light.ambientColor[1] + ambient.light.ambientColor[2]) > 0,
    JSON.stringify({ ok: ambient.light.ambientOk, c: ambient.light.ambientColor }));
  /* 主色底不能用「12 段纯色渐变」/模糊照片（那会出硬色阶·橙色团）—— 背景是平色。 */
  assert('backdrop-is-flat-color-not-banded',
    ambient.light.ambientOk === true && ambient.dark.ambientOk === true && !!ambient.dark.ambientColor,
    JSON.stringify({ lg: ambient.light.ambientColor, dg: ambient.dark.ambientColor }));
  /* 歌词列左对齐（与歌名同一条竖线） */
  assert('lyrics-left-aligned',
    ambient.light.lyricsTextAlign === 'left',
    ambient.light.lyricsTextAlign);
  /* 方形封面的可见段上浅下深 —— 不绑死在某一极性上（算法按对比度择优）。
   * 真正要保的是「不论选哪态纱，字都可读」。 */
  assert('ambient-mixed-picks-readable',
    ambient.mixed.ambientOk === true && ambient.mixed.contrastMid.current >= 3.0 &&
    ambient.mixed.contrastWorst.current >= 3.0,
    JSON.stringify({ p: ambient.mixed.polarity, mid: ambient.mixed.contrastMid, worst: ambient.mixed.contrastWorst }));
  assert('ambient-dark-color-applied',
    ambient.dark.ambientOk === true && ambient.dark.polarity === 'dark',
    JSON.stringify({ p: ambient.dark.polarity, ok: ambient.dark.ambientOk }));
  /* 舞台底部不再有渐隐（2026-10-09 罐头拍板）：曾有一条 .scene::after 把封面底缘「化」进
   * 环境色（吃 --ambient-color），现已撤掉 —— 底边直接硬切到控制条，全屏只留歌词那侧往左的
   * 淡入（.lyric-scrim）。反断言：::after 不该生成。 */
  assert('bottom-fade-removed',
    ambient.dark.bottomFade.content === 'none' && ambient.dark.bottomFade.bg === 'none',
    JSON.stringify(ambient.dark.bottomFade));

  /* 顶部圆角（2026-10-09）：宿主只在独立窗/浏览器视图里把 App 面裁圆，聊天卡片里不裁 ——
   * App 自己补上，固定 14px（宿主不转发 --radius-chat-surface；只转发 8/6px 那两个，
   * 比卡片容器那道弧小一半，真机上判为粗糙）。断言：两壳上两角都是这一档、下两角仍直角。
   * 另断言角上露出的颜色 = 卡面色（--hk-surface），不是页面色。 */
  assert('top-corners-rounded',
    ambient.dark.corners.card.tl >= 14 && ambient.dark.corners.card.bl === 0 &&
    ambient.dark.corners.win.tl >= 14,
    JSON.stringify(ambient.dark.corners));
  assert('corner-reveals-card-surface',
    Array.isArray(ambient.dark.frameBg) && Array.isArray(ambient.dark.surfaceRGB) &&
    ambient.dark.frameBg.every((v, i) => Math.abs(v - ambient.dark.surfaceRGB[i]) <= 2),
    JSON.stringify({ frameBg: ambient.dark.frameBg, surface: ambient.dark.surfaceRGB }));
  assert('ambient-fills-scene',
    ambient.dark.ambient[0] === ambient.dark.scene[0] && ambient.dark.ambient[1] === ambient.dark.scene[1],
    JSON.stringify({ a: ambient.dark.ambient, s: ambient.dark.scene }));
  assert('ambient-dark-lyric-readable',
    ambient.dark.contrastMid.current >= 4.5 && ambient.dark.contrastMid.near >= 4.5,
    JSON.stringify({ mid: ambient.dark.contrastMid }));
  assert('ambient-light-lyric-readable',
    ambient.light.contrastMid.current >= 4.5 && ambient.light.contrastMid.near >= 4.5,
    JSON.stringify({ mid: ambient.light.contrastMid }));
  /* 封面锚定「左/上/下」三边（不管什么比例都是如此） */
  assert('cover-anchored-left-top-bottom',
    ambient.dark.coverAnchored === true,
    JSON.stringify({ anchored: ambient.dark.coverAnchored, box: ambient.dark.coverBox }));
  /* 封面 mask 两段式（实→虚，连续插值）。
   * 歌词遮罩：满屏固定（inset:0，不跟歌词列跑），只做横向淡入 ——
   * 从接缝 -band/2 透明、+band/2 满。两条都是「只给两端点」的连续插值。 */
  const band = parseFloat(ambient.dark.band) || 0;
  const coverM = /linear-gradient/.test(ambient.dark.coverMask);
  const coverTwoStop = (ambient.dark.coverMask.match(/(?:px|%)/g) || []).length >= 2;
  assert('cover-mask-two-stop-continuous',
    coverM && coverTwoStop && band > 0 && band < 320,
    JSON.stringify({ band, cm: ambient.dark.coverMask.slice(0, 80) }));
  /* 歌词遮罩：满屏固定（左/上贴 0），且 mask 从接缝淡入（linear-gradient 两端点） */
  const scrimFade = ambient.dark.scrimMask;
  assert('lyric-scrim-fixed-full-bleed-fade',
    ambient.dark.scrim !== 'none' &&
    ambient.dark.scrimLeft === 0 && ambient.dark.scrimTop === 0 &&
    /linear-gradient/.test(scrimFade) &&
    (scrimFade.match(/(?:px|%)/g) || []).length >= 2,
    JSON.stringify({ scrimLeft: ambient.dark.scrimLeft, scrimTop: ambient.dark.scrimTop, sm: scrimFade.slice(0, 90) }));
  /* 遮罩「满罩点」必须落在歌词列起点 --content-x 上（不再锚接缝）——
   * 歌词永远在满罩区，列随面板移动也跟得住。 */
  const scrimx = [...scrimFade.matchAll(/(-?[\d.]+)px/g)].map((m) => parseFloat(m[1]));
  const scrimOpaqueAt = scrimx.length ? scrimx[scrimx.length - 1] : null;
  assert('lyric-scrim-opaque-at-column-start',
    scrimOpaqueAt !== null && Math.abs(scrimOpaqueAt - ambient.dark.contentX) <= 2,
    JSON.stringify({ contentX: ambient.dark.contentX, scrimOpaqueAt, sm: scrimFade.slice(0, 90) }));
  assert('ambient-nocover-fallback',
    ambient.nocover.nocover === true && ambient.nocover.polarity === 'none' && ambient.nocover.ambientColor === null,
    JSON.stringify({ nocover: ambient.nocover.nocover, p: ambient.nocover.polarity, c: ambient.nocover.ambientColor }));
  /* 取色失败：背景退回主题纸面（无 --ambient-color），字仍可读，不白屏 */
  assert('ambient-extract-failure-graceful',
    ambient.fail.ambientColor === null && ambient.fail.ambient[0] > 0 && ambient.fail.ambient[1] > 0,
    JSON.stringify({ c: ambient.fail.ambientColor, a: ambient.fail.ambient }));

  report.ambient = ambient;
  await page.close();
}

/* 深色封面截图：312 / 465 / 1040 × 浅深 + 歌词关（频谱压在薄纱上，R4） */
for (const [name, w, h, file] of [['312x494', 312, 494, 'index.html'], ['465x930', 465, 930, 'index.html'], ['1040x780', 1040, 780, 'standalone.html']]) {
  for (const theme of ['light', 'dark']) {
    const page = await newPage();
    await page.setViewport({ width: w, height: h, deviceScaleFactor: 1 });
    await page.goto(`${BASE}/${file}?assert=1&shot=1&appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
    await page.evaluate((t) => window.__fixtureTheme(t), theme);
    await clickTab(page, 'imp:1');
    await sleep(220);
    await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[2].querySelector('.q-hit').click());
    await sleep(950);
    const shotName = `ambient-dark-${name}-${theme}.png`;
    await page.screenshot({ path: path.join(outDir, shotName) });
    report.refine.push(shotName);
    await page.close();
  }
}
{
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/index.html?assert=1&shot=1&appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await clickTab(page, 'imp:1');
  await sleep(220);
  // 无词曲目（现在配深色封面）：频谱接管歌词层，蒙层必须保持在线
  await page.evaluate(() => {
    const rows = [...document.querySelectorAll('#queueList .q-row')];
    const t = rows.find((r) => r.querySelector('.q-title').textContent.startsWith('无词纯音乐'));
    if (t) t.querySelector('.q-hit').click();
  });
  await sleep(950);
  const off = await page.evaluate(AMBIENT_PROBE);
  assert('ambient-dark-nolyrics-scrim-stays',
    off.scrim !== 'none' && off.ambientOk === true && off.polarity === 'dark',
    JSON.stringify({ scrim: off.scrim, ok: off.ambientOk, p: off.polarity }));
  await page.screenshot({ path: path.join(outDir, 'ambient-dark-465x930-nolyrics.png') });
  await page.close();
}

/* ============ 4) 主题双保险（R5 + macOS 夜间模式） ============
   优先级断言：宿主显式注入 > @media prefers-color-scheme 兑底 > 写死默认 */
{
  // (a) hana-css 初始注入：SDK 初始不拉样式表，App 自己补拉
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  const cssUrl = '/api/apps/theme.css?theme=hostfix';
  await page.goto(`${BASE}/index.html?appSurfaceSession=fake-ticket&shot=1&hana-theme=hostfix&hana-css=${encodeURIComponent(cssUrl)}`, { waitUntil: 'domcontentloaded' });
  await sleep(500);
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
  await sleep(500);
  const lightVals = await page.evaluate(() => ({
    accent: getComputedStyle(document.getElementById('playBtn')).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor
  }));
  await page.screenshot({ path: path.join(outDir, 'theme-palette-macos-light.png') });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'dark' }]);
  await sleep(300);
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
  await sleep(500);
  const darkVals = await page.evaluate(() => ({
    accent: getComputedStyle(document.getElementById('playBtn')).backgroundColor,
    body: getComputedStyle(document.body).backgroundColor
  }));
  await page.screenshot({ path: path.join(outDir, 'theme-fallback-dark.png') });
  await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
  await sleep(300);
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
  await sleep(500);
  const vals = await page.evaluate(() => ({ body: getComputedStyle(document.body).backgroundColor }));
  await page.screenshot({ path: path.join(outDir, 'theme-host-wins-over-dark.png') });
  assert('host-theme-wins-over-prefers', vals.body === 'rgb(17, 34, 51)', JSON.stringify(vals));
  await page.close();
}

/* ============ 5) 夜间兜底：宿主没注入主题时跟随 prefers-color-scheme ============ */
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

/* ============ 6) 旧数据迁移：无 list 字段 → 本地 + 按 group 分导入列表（幂等） ============ */
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

/* ============ 7) 拖拽生命周期：pagehide 落盘 → reload 恢复 + 续播 ============ */
let lifecycle = {};
{
  await fetch(`${BASE}${API}/__fixture/reset?mode=main&appSurfaceSession=fake-ticket`);
  const page = await newPage();
  await page.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await page.goto(`${BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await sleep(800);

  // 切到歌单 1，播第一首，等它播到 > 0s
  await clickTab(page, 'imp:1');
  await sleep(200);
  await page.evaluate(() => document.querySelectorAll('#queueList .q-row')[0].querySelector('.q-hit').click());
  await sleep(1200);
  const before = await page.evaluate(() => ({
    playing: document.getElementById('player').getAttribute('data-playing'),
    title: document.getElementById('trackTitle').textContent,
    cur: document.getElementById('audio').currentTime
  }));

  // 模拟卸载：pagehide（拖进/拖出 = 整份文档被换掉）。
  // sendBeacon 是异步投递，轮询等它落到后端。
  await page.evaluate(() => window.dispatchEvent(new Event('pagehide')));
  let saved = null;
  for (let i = 0; i < 25; i++) {
    const r = await (await fetch(`${BASE}${API}/api/playback-state?appSurfaceSession=fake-ticket`)).json();
    saved = r;
    if (r.state && r.state.playing === true && r.state.progress >= before.cur - 0.3) break;
    await sleep(100);
  }

  // 新文档：reload（模拟拖出后新 iframe 从零 rehydrate）
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.evaluate((t) => window.__fixtureTheme(t), 'light');
  await sleep(1000);
  const after = await page.evaluate(() => ({
    playing: document.getElementById('player').getAttribute('data-playing'),
    title: document.getElementById('trackTitle').textContent,
    cur: document.getElementById('audio').currentTime,
    activeList: document.querySelector('#listTabs .list-tab.is-active').getAttribute('data-list'),
    resumeHidden: document.getElementById('resumeBtn').hidden
  }));
  lifecycle.crossDocument = { before, saved: saved && saved.state, after };
  lifecycle.crossOk =
    before.playing === '1' && before.cur > 0 &&
    !!saved && !!saved.state && saved.state.playing === true &&
    saved.state.currentId === 'imp:1|netease:900000' && saved.state.progress > 0 &&
    after.playing === '1' && after.title === '在线曲目 1' && after.activeList === 'imp:1' &&
    after.cur >= saved.state.progress - 0.35;

  // 关掉旧文档（它的 pagehide 会再落一次盘），等它落完再播种一个进度=12s 的快照
  await page.close();
  await sleep(500);

  // 自动播放被拦：保留进度 + 「继续播放」引导（不归零）
  const seed = { currentId: 'imp:1|netease:900000', activeList: 'imp:1', progress: 12, volume: 0.8, muted: false, mode: 'list', lyricsVisible: true, playing: true };
  for (let i = 0; i < 4; i++) {
    await fetch(`${BASE}${API}/api/playback-state?appSurfaceSession=fake-ticket`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(seed)
    });
    await sleep(150);
    const chk = await (await fetch(`${BASE}${API}/api/playback-state?appSurfaceSession=fake-ticket`)).json();
    if (chk.state && chk.state.progress === 12) break;
  }
  const blocked = await newPage();
  await blocked.setViewport({ width: 465, height: 930, deviceScaleFactor: 1 });
  await blocked.evaluateOnNewDocument(() => {
    HTMLMediaElement.prototype.play = function () {
      return Promise.reject(Object.assign(new Error('blocked'), { name: 'NotAllowedError' }));
    };
  });
  await blocked.goto(`${BASE}/index.html?appSurfaceSession=fake-ticket`, { waitUntil: 'domcontentloaded' });
  await blocked.evaluate((t) => window.__fixtureTheme(t), 'light');
  await sleep(900);
  const blockedState = await blocked.evaluate(() => ({
    resumeShown: !document.getElementById('resumeBtn').hidden,
    curTime: document.getElementById('curTime').textContent,
    seekVal: document.getElementById('seek').value,
    playing: document.getElementById('player').getAttribute('data-playing'),
    title: document.getElementById('trackTitle').textContent
  }));
  lifecycle.autoplayBlocked = blockedState;
  lifecycle.blockedOk =
    blockedState.resumeShown === true && blockedState.curTime === '0:12' &&
    blockedState.playing === '0' && blockedState.title === '在线曲目 1';
  await blocked.screenshot({ path: path.join(outDir, 'resume-chip-465x930-light.png') });
  await blocked.close();
  report.lifecycle = lifecycle;
}

await browser.close();
server.closeAllConnections();
server.close();

const failed = report.selfCheck.filter((c) => !c.passed);
const narrowFailed = report.narrowSelfCheck.filter((c) => !c.passed);
const assertFailed = report.assertions.filter((a) => !a.ok);
const realErrors = [...new Set(report.runtimeErrors)];
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
  report.wiring.rename && report.wiring.rename.hasInput === true &&
  report.wiring.rename.headerTitle === '我的歌单' && report.wiring.rename.tabTitle === '我的歌单' &&
  report.darkFallback.changed === true;
const migrationOk = report.migration && report.migration.idempotent === true &&
  report.migration.firstTabs.map((t) => t.label).join(',') === '我的喜欢,最近播放,本地,本地音乐,鸣潮,在线音乐,未分类' &&
  report.migration.firstCounts.per['fav'] === 0 &&
  report.migration.firstCounts.per['recent'] === 0 &&
  report.migration.firstCounts.per['local'] === 0 &&
  report.migration.firstCounts.per['imp:1'] === 3 &&
  report.migration.firstCounts.per['imp:2'] === 4 &&
  report.migration.firstCounts.per['imp:3'] === 3 &&
  report.migration.firstCounts.per['imp:4'] === 2;
const lifecycleOk = report.lifecycle && report.lifecycle.crossOk === true && report.lifecycle.blockedOk === true;

fs.writeFileSync(path.join(outDir, 'verify.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({
  selfCheckPassed: report.selfCheck.length - failed.length,
  selfCheckTotal: report.selfCheck.length,
  failedCases: failed.map((f) => ({ case: f.case, failed: f.failed.map((x) => x.name + ' | ' + x.detail) })),
  narrowSelfCheck: `${report.narrowSelfCheck.length - narrowFailed.length}/${report.narrowSelfCheck.length}`,
  narrowFailed: narrowFailed.map((f) => ({ case: f.case, failed: f.failed.map((x) => x.name + ' | ' + x.detail) })),
  assertions: `${report.assertions.length - assertFailed.length}/${report.assertions.length}`,
  failedAssertions: assertFailed,
  search: report.search,
  wiringOk,
  migrationOk,
  lifecycleOk,
  theme: report.theme,
  wiring: report.wiring,
  four: report.four,
  migration: report.migration,
  lifecycle: report.lifecycle,
  ambient: report.ambient,
  darkFallback: report.darkFallback,
  expectedProbes: [...new Set(report.expectedProbes)],
  runtimeErrors: realErrors.slice(0, 20),
  outDir
}, null, 2));
process.exit(failed.length || narrowFailed.length || assertFailed.length || !wiringOk || !migrationOk || !lifecycleOk || realErrors.length ? 1 : 0);
