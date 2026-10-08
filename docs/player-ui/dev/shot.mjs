#!/usr/bin/env node
/* ============================================================
   dev/shot.mjs — UI 原型自检（开发用，不属于交付界面）
   无第三方依赖：起系统 Chrome，走 CDP 精确设视口、跑断言、出截图。
   用法：node dev/shot.mjs [only=<尺寸串>]
   ============================================================ */
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SHOTS = resolve(ROOT, 'screenshots');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const PAGE = pathToFileURL(join(ROOT, 'index.html')).href;

const SIZES = [
  [465, 930],
  [585, 1172],
  [531, 451],
  [560, 616],
  [1040, 740],
];
const THEMES = ['light', 'dark'];
const LYRICS = ['1', '0'];

const EXTRA = [
  { name: 'extra-1040x740-light-drawer-open', w: 1040, h: 740, theme: 'light', q: 'lyrics=1&drawer=1' },
  { name: 'extra-531x451-dark-queue-page', w: 531, h: 451, theme: 'dark', q: 'lyrics=1&page=queue' },
  { name: 'extra-465x930-light-queue-bottom', w: 465, h: 930, theme: 'light', q: 'lyrics=1&queuepos=bottom' },
  { name: 'extra-585x1172-light-longtitle-nocover', w: 585, h: 1172, theme: 'light', q: 'lyrics=1&longtitle=1&nocover=1' },
  { name: 'extra-465x930-light-paused', w: 465, h: 930, theme: 'light', q: 'lyrics=0&paused=1' },
];

/* ---------------- 起 Chrome ---------------- */
const profile = join(ROOT, 'dev', '.chrome-profile');
rmSync(profile, { recursive: true, force: true });
mkdirSync(profile, { recursive: true });

const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--hide-scrollbars',
  '--no-first-run',
  '--no-default-browser-check',
  '--force-device-scale-factor=1',
  '--remote-debugging-port=0',
  '--user-data-dir=' + profile,
  'about:blank',
], { stdio: 'ignore' });

async function waitPort() {
  const f = join(profile, 'DevToolsActivePort');
  for (let i = 0; i < 200; i++) {
    if (existsSync(f)) {
      const txt = readFileSync(f, 'utf8').trim().split('\n');
      if (txt[0]) return parseInt(txt[0], 10);
    }
    await sleep(50);
  }
  throw new Error('Chrome 调试端口未就绪');
}
const port = await waitPort();

const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const pageTarget = targets.find((t) => t.type === 'page');
if (!pageTarget) throw new Error('没有 page target');

const ws = new WebSocket(pageTarget.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });

let seq = 0;
const pending = new Map();
const events = new Map();
ws.onmessage = (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    if (m.error) rej(new Error(m.error.message)); else res(m.result);
  } else if (m.method && events.has(m.method)) {
    events.get(m.method).forEach((fn) => fn(m.params));
  }
};
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
async function evalJs(expr, awaitPromise = false) {
  const r = await send('Runtime.evaluate', {
    expression: expr, returnByValue: true, awaitPromise,
  });
  if (r.exceptionDetails) throw new Error('页面脚本异常: ' + (r.exceptionDetails.text || ''));
  return r.result.value;
}

/* ---------------- 页面操作 ---------------- */
async function open(url, w, h) {
  await send('Emulation.setDeviceMetricsOverride', {
    width: w, height: h, deviceScaleFactor: 1, mobile: false,
    screenWidth: w, screenHeight: h,
  });
  await send('Page.navigate', { url });
  for (let i = 0; i < 240; i++) {
    const rs = await evalJs('document.readyState');
    if (rs === 'complete') break;
    await sleep(50);
  }
  await evalJs('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(()=>setTimeout(r,60))))', true);
}

async function shot(path) {
  const r = await send('Page.captureScreenshot', {
    format: 'png', fromSurface: true, captureBeyondViewport: false,
  });
  writeFileSync(path, Buffer.from(r.data, 'base64'));
}

async function click(x, y) {
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', buttons: 1, clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', buttons: 0, clickCount: 1 });
}
async function drag(x1, y1, x2, y2) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: x1, y: y1, button: 'left', buttons: 1, clickCount: 1 });
  for (let i = 1; i <= 6; i++) {
    await send('Input.dispatchMouseEvent', {
      type: 'mouseMoved', x: x1 + (x2 - x1) * i / 6, y: y1 + (y2 - y1) * i / 6, button: 'left', buttons: 1,
    });
  }
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: x2, y: y2, button: 'left', buttons: 0, clickCount: 1 });
}
const rectOf = (id) => evalJs(`(()=>{const r=document.getElementById('${id}').getBoundingClientRect();
  return JSON.stringify({x:r.left,y:r.top,w:r.width,h:r.height})})()`).then(JSON.parse);
const center = (r) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });
/* 输入事件派发是异步落到渲染进程的：发完必须等一拍再读状态 */
const settle = () => sleep(140);

/* ---------------- 跑起来 ---------------- */
mkdirSync(SHOTS, { recursive: true });
const only = (process.argv[2] || '').replace('only=', '');
const results = [];
let failures = 0;

function line(s) { process.stdout.write(s + '\n'); }

// 1) 核心矩阵：5 尺寸 × 浅深 × 歌词开/关
for (const [w, h] of SIZES) {
  const label = `${w}x${h}`;
  if (only && !label.includes(only)) continue;
  for (const theme of THEMES) {
    for (const ly of LYRICS) {
      const name = `${label}-${theme}-lyrics-${ly === '1' ? 'on' : 'off'}`;
      const url = `${PAGE}?shot=1&size=${label}&theme=${theme}&lyrics=${ly}`;
      await open(url, w, h);
      const rep = await evalJs('window.__playerSelfCheck && window.__playerSelfCheck()');
      await shot(join(SHOTS, name + '.png'));
      const bad = (rep?.checks || []).filter((c) => !c.ok);
      if (bad.length) failures += bad.length;
      results.push({ name, case: rep?.case, passed: rep?.passed, bad });
      line(`${rep?.passed ? '  OK  ' : ' FAIL '} ${name}` + (bad.length ? '  << ' + bad.map((c) => c.name).join(', ') : ''));
    }
  }
}

// 2) 补充状态：抽屉 / 矮卡队列页 / 队列滚到底 / 长标题+无封面
for (const ex of EXTRA) {
  if (only && !ex.name.includes(only)) continue;
  const url = `${PAGE}?shot=1&size=${ex.w}x${ex.h}&theme=${ex.theme}&${ex.q}`;
  await open(url, ex.w, ex.h);
  const rep = await evalJs('window.__playerSelfCheck && window.__playerSelfCheck()');
  await shot(join(SHOTS, ex.name + '.png'));
  const bad = (rep?.checks || []).filter((c) => !c.ok);
  if (bad.length) failures += bad.length;
  results.push({ name: ex.name, case: rep?.case, passed: rep?.passed, bad });
  line(`${rep?.passed ? '  OK  ' : ' FAIL '} ${ex.name}` + (bad.length ? '  << ' + bad.map((c) => c.name).join(', ') : ''));
}

// 3) 合成交互冒烟（三种布局各一遍）
for (const [w, h] of [[465, 930], [531, 451], [1040, 740]]) {
  const label = `${w}x${h}`;
  if (only && !label.includes(only)) continue;
  await open(`${PAGE}?selftest=1&size=${label}&theme=light&lyrics=1`, w, h);
  await evalJs('new Promise(r=>setTimeout(r,900))', true);
  const rep = await evalJs('document.getElementById("report").textContent');
  const parsed = JSON.parse(rep);
  const bad = parsed.tests.filter((t) => !t.ok);
  if (bad.length) failures += bad.length;
  line(`${parsed.passed ? '  OK  ' : ' FAIL '} self-test ${label}（${parsed.tests.length} 项）` +
    (bad.length ? '  << ' + bad.map((t) => t.name + ':' + t.detail).join(' | ') : ''));
  results.push({ name: `self-test-${label}`, passed: parsed.passed, bad });
}

// 4) 真实指针事件：拖进度、拖音量、点行、滚歌词
{
  const w = 465, h = 930;
  await open(`${PAGE}?shot=1&size=465x930&theme=light&lyrics=1`, w, h);
  const real = [];
  const t = (name, ok, detail) => { real.push({ name, ok, detail }); if (!ok) failures++; };

  // 拖进度条到 75%
  const seek = await rectOf('seek');
  const y1 = seek.y + seek.h / 2;
  await drag(seek.x + 4, y1, seek.x + seek.w * 0.75, y1);
  await settle();
  const seekVal = await evalJs('parseFloat(document.getElementById("seek").value)');
  const seekMax = await evalJs('parseFloat(document.getElementById("seek").max)');
  t('drag-seek', seekVal / seekMax > 0.6 && seekVal / seekMax < 0.85, `seek=${seekVal}/${seekMax}`);

  // 拖音量条（窄容器里滑杆收进宽窗，只有可见时才测）
  const vol = await rectOf('vol');
  if (vol && vol.w > 0) {
    const y2 = vol.y + vol.h / 2;
    await drag(vol.x + 2, y2, vol.x + vol.w * 0.25, y2);
    await settle();
    const volVal = await evalJs('parseInt(document.getElementById("vol").value,10)');
    t('drag-volume', volVal > 5 && volVal < 45, `vol=${volVal}`);
  } else {
    t('drag-volume', true, 'n/a（窄容器无滑杆）');
  }

  // 点播放键
  const before = await evalJs('document.getElementById("player").dataset.playing');
  const pb = center(await rectOf('playBtn'));
  await click(pb.x, pb.y);
  await settle();
  const after = await evalJs('document.getElementById("player").dataset.playing');
  t('click-play', before !== after, `playing ${before}->${after}`);
  await click(pb.x, pb.y);
  await settle();

  // 点第 3 行切歌
  const row3 = await evalJs(`(()=>{const r=document.querySelectorAll('.q-row')[2].getBoundingClientRect();
    return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()`).then(JSON.parse);
  await click(row3.x, row3.y);
  await settle();
  const curId = await evalJs('document.querySelector(".q-row.is-current").dataset.id');
  t('click-row', curId === 't03', `current=${curId}`);

  // 在歌词区滚轮 → 暂停跟随并出现按钮（先 mouseMoved 定位，否则滚轮会派发到上一次鼠标停留处）
  const lw = center(await rectOf('lyricWrap'));
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: lw.x, y: lw.y, buttons: 0 });
  await send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: lw.x, y: lw.y, deltaX: 0, deltaY: 120, buttons: 0 });
  await settle();
  const paused = await evalJs('!document.getElementById("lyricBack").hidden');
  t('wheel-pause-follow', paused, `backBtnHidden=${!paused}`);
  const bb = center(await rectOf('lyricBack'));
  await click(bb.x, bb.y);
  await settle();
  const resumed = await evalJs('document.getElementById("lyricBack").hidden');
  t('click-back-to-lyric', resumed, '');

  real.forEach((r) => line(`${r.ok ? '  OK  ' : ' FAIL '} real-input ${r.name} ${r.detail}`));
  results.push({ name: 'real-input', passed: real.every((r) => r.ok), bad: real.filter((r) => !r.ok) });
}

// 5) 预览开发工具条（只在预览存在，生产接线时删除）：尺寸/主题切换真的生效
{
  await open(PAGE + '?theme=light&lyrics=1', 1120, 1000); // 非 shot 模式：工具条可见
  const dev = [];
  const dt = (name, ok, detail) => { dev.push({ name, ok, detail }); if (!ok) failures++; };

  const devbarShown = await evalJs('getComputedStyle(document.getElementById("devbar")).display !== "none"');
  dt('devbar-visible', devbarShown, '');

  const sizeBtn = await evalJs(`(()=>{const r=document.querySelectorAll('#devSizes button')[1].getBoundingClientRect();
    return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()`).then(JSON.parse);
  await click(sizeBtn.x, sizeBtn.y);
  await settle();
  const fw = await evalJs('Math.round(document.getElementById("frame").getBoundingClientRect().width)');
  dt('devbar-size-switch', fw === 585, `frame.width=${fw}`);

  const themeBtn = await evalJs(`(()=>{const b=document.querySelectorAll('#devThemes button')[1];const r=b.getBoundingClientRect();
    return JSON.stringify({x:r.left+r.width/2,y:r.top+r.height/2})})()`).then(JSON.parse);
  await click(themeBtn.x, themeBtn.y);
  await settle();
  const th = await evalJs('document.documentElement.dataset.theme');
  dt('devbar-theme-switch', th === 'dark', `theme=${th}`);

  await shot(join(ROOT, 'dev', 'preview-toolbar-check.png'));
  dev.forEach((r) => line(`${r.ok ? '  OK  ' : ' FAIL '} devbar ${r.name} ${r.detail}`));
  results.push({ name: 'devbar', passed: dev.every((r) => r.ok), bad: dev.filter((r) => !r.ok) });
}

const reportPath = join(ROOT, 'dev', 'selfcheck-report.md');
const md = [
  '# 自检报告（dev/shot.mjs 生成）',
  '',
  `- 时间：${new Date().toISOString()}`,
  `- 截图：\`${SHOTS}\` 共 ${results.filter((r) => !r.name.startsWith('self-test') && r.name !== 'real-input').length} 张`,
  `- 结果：${failures === 0 ? '全部通过' : failures + ' 项未通过'}`,
  '',
  '| 用例 | 通过 | 未通过项 |',
  '| --- | --- | --- |',
  ...results.map((r) => `| ${r.name} | ${r.passed ? '是' : '否'} | ${(r.bad || []).map((b) => b.name + (b.detail ? '(' + b.detail + ')' : '')).join('<br>')} |`),
  '',
].join('\n');
writeFileSync(reportPath, md);

line('');
line(failures === 0 ? `全部通过。截图：${SHOTS}` : `有 ${failures} 项未通过，见 ${reportPath}`);

ws.close();
chrome.kill();
await sleep(300);
try { rmSync(profile, { recursive: true, force: true }); } catch { /* Chrome 收尾较慢，忽略 */ }
process.exit(failures === 0 ? 0 : 1);
