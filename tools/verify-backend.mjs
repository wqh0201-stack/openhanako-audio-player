#!/usr/bin/env node
/* ============================================================
   tools/verify-backend.mjs — 后端列表归属的单元验收（开发用）
   直接调用 registerRoutes 注册的处理函数，验证：
     · 去重键纳入 list：同一首歌进两个列表不被并成一条
     · 同一列表内仍按 id 去重
     · 老数据（无 id）回退到完整 url，同样按 list 分开
     · DELETE /api/track 带 list 只删该列表里的那一份
   用法：node tools/verify-backend.mjs
   ============================================================ */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { registerRoutes } from '../lib/register-routes.js';

const routes = [];
const app = {
  get: (p, h) => routes.push(['GET', p, h]),
  post: (p, h) => routes.push(['POST', p, h]),
  delete: (p, h) => routes.push(['DELETE', p, h])
};

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hap-be-'));
const ctx = { dataDir, logger: { warn() {}, info() {}, error() {} }, resources: {}, storage: { global: {} }, tools: {} };
registerRoutes(app, { ctx, state: {} });

const handler = (method, p) => {
  const hit = routes.find((r) => r[0] === method && r[1] === p);
  if (!hit) throw new Error(`route not found: ${method} ${p}`);
  return hit[2];
};
const POST_PLAYLIST = handler('POST', '/widget/api/playlist');
const DELETE_TRACK = handler('DELETE', '/api/track');

function fakeC({ json, query }) {
  return {
    req: {
      json: async () => json,
      query: (k) => (query && k in query ? query[k] : undefined),
      param: () => undefined,
      header: () => undefined
    },
    json: (o, s) => ({ status: s || 200, body: o }),
    text: (t, s) => ({ status: s || 200, text: t }),
    redirect: (u) => ({ status: 302, url: u })
  };
}
const playlistPath = path.join(dataDir, 'playlist.json');
const readDisk = () => JSON.parse(fs.readFileSync(playlistPath, 'utf-8'));

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail: String(detail === undefined ? '' : detail) });
}

/* 1) 同一首歌进两个列表：不能并 */
await POST_PLAYLIST(fakeC({ json: { tracks: [
  { id: 'netease:1', name: 'a', list: 'imp:1' },
  { id: 'netease:1', name: 'a', list: 'imp:2' }
] } }));
let disk = readDisk();
check('cross-list-kept', disk.length === 2, JSON.stringify(disk.map((t) => t.list)));

/* 2) 同一列表内同 id：仍要去重 */
await POST_PLAYLIST(fakeC({ json: { tracks: [
  { id: 'netease:1', name: 'a', list: 'imp:1' },
  { id: 'netease:1', name: 'b', list: 'imp:1' }
] } }));
disk = readDisk();
check('same-list-deduped', disk.length === 1, JSON.stringify(disk));

/* 3) 老数据（无 id）回退到完整 url，同样按 list 分开 */
await POST_PLAYLIST(fakeC({ json: { tracks: [
  { url: 'u1', name: 'x' },
  { url: 'u1', name: 'x', list: 'imp:2' }
] } }));
disk = readDisk();
check('legacy-url-by-list', disk.length === 2, JSON.stringify(disk.map((t) => t.list || '')));

/* 4) DELETE 带 list：只删该列表里的那一份 */
await POST_PLAYLIST(fakeC({ json: { tracks: [
  { id: 'netease:9', name: 's', list: 'imp:1' },
  { id: 'netease:9', name: 's', list: 'imp:2' }
] } }));
let res = await DELETE_TRACK(fakeC({ query: { id: 'netease:9', list: 'imp:1' } }));
disk = readDisk();
check('delete-with-list', res.body.ok === true && disk.length === 1 && disk[0].list === 'imp:2', JSON.stringify(disk));

/* 5) DELETE 不带 list：保持旧行为（按 id 全删） */
res = await DELETE_TRACK(fakeC({ query: { id: 'netease:9' } }));
disk = readDisk();
check('delete-without-list-legacy', res.body.ok === true && disk.length === 0, JSON.stringify(disk));

fs.rmSync(dataDir, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, total: results.length, failed, results }, null, 2));
process.exit(failed.length ? 1 : 0);
