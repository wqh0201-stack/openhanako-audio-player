/**
 * lib/meting.js — Meting 公共节点的搜索 / 歌词 / 歌单取用。
 *
 * v1 的做法：裸 fetch 打 4 个节点，谁通用谁。v2 没有裸 fetch，
 * 只能走 ctx.network.fetch —— 每个主机必须在 manifest 的 network.allowedHosts
 * 里逐个列出，没有运行时增补的口子。
 *
 * 节点返回格式不统一（实测 2026-09-10）：
 *   met.liiiu.cn        → 30 条，title/author/url/pic/lrc 齐全
 *   api.qijieya.cn      → 30 条，但 title 为空（字段名不同）
 *   另外两个            → 只回 1 条
 * 所以这里只做最小归一化 + 逐个节点降级，不猜各家的字段别名。
 *
 * 三种响应形态要分清，别拿同一种解析去套：
 *   search / playlist → JSON 数组
 *   lrc               → text/plain 的 LRC 原文（不是 JSON！）
 *   url               → 302 跳转，不读 body
 *
 * 播放不走这里：节点 type=url 会 302 到 CDN 直链（实测无防盗链），
 * 前端 <audio> 直接吃那个地址即可，不吃 CORS、不占响应体上限。
 */

const NODES = [
  "https://met.liiiu.cn/meting/api",
  "https://api.qijieya.cn/meting/",
  "https://metingapi.nanorocky.top/",
  "https://api.amarea.cn/meting/",
];

// kuwo / baidu 已删（公共节点实测搜索均 0 条，见知识库《音乐音源探活与层级》）。
const ALLOWED_SERVERS = ["netease", "tencent", "kugou"];

/** 跳板端点默认用的节点。实测最稳的一个；要换就改这里。 */
export const PREFERRED_NODE = NODES[0];

/**
 * 从 Meting 地址里抠出歌曲 id。
 * 地址形如 <node>?server=netease&type=url&id=1431292823
 * 注意有些节点不返回独立的 id 字段，只能从 url 里拿。
 */
export function extractTrackId(url) {
  const m = /[?&]id=([^&]+)/.exec(String(url || ""));
  return m ? decodeURIComponent(m[1]) : "";
}

/** 归一化：只认这几个键，缺了就空串。 */
function normalizeTrack(x) {
  return {
    id: String(x?.id ?? ""),
    title: String(x?.title ?? ""),
    author: String(x?.author ?? ""),
    url: String(x?.url ?? ""),
    pic: String(x?.pic ?? ""),
    lrc: String(x?.lrc ?? ""),
  };
}

function hostOf(node) {
  try {
    return new URL(node).hostname;
  } catch {
    return node;
  }
}

function assertQuery({ keyword, id, server }) {
  if (keyword !== undefined && (!keyword || !String(keyword).trim())) {
    throw Object.assign(new Error("keyword required"), { code: 400 });
  }
  if (id !== undefined && (!id || !String(id).trim())) {
    throw Object.assign(new Error("id required"), { code: 400 });
  }
  if (!ALLOWED_SERVERS.includes(server)) {
    throw Object.assign(new Error("invalid server"), { code: 400 });
  }
}

/**
 * 试节点拿 JSON 数组。失败原因全收集，全挂了才抛 ——
 * 报错要能看出是哪几个节点的问题，而不是笼统一句"失败了"。
 */
async function fetchJsonList(ctx, path, timeoutMs = 8000) {
  const errors = [];
  for (const node of NODES) {
    try {
      const res = await ctx.network.fetch(`${node}${path}`, { method: "GET", timeoutMs });
      if (!res.ok) {
        errors.push(`${hostOf(node)} → HTTP ${res.status}`);
        continue;
      }
      const raw = await res.json();
      if (Array.isArray(raw) && raw.length > 0) return { raw, host: hostOf(node) };
      errors.push(`${hostOf(node)} → 空结果`);
    } catch (err) {
      errors.push(`${hostOf(node)} → ${err?.message || err}`);
    }
  }
  throw new Error(`所有 Meting 节点均不可用: ${errors.join("; ")}`);
}

/** 试节点读纯文本（歌词走这条）。 */
async function fetchText(ctx, path, timeoutMs = 8000) {
  const errors = [];
  for (const node of NODES) {
    try {
      const res = await ctx.network.fetch(`${node}${path}`, { method: "GET", timeoutMs });
      if (!res.ok) {
        errors.push(`${hostOf(node)} → HTTP ${res.status}`);
        continue;
      }
      const text = (await res.text()).trim();
      if (text) return { text, host: hostOf(node) };
      errors.push(`${hostOf(node)} → 空`);
    } catch (err) {
      errors.push(`${hostOf(node)} → ${err?.message || err}`);
    }
  }
  throw new Error(`所有 Meting 节点均无结果: ${errors.join("; ")}`);
}

export async function searchMusic(ctx, { keyword, server = "netease", limit = 30 }) {
  assertQuery({ keyword, server });

  const path = `?server=${encodeURIComponent(server)}&type=search&id=${encodeURIComponent(keyword)}`;
  const { raw, host } = await fetchJsonList(ctx, path);
  return { results: raw.map(normalizeTrack).slice(0, limit), host, total: raw.length };
}

export async function getLyric(ctx, { id, server = "netease" }) {
  assertQuery({ id, server });

  // type=lrc 回的是 text/plain 的 LRC 原文，不是 JSON：
  //   [00:00.00] 作词 : 黑金雨\n[00:00.25] 作曲 : ...
  const path = `?server=${encodeURIComponent(server)}&type=lrc&id=${encodeURIComponent(id)}`;
  const { text, host } = await fetchText(ctx, path);
  return { lyric: text, host };
}

export async function fetchMetingList(ctx, { id, server = "netease", timeoutMs = 10000 }) {
  assertQuery({ id, server });

  const path = `?server=${encodeURIComponent(server)}&type=playlist&id=${encodeURIComponent(id)}`;
  const { raw, host } = await fetchJsonList(ctx, path, timeoutMs);
  return { tracks: raw.map(normalizeTrack), host };
}

/** 单曲详情：type=song 返回单个对象（不是数组），形状与 search 单项一致。 */
export async function fetchMetingSong(ctx, { id, server = "netease", timeoutMs = 8000 }) {
  assertQuery({ id, server });

  const path = `?server=${encodeURIComponent(server)}&type=song&id=${encodeURIComponent(id)}`;
  const errors = [];
  for (const node of NODES) {
    try {
      const res = await ctx.network.fetch(`${node}${path}`, { method: "GET", timeoutMs });
      if (!res.ok) {
        errors.push(`${hostOf(node)} → HTTP ${res.status}`);
        continue;
      }
      const raw = await res.json();
      // 有的节点回对象、有的回单元素数组——两种都接
      const obj = Array.isArray(raw) ? raw[0] : raw;
      if (obj && (obj.title || obj.url)) return { track: normalizeTrack(obj), host: hostOf(node) };
      errors.push(`${hostOf(node)} → 空结果`);
    } catch (err) {
      errors.push(`${hostOf(node)} → ${err?.message || err}`);
    }
  }
  throw new Error(`所有 Meting 节点均不可用: ${errors.join("; ")}`);
}
