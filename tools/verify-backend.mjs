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

/* 网络探针：playlist 路由会先问 Meting 节点拿曲目、再（仅 netease）问网易云官方
 * 拿歌单真名。这里把 ctx.network.fetch 换成可控的假实现，按 URL 分流，并记录调用。 */
let netCalls = [];
const netFetch = async (url) => {
  netCalls.push(url);
  if (url.includes('music.163.com/api/v6/playlist/detail')) {
    return {
      ok: true,
      json: async () => ({
        code: 200,
        playlist: { name: 'Can_0201喜欢的音乐', creator: { nickname: 'Can_0201' }, coverImgUrl: 'http://c/x.jpg', trackCount: 905 }
      })
    };
  }
  // Meting 节点：回一个最小可用的曲目数组
  return { ok: true, json: async () => ([{ id: '1', title: 't', author: 'a', url: 'http://node/1', pic: '', lrc: '' }]) };
};

const ctx = { dataDir, logger: { warn() {}, info() {}, error() {} }, resources: {}, storage: { global: {} }, tools: {}, network: { fetch: netFetch } };
registerRoutes(app, { ctx, state: {} });

const handler = (method, p) => {
  const hit = routes.find((r) => r[0] === method && r[1] === p);
  if (!hit) throw new Error(`route not found: ${method} ${p}`);
  return hit[2];
};
const POST_PLAYLIST = handler('POST', '/widget/api/playlist');
const GET_PLAYLIST = handler('GET', '/widget/api/music/playlist');
const DELETE_TRACK = handler('DELETE', '/api/track');
const GET_PLAYBACK = handler('GET', '/api/playback-state');
const POST_PLAYBACK = handler('POST', '/api/playback-state');

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

/* 6) 播放状态：POST 落盘 → GET 取回（跨文档续播的持久层） */
const snap = { currentId: 'imp:1|netease:1', activeList: 'imp:1', progress: 12.5, volume: 0.8, muted: false, mode: 'list', lyricsVisible: true, playing: true };
await POST_PLAYBACK(fakeC({ json: snap }));
const got = await GET_PLAYBACK(fakeC({}));
check('playback-roundtrip', got.body.ok === true && got.body.state && got.body.state.playing === true && got.body.state.progress === 12.5, JSON.stringify(got.body));

/* 7) 非法播放状态被拒 */
const bad = await POST_PLAYBACK(fakeC({ json: null }));
check('playback-reject-invalid', bad.status === 400, JSON.stringify(bad));

/* 8) 导入歌单：netease 时附带官方真名（meta.name） */
netCalls = [];
let plRes = await GET_PLAYLIST(fakeC({ query: { id: '12881021', server: 'netease' } }));
check('playlist-meta-netease',
  plRes.body.ok === true && plRes.body.tracks.length === 1 &&
  plRes.body.meta && plRes.body.meta.name === 'Can_0201喜欢的音乐' && plRes.body.meta.creator === 'Can_0201',
  JSON.stringify(plRes.body));
check('playlist-meta-netease-fetched',
  netCalls.some((u) => u.includes('music.163.com/api/v6/playlist/detail?id=12881021')),
  JSON.stringify(netCalls));

/* 9) 非 netease：不取真名（meta 缺省），也不打网易云 */
netCalls = [];
plRes = await GET_PLAYLIST(fakeC({ query: { id: '12881021', server: 'tencent' } }));
check('playlist-meta-skip-non-netease',
  plRes.body.ok === true && plRes.body.meta === undefined &&
  !netCalls.some((u) => u.includes('music.163.com')),
  JSON.stringify({ body: plRes.body, netCalls }));

fs.rmSync(dataDir, { recursive: true, force: true });

const failed = results.filter((r) => !r.ok);
console.log(JSON.stringify({ passed: results.length - failed.length, total: results.length, failed, results }, null, 2));
process.exit(failed.length ? 1 : 0);
