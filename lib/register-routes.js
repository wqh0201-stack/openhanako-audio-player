/**
 * lib/register-routes.js — App 自有后端路由。
 *
 * 实际 URL 前缀是 /api/apps/<appId>/routes/，这里只写相对部分。
 *
 * ⚠️ 路径命名：一部分端点写作 `/widget/api/...`，这不是笔误。
 * 移植过来的 index.html 是 v1 的原 UI，它把接口拼成 `${API}/widget/api/...`，
 * 其中 API 已被改写成 /api/apps/<appId>/routes。搬 UI 时只动了 API 那个值，
 * 没有改它的拼接方式，所以后端必须拿出同名的 /widget/api/... 路径，
 * 否则前端二十多处调用会全部 404。新增的端点走 /api/... 更清爽，
 * 但已被旧 UI 引用的那批保持原路径。
 */

import fs from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import {
  searchMusic,
  getLyric,
  fetchMetingList,
  fetchMetingSong,
  extractTrackId,
  PREFERRED_NODE,
} from "./meting.js";
import { loadCookies } from "./cookies.js";

/** 音频扩展名 → MIME。与 v1 同表。 */
const MIME = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  ogg: "audio/ogg",
  flac: "audio/flac",
  m4a: "audio/mp4",
};

const BANNER_ID = "audio-player-lyrics";
const BANNER_LIMIT = 200;

function clip(text) {
  return text.length <= BANNER_LIMIT ? text : text.slice(0, BANNER_LIMIT);
}

/** 把带 code 的错误转成 HTTP 响应。 */
function fail(c, err) {
  const status = Number(err?.code) >= 400 ? Number(err.code) : 500;
  return c.json({ ok: false, error: err?.message || String(err) }, status);
}

export function registerRoutes(app, { ctx, state }) {
  // ctx 不直接给 appId，但 dataDir 的末段就是它（{HANA_HOME}/app-data/<appId>）。
  const appId = path.basename(ctx.dataDir) || "app";

  // ── 音频跳板 ────────────────────────────────────────
  //
  // 旧 UI 的 addTrack() 按 `url.split('?')[0]` 去重：把 query 全部去掉再比。
  // 而 Meting 的音频地址是 <node>?server=X&type=url&id=Y —— **每首歌只有 query
  // 里的 id 不同**，去掉 query 之后所有歌都是同一个字符串。
  // 后果：点搜索结果里任何一首新歌，都会被当成已存在的第一条，load(那个 i)，
  // 表现就是“一放就跳回上一首”。
  //
  // 修法：不碰前端的去重逻辑，改由后端把唯一标识（歌曲 id）放进 **path 段**。
  // 跳板自己再 302 到真正的 Meting 地址。前端拿到的 URL 逐首不同，去重就正常了。
  const GO_BASE = `/api/apps/${appId}/routes/widget/api/music/go`;

  function toGoUrl(metingUrl, server) {
    const id = extractTrackId(metingUrl);
    if (!id) return metingUrl; // 抠不出 id 就原样返回，不把曲目弄丢
    return `${GO_BASE}/${encodeURIComponent(id)}?server=${encodeURIComponent(server)}`;
  }

  /**
   * 在线曲目的稳定 id：`${server}:${metingId}`。
   * Meting 有的节点不回 id 字段，只能从 url 里抠（那个值与 id 相同）。
   * 必须在把 url 换成 go 跳板地址**之前**调用 —— go 地址的 id 在 path 段，
   * extractTrackId 是按 `?id=` 抠 query 的，换完就抠不到了。
   */
  function metingStableId(server, track) {
    const raw = String(track?.id ?? "").trim() || extractTrackId(track?.url);
    return raw ? `${server}:${raw}` : "";
  }

  /**
   * 去重用的稳定键。优先 id（本地=文件名含扩展名，在线=`server:id`）；
   * 老数据（v1 遗留）没有 id 时回退到**完整 url** —— 刻意不做
   * `url.split('?')[0]`，那会把所有在线曲目并成同一条。
   *
   * 键里**纳入归属列表 list**：同一首歌可以同时出现在多个歌单（如导入两次同一歌单、
   * 本地列表里也有一首），若只用 id 去重会被并成一条、丢掉另一份列表的归属。
   * list 为空的老数据（迁移前）用空串占位，行为与旧版一致。
   */
  function trackKey(t) {
    const id = String(t?.id ?? "").trim();
    const list = String(t?.list ?? "").trim();
    if (id) return `id:${list}|${id}`;
    return `url:${list}|${String(t?.url ?? "").trim()}`;
  }

  app.get("/widget/api/music/go/:id", async (c) => {
    const id = c.req.param("id");
    const server = c.req.query("server") || "netease";
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return c.text("invalid id", 400);

    // 先试 cookie 拿完整音频地址，失败回退 Meting 试听
    const { NETEASE_COOKIE } = loadCookies(ctx.dataDir);
    if (NETEASE_COOKIE && server === "netease") {
      try {
        const apiUrl = `https://music.163.com/api/song/enhance/player/url?ids=[${id}]&br=320000`;
        const res = await ctx.network.fetch(apiUrl, {
          method: "GET",
          headers: {
            Cookie: NETEASE_COOKIE,
            Referer: "https://music.163.com",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });
        const data = await res.json();
        const fullUrl = data?.data?.[0]?.url;
        if (fullUrl) {
          return c.redirect(fullUrl.replace("http://", "https://"));
        }
      } catch (e) {
        // cookie 失效或网络问题，回退 Meting
      }
    }

    return c.redirect(
      `${PREFERRED_NODE}?server=${encodeURIComponent(server)}&type=url&id=${encodeURIComponent(id)}`,
    );
  });

  // ── 新端点（我们自己的卡片用） ──────────────────────────────

  app.get("/api/state", async (c) => {
    return c.json({ ok: true, data: await state.get() });
  });

  app.post("/api/select", async (c) => {
    const body = await c.req.json().catch(() => null);
    const index = Number(body?.index);
    if (!Number.isInteger(index) || index < 0) {
      return c.json({ ok: false, error: "invalid index" }, 400);
    }
    const track = await state.select(index);
    if (!track) return c.json({ ok: false, error: "out of range" }, 404);
    return c.json({ ok: true, data: track });
  });

  // ── 横幅按钮：试过，走不通（2026-09-22 实测）──────────────────
  //
  // 按钮宿主管渲染（三个都在），点击也确实发出去了，但：
  //   · ctx.bus.subscribe 注册成功（日志有「订阅已注册」）
  //   · 之后一条事件都收不到（bus-dbg 零命中，连会话事件也没有）
  // 所以「点按钮 → 通知应用 → 落命令 → 卡片轮询执行」这条链路的第一跳就断了。
  //
  // 留着按钮只会变成“点了没反应”，比没有更糟，因此撤掉。
  // 已写进《宿主能力需求》：需要宿主确认 v2 应用的 ctx.bus.subscribe
  // 是否真的推送 plugin-v2:{appId}:banner。
  //
  // 将来宿主修好了，恢复方式：给下面的 set 加回 buttons，
  // 再起一个 pendingCommand + /api/command 供卡片轮询。

  /** 歌词推送：卡片按行调用，后端转成输入框上方的横幅。 */
  app.post("/api/lyric-line", async (c) => {
    const body = await c.req.json().catch(() => null);
    const line = typeof body?.line === "string" ? body.line.trim() : "";
    const sessionPath = await state.bannerSession();

    if (!sessionPath) {
      return c.json({ ok: false, error: "no-bound-session" }, 409);
    }

    const { track } = await state.get();
    // 用 ♪ 打头：宿主把「应用名」和「我的 text」拆成两个 span 且样式不同，
    // 但 text 内部是一整串纯文本、没有富文本口子（实测：参数只有
    // sessionPath/bannerId/text/buttons，渲染走 <span>{text}</span>）。
    // 所以区分层次只能靠符号，不能靠字号/颜色。
    const title = track?.title ? `${track.title} · ` : "";
    const text = clip(`♪ ${title}${line}`);

    ctx.inputBanner.set({ sessionPath, bannerId: BANNER_ID, text });
    return c.json({ ok: true, data: { text } });
  });

  app.post("/api/lyric-hide", async (c) => {
    const sessionPath = await state.bannerSession();
    if (!sessionPath) return c.json({ ok: true });
    ctx.inputBanner.dismiss({ sessionPath, bannerId: BANNER_ID });
    return c.json({ ok: true });
  });

  // ── 会话粘性状态：卡片查“我有没有绑过会话”──
  //
  // 卡片拿不到 sessionPath（宿主不给，SDK 也没这个 API），所以横幅
  // 能不能挂完全取决于“有没有在对话里用过工具”。这个端点让卡片
  // 自己知道当前状态，好在 UI 上给个提示，而不是默默不工作。
  app.get("/api/session-status", async (c) => {
    const bound = await state.hasBannerSession();
    return c.json({ ok: true, bound });
  });

  // ── 卡片上报当前曲目 ──
  //
  // 症状：在卡片里换歌后，横幅里的歌名还是旧的。
  // 根因：后端 state 只在 audio_play 工具调用时更新；卡片自己换歌只改了
  // 界面（trackName），从没告知后端。而 /api/lyric-line 拼文案时读的是
  // state 里的 track.title —— 于是永远落后一步。
  //
  // 这里让卡片在 load() 时把当前曲目推上来，让两边同步。
  // 不直接写 state.queue（那是工具的领域），只更新“当前曲目”这一项。
  app.post("/api/now-playing", async (c) => {
    const body = await c.req.json().catch(() => null);
    const title = typeof body?.title === "string" ? body.title.trim() : "";
    if (!title) return c.json({ ok: false, error: "title required" }, 400);
    state.setCurrentTrack({ title, source: body?.source || "" });
    return c.json({ ok: true });
  });

  // ── 播放凭证：完整音频 URL（带 cookie，绕开试听限制）──
  //
  // v1 的原逻辑整体搬来，两处适配 v2：
  //   1) cookie 从 ctx.dataDir/cookies.env 读（v2 安装目录只读，凭证落可写的 app-data）
  //   2) 网络用 ctx.network.fetch（v2 Node 侧没有裸 fetch；
  //      网易云 music.163.com 已在 allowedHosts，QQ 的 u.y.qq.com 需补进 manifest）
  //
  // 前端 UI 里的 CookieCheck() 会调本端点（探针 id=418608185 周杰伦《晴天》），
  // 返回 cookieExpired:true 时 toast 提示登录态失效。
  app.get("/widget/api/music/full-url", async (c) => {
    try {
      const id = c.req.query("id") || "";
      const server = c.req.query("server") || "netease";
      const fallback = c.req.query("fallback") || "";
      if (!id) return c.json({ ok: false, error: "id required" }, 400);

      const { NETEASE_COOKIE, TENCENT_COOKIE } = loadCookies(ctx.dataDir);

      // 没配任何 cookie → 直接回退到 Meting URL
      if (!NETEASE_COOKIE && !TENCENT_COOKIE && fallback) return c.redirect(fallback);
      if (!NETEASE_COOKIE && !TENCENT_COOKIE) return c.json({ ok: false, error: "no cookie configured" });

      if (server === "netease" && NETEASE_COOKIE) {
        const apiUrl = `https://music.163.com/api/song/enhance/player/url?ids=[${id}]&br=320000`;
        const res = await ctx.network.fetch(apiUrl, {
          method: "GET",
          headers: {
            Cookie: NETEASE_COOKIE,
            Referer: "https://music.163.com",
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
          },
        });
        const data = await res.json();
        const fullUrl = data?.data?.[0]?.url;
        if (fullUrl) {
          return c.json({ ok: true, url: fullUrl.replace("http://", "https://") });
        }
        const outerCode = data?.code;
        if (outerCode === 301 || (!fullUrl && data?.message === "need login")) {
          return c.json({ ok: false, error: "session_expired", cookieExpired: true, message: "网易云登录态已失效" });
        }
        const songCode = data?.data?.[0]?.code;
        if (songCode === 404 || songCode === 403) {
          if (fallback) return c.json({ ok: true, url: fallback });
          return c.json({ ok: false, error: "song_unavailable", cookieExpired: false });
        }
      }

      if (server === "tencent" && TENCENT_COOKIE) {
        // QQ 音乐：cookie 格式 uin=xxx; qqmusic_key=xxx
        const uinMatch = TENCENT_COOKIE.match(/uin=([^;]+)/);
        const keyMatch = TENCENT_COOKIE.match(/qqmusic_key=([^;]+)/);
        const uin = uinMatch ? uinMatch[1].trim() : "";
        const qqmusic_key = keyMatch ? keyMatch[1].trim() : "";
        const guid = Math.floor(Math.random() * 10000000).toString();
        const reqBody = {
          req_0: {
            module: "vkey.GetVkeyServer",
            method: "CgiGetVkey",
            param: { guid, songmid: id, songtype: [0], uin, loginflag: 1, platform: "20" },
          },
          comm: { uin, format: "json", ct: 19, cv: 0, authst: qqmusic_key },
        };
        const apiUrl =
          "https://u.y.qq.com/cgi-bin/musicu.fcg?-=getplaysongvkey&g_tk=5381&loginUin=" +
          uin +
          "&hostUin=0&format=json&inCharset=utf8&outCharset=utf-8&platform=yqq.json&needNewCode=0&data=" +
          encodeURIComponent(JSON.stringify(reqBody));
        const res = await ctx.network.fetch(apiUrl, { method: "GET" });
        const data = await res.json();
        const purl = data?.req_0?.data?.midurlinfo?.[0]?.purl;
        if (purl) {
          const sip =
            data.req_0.data.sip.find((s) => !s.startsWith("http://ws")) || data.req_0.data.sip[0];
          return c.json({ ok: true, url: (sip + purl).replace("http://", "https://") });
        }
      }

      // cookie 无效或拿不到 → 回退
      if (fallback) {
        if (server === "netease") {
          return c.json({ ok: true, url: fallback, cookieExpired: true, message: "网易云 cookie 失效，使用试听版" });
        }
        return c.json({ ok: true, url: fallback });
      }
      return c.json({ ok: false, error: "failed to get full url", cookieExpired: server === "netease" });
    } catch (e) {
      const fallback = c.req.query("fallback") || "";
      if (fallback) return c.json({ ok: true, url: fallback });
      return c.json({ ok: false, error: e.message }, 500);
    }
  });

  // ── 旧 UI（index.html）引用的端点，路径必须与 v1 一致 ─────────

  /**
   * 在线音乐搜索。
   * 结果里的 url 指向 Meting 节点（会 302 到 CDN 直链），前端 <audio>
   * 直接用它播放 —— 不经本应用后端，故不吃响应体上限、也不占 IPC。
   */
  app.get("/widget/api/music/search", async (c) => {
    try {
      const keyword = c.req.query("keyword") || "";
      const server = c.req.query("server") || "netease";
      const limit = Number(c.req.query("limit")) || 30;
      const { results, host, total } = await searchMusic(ctx, { keyword, server, limit });
      // 逐首换成 path 唯一的跳板地址，否则前端按裸 URL 去重会互相覆盖。
      // 稳定 id 必须在换 url 之前取（见 metingStableId）。
      const mapped = results.map((r) => ({
        ...r,
        id: metingStableId(server, r),
        url: toGoUrl(r.url, server),
      }));
      return c.json({ ok: true, results: mapped, host, total });
    } catch (err) {
      return fail(c, err);
    }
  });

  /**
   * 歌词（LRC 原文）。
   *
   * 必须回 text/plain，不包 JSON —— 旧 UI 用 `r.text()` 直接吃 body：
   *   fetch(proxyUrl).then(r => r.text()).then(parseLrc)
   * 包上一层 {ok,lyric} 会被当成歌词原文画到界面上。
   */
  app.get("/widget/api/music/lrc", async (c) => {
    try {
      const id = c.req.query("id") || "";
      const server = c.req.query("server") || "netease";
      const { lyric } = await getLyric(ctx, { id, server });
      return c.text(lyric, 200, { "Content-Type": "text/plain; charset=utf-8" });
    } catch (err) {
      return c.text(`lyric fetch failed: ${err?.message || err}`, 502);
    }
  });

  /**
   * 歌词代理：前端有时拿到的是 lrc 文件 URL 而不是歌词 ID。
   * 同样回 text/plain。目标主机必须在 manifest 的 network.allowedHosts 里。
   */
  app.get("/widget/api/music/lrc-proxy", async (c) => {
    const url = c.req.query("url") || "";
    if (!url) return c.text("url required", 400);
    try {
      const res = await ctx.network.fetch(url, { method: "GET", timeoutMs: 8000 });
      if (!res.ok) return c.text(`upstream ${res.status}`, 502);
      return c.text((await res.text()).trim(), 200, {
        "Content-Type": "text/plain; charset=utf-8",
      });
    } catch (err) {
      return c.text("lyric fetch failed", 502);
    }
  });

  /**
   * 逐字歌词（TTML）代理：AMLL TTML DB。
   * 按平台 + 歌曲 id 取，拿到就是行级+字级双时间戳；404 = 库里没收这首歌，
   * 前端自行退回行级 LRC。
   */
  app.get("/widget/api/music/ttml", async (c) => {
    const id = c.req.query("id") || "";
    const platform = c.req.query("platform") || "ncm";
    if (!id) return c.text("id required", 400);
    if (!["ncm", "qq"].includes(platform)) return c.text("bad platform", 400);
    const target = `https://amll-ttml-db.stevexmh.net/${platform}/${encodeURIComponent(id)}?format=ttml`;
    try {
      const res = await ctx.network.fetch(target, { method: "GET", timeoutMs: 8000 });
      if (res.status === 404) return c.text("not in amll-db", 404);
      if (!res.ok) return c.text(`upstream ${res.status}`, 502);
      const text = (await res.text()).trim();
      if (!/<tt[\s>]/i.test(text)) return c.text("not ttml", 404);
      return c.text(text, 200, {
        "Content-Type": "application/ttml+xml; charset=utf-8",
      });
    } catch (err) {
      return c.text("ttml fetch failed", 502);
    }
  });

  // ── SMTC 可行性探针（只读，Phase B 用）─────────────────────
  //
  // 需求文档 §八 要求“验证前不启动实现”。这个端点只负责收探针结果，
  // 不碰播放、不影响任何功能；验完就可以拆。
  // 结果落在内存，不落盘 —— 本来就是一次性的检测。
  let smtcProbe = null;
  let pendingResize = null;

  app.post("/api/_probe/smtc", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return c.json({ ok: false, error: "body required" }, 400);
    }
    smtcProbe = { ...body, receivedAt: new Date().toISOString() };
    ctx.logger?.info?.(`[smtc-probe] ${JSON.stringify(smtcProbe)}`);
    return c.json({ ok: true });
  });

  app.get("/api/_probe/smtc", (c) => {
    if (!smtcProbe) {
      return c.json({ ok: false, error: "探针尚未上报（卡片可能还没打开）" }, 404);
    }
    return c.json({ ok: true, probe: smtcProbe });
  });

  /**
   * 工具注册探针。
   *
   * 背景：v2 的工具名全局唯一，重名会被**静默拒绝** —— 应用仍显示 loaded，
   * 但它注册的工具其实没进去（拿本 app 的 id 与另一个 app 撞名时实测）。
   * 这个端点回报本 app 自己注册到的工具，用来区分「确实注册上了」与「被撞掉了」。
   *
   * 也回报 dataDir 末段（即 appId），因为工具返回的 URL 前缀靠它推导 ——
   * 两边对不上就说明干活的是另一个 app。
   */
  app.get("/api/_probe/tools", async (c) => {
    try {
      const own = await ctx.tools.listOwn();
      return c.json({
        ok: true,
        appId: path.basename(ctx.dataDir) || null,
        dataDir: ctx.dataDir,
        count: own.length,
        names: own.map((t) => t.name),
      });
    } catch (err) {
      return c.json({ ok: false, error: err?.message || String(err) }, 500);
    }
  });

  // ── 卡片尺寸探针（只读）─────────────────────────────────
  //
  // 症状：卡片在聊天流里撑满整个视口，聊天区被顶住滑不动。
  // 我上报的是 460px，但看起来没生效。这里把真实尺寸报出来，
  // 包括 envelope（宿主告知的容器约束）——直接测，不猜。
  // 多个呈现面（对话流卡 / 黑板 / 拆窗）都会往这里写，单槽位会互相覆盖 ——
  // 按来源分键存，谁是哪个一眼看得出。
  let sizeProbe = {};

  app.post("/api/_probe/size", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || typeof body !== "object") return c.json({ ok: false }, 400);
    const key =
      typeof body.probeKey === "string" && body.probeKey ? body.probeKey : "_default";
    sizeProbe[key] = { ...body, receivedAt: new Date().toISOString() };
    // 落盘一份。卡片跑在 iframe 里，它的 console 主机侧看不见；
    // 把运行时事实（挂载位、envelope、真实尺寸）写到 app-data，
    // 是唯一能从主机侧读到的通道 —— 尺寸链的修法得建在实测上，不是猜。
    try {
      fs.writeFileSync(
        path.join(ctx.dataDir, "_probe-size.json"),
        JSON.stringify(sizeProbe, null, 2),
        "utf-8"
      );
    } catch (err) {
      ctx.logger?.warn?.(`[_probe/size] 落盘失败 ${err?.message || err}`);
    }
    return c.json({ ok: true });
  });

  app.get("/api/_probe/size", (c) => {
    const keys = Object.keys(sizeProbe);
    if (!keys.length) return c.json({ ok: false, error: "尚未上报" }, 404);
    return c.json({ ok: true, probes: sizeProbe });
  });

  // 手动触发一次 resize 上报，用来验证这条通道通不通
  app.post("/api/_probe/resize", async (c) => {
    const body = await c.req.json().catch(() => null);
    const h = Number(body?.height);
    if (!Number.isFinite(h) || h <= 0) return c.json({ ok: false, error: "height required" }, 400);
    pendingResize = h;
    return c.json({ ok: true, queued: h });
  });

  app.get("/api/_probe/resize", (c) => {
    const h = pendingResize;
    pendingResize = null;
    return c.json({ ok: true, height: h });
  });

  // ── 本地文件访问探测（本地导入的前置验证）──────────────
  //
  // AppHost 的 Node 权限只放行安装目录与 app-data（进程参数里的 --allow-fs-read），
  // 裸 fs.readFileSync('D:/Music/x.mp3') 会被 ERR_ACCESS_DENIED 拒掉。
  // 读盘外必须走 ctx.resources（经 RPC 请宿主代读），而它需要 app/resources.read。
  //
  // 这里把 list / stat 的真实返回形状报出来——写在实现之前，免得靠猜。
  app.get("/api/_probe/fs", async (c) => {
    const p = c.req.query("path") || "";
    if (!p) return c.json({ ok: false, error: "path required" }, 400);

    const out = { path: p, attempts: {} };

    try {
      const st = await ctx.resources.stat({ kind: "local-file", path: p });
      out.attempts.stat = { ok: true, value: st };
    } catch (err) {
      out.attempts.stat = { ok: false, error: err?.message || String(err) };
    }

    try {
      const ls = await ctx.resources.list({ kind: "local-file", path: p });
      out.attempts.list = {
        ok: true,
        isArray: Array.isArray(ls),
        keys: ls && typeof ls === "object" ? Object.keys(ls).slice(0, 20) : null,
        sample: Array.isArray(ls) ? ls.slice(0, 3) : ls,
      };
    } catch (err) {
      out.attempts.list = { ok: false, error: err?.message || String(err) };
    }

    return c.json({ ok: true, data: out });
  });

  // ── 本地文件导入 ──────────────────────────────────────────
  //
  // 硬约束（读自 AppHost 进程参数）：Node 只被放行安装目录与 app-data，
  // 裸 fs.readFileSync('D:/Music/x.mp3') 会被 ERR_ACCESS_DENIED 拒掉。
  // 所以读盘外一律走 ctx.resources（经 RPC 请宿主代读），需 app/resources.read。
  //
  // 做法与 v1 一致：把文件**复制**进 app-data/media，再交给已有的
  // /widget/media/:filename 端点（带 Range 支持）。不直接引用原路径 ——
  // 那条路要每次分块请求都走一次 RPC，而且拖动进度条会很难受。

  const AUDIO_EXTS = [".mp3", ".wav", ".ogg", ".flac", ".m4a"];

  /** 单次扫描最多处理的文件数。ponytail: 防大目录卡死；真需要更多时改成后台任务。 */
  const SCAN_FILE_CAP = 200;

  function isAudio(name) {
    const lower = String(name || "").toLowerCase();
    return AUDIO_EXTS.some((e) => lower.endsWith(e));
  }

  function safeName(name) {
    return String(name || "").replace(/[/\\:*?"<>|]/g, "_");
  }

  /**
   * 把一个盘外文件搬进 media 目录。
   * 先试 ctx.resources.copy（宿主代劳，一步到位）；不支持则回退
   * read + fs.write —— 两端返回形状在类型包上都是 unknown，所以不赌单一路径。
   */
  async function copyIntoMedia(srcPath, filename) {
    const dest = path.join(mediaDir, filename);
    if (fs.existsSync(dest)) return { dest, existed: true };

    try {
      await ctx.resources.copy(
        { kind: "local-file", path: srcPath },
        { kind: "local-file", path: dest },
      );
      if (fs.existsSync(dest)) return { dest, existed: false };
    } catch (err) {
      ctx.logger?.warn?.(`[import] copy 回退到 read: ${err?.message || err}`);
    }

    const data = await ctx.resources.read({ kind: "local-file", path: srcPath });
    const buf = Buffer.isBuffer(data)
      ? data
      : data instanceof Uint8Array
        ? Buffer.from(data)
        : data instanceof ArrayBuffer
          ? Buffer.from(data)
          : typeof data === "string"
            ? Buffer.from(data, "binary")
            : null;
    if (!buf) throw new Error("读取到的内容不是预期的二进制形式");

    fs.writeFileSync(dest, buf);
    return { dest, existed: false };
  }

  const mediaUrl = (filename) => `${MEDIA_PREFIX}/${encodeURIComponent(filename)}`;

  /** 单个文件导入。契约（读自旧 UI）：{ ok, name, url, mode } */
  app.get("/widget/api/import-file", async (c) => {
    const src = c.req.query("path") || "";
    if (!src) return c.json({ ok: false, error: "path required" }, 400);
    const base = path.basename(src);
    if (!isAudio(base)) return c.json({ ok: false, error: "不支持的格式" }, 400);

    try {
      const st = await ctx.resources.stat({ kind: "local-file", path: src });
      if (!st?.exists || st?.isDirectory) return c.json({ ok: false, error: "不是文件" }, 400);
      const filename = safeName(base);
      await copyIntoMedia(src, filename);
      return c.json({
        ok: true,
        id: filename,
        name: filename.replace(/\.\w+$/, ""),
        url: mediaUrl(filename),
        mode: "本地",
      });
    } catch (err) {
      return fail(c, err);
    }
  });

  /** 文件夹扫描导入（含子目录，限深）。契约：{ ok, files:[{name,url,mode}], count } */
  app.get("/widget/api/scan-folder", async (c) => {
    const root = c.req.query("path") || "";
    if (!root) return c.json({ ok: false, error: "path required" }, 400);

    try {
      const rootStat = await ctx.resources.stat({ kind: "local-file", path: root });
      if (!rootStat?.exists || !rootStat.isDirectory) {
        return c.json({ ok: false, error: "不是目录" }, 400);
      }

      const files = [];
      const seen = new Set();
      const queue = [{ dir: root, depth: 0 }];

      while (queue.length && files.length < SCAN_FILE_CAP) {
        const { dir, depth } = queue.shift();
        const listing = await ctx.resources.list({ kind: "local-file", path: dir });
        const items = Array.isArray(listing?.items) ? listing.items : [];

        for (const item of items) {
          if (files.length >= SCAN_FILE_CAP) break;
          const name = String(item?.name || "");
          if (!name || name.startsWith("_")) continue;

          if (item.isDirectory) {
            if (depth < 3) queue.push({ dir: path.join(dir, name), depth: depth + 1 });
            continue;
          }
          if (!isAudio(name)) continue;

          const filename = safeName(name);
          if (seen.has(filename)) continue;
          seen.add(filename);

          try {
            await copyIntoMedia(path.join(dir, name), filename);
            files.push({
              id: filename,
              name: filename.replace(/\.\w+$/, ""),
              url: mediaUrl(filename),
              mode: "本地",
            });
          } catch (err) {
            ctx.logger?.warn?.(`[scan] 跳过 ${name}: ${err?.message || err}`);
          }
        }
      }

      return c.json({ ok: true, files, count: files.length });
    } catch (err) {
      return fail(c, err);
    }
  });

  /* ===== 歌词落盘：离线歌词库 ===== */
  const lyricsDir = path.join(ctx.dataDir, "lyrics");
  if (!fs.existsSync(lyricsDir)) fs.mkdirSync(lyricsDir, { recursive: true });

  /** 歌词文件名安全化：曲名 → 合法文件名 */
  const lrcSafeName = (name) => {
    const s = String(name || "").trim().replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ");
    return s || "untitled";
  };

  /** 读歌词：GET /widget/api/lrc/load?name=曲名 → { ok, lrc } | 404 */
  app.get("/widget/api/lrc/load", async (c) => {
    const name = c.req.query("name") || "";
    if (!name) return c.json({ ok: false, error: "name required" }, 400);
    const filename = lrcSafeName(name) + ".lrc";
    const p = path.join(lyricsDir, filename);
    if (!fs.existsSync(p)) return c.json({ ok: false, error: "not found" }, 404);
    try {
      const lrc = fs.readFileSync(p, "utf-8");
      return c.json({ ok: true, lrc, filename });
    } catch (err) {
      return c.json({ ok: false, error: err?.message || "read failed" }, 500);
    }
  });

  /** 写歌词：POST /widget/api/lrc/save { name, lrc } → { ok, filename } */
  app.post("/widget/api/lrc/save", async (c) => {
    const body = await c.req.json().catch(() => ({}));
    const name = String(body.name || "").trim();
    const lrc = String(body.lrc || "").trim();
    if (!name || !lrc) return c.json({ ok: false, error: "name & lrc required" }, 400);
    const filename = lrcSafeName(name) + ".lrc";
    const p = path.join(lyricsDir, filename);
    try {
      fs.writeFileSync(p, lrc, "utf-8");
      return c.json({ ok: true, filename });
    } catch (err) {
      return c.json({ ok: false, error: err?.message || "write failed" }, 500);
    }
  });

  /** 曲目直链跳转（Meting 结果里的 url 已经是带 auth 的完整地址）。 */
  app.get("/widget/api/music/url", async (c) => {
    const url = c.req.query("url") || "";
    if (!/^https?:\/\//i.test(url)) return c.json({ ok: false, error: "url required" }, 400);
    return c.redirect(url);
  });

  /** 封面：Meting 结果里的 pic 是完整地址，直接跳转。 */
  app.get("/widget/api/music/pic", async (c) => {
    const url = c.req.query("url") || "";
    if (!url) return c.json({ ok: false, error: "url required" }, 400);
    return c.redirect(url);
  });

  /** 导入整张歌单（Meting type=playlist）。 */
  app.get("/widget/api/music/playlist", async (c) => {
    const id = c.req.query("id") || "";
    const server = c.req.query("server") || "netease";
    if (!id) return c.json({ ok: false, error: "id required" }, 400);
    try {
      const { tracks, host } = await fetchMetingList(ctx, { id, server, timeoutMs: 10000 });
      const mapped = tracks.map((t) => ({
        ...t,
        id: metingStableId(server, t),
        url: toGoUrl(t.url, server),
      }));
      return c.json({ ok: true, tracks: mapped, host });
    } catch (err) {
      return fail(c, err);
    }
  });

  /** 导入单曲（Meting type=song）。支持直接传链接（自动抠 id）。 */
  app.get("/widget/api/music/song", async (c) => {
    let id = c.req.query("id") || "";
    const server = c.req.query("server") || "netease";
    // 粘贴完整链接时自动抠 id：music.163.com/song?id=347230 → 347230
    const m = /[?&]id=(\d+)/.exec(id);
    if (m) id = m[1];
    if (!id) return c.json({ ok: false, error: "id required" }, 400);
    try {
      const { track, host } = await fetchMetingSong(ctx, { id, server });
      return c.json({
        ok: true,
        track: { ...track, id: metingStableId(server, track), url: toGoUrl(track.url, server) },
        host,
      });
    } catch (err) {
      return fail(c, err);
    }
  });

  // ── 播放列表持久化 ──────────────────────────────────────────
  //
  // v1 把 playlist.json 落在自己的 plugin-data 目录。v2 里 ctx.dataDir 指向
  // {HANA_HOME}/app-data/<appId>，宿主已给这个目录读写权限（AppHost 进程参数里
  // --allow-fs-write 只开这一个），所以照搬的 fs 读写可以原样工作。
  // 注意：两代的 dataDir 不是同一个目录，v1 的旧列表不会自动过来。

  const playlistPath = path.join(ctx.dataDir, "playlist.json");
  const mediaDir = path.join(ctx.dataDir, "media");

  const MEDIA_PREFIX = `/api/apps/${appId}/routes/widget/media`;

  try {
    fs.mkdirSync(mediaDir, { recursive: true });
  } catch {
    /* 目录建不了就让后续读写各自报错 */
  }

  function loadPlaylistFromDisk() {
    try {
      if (fs.existsSync(playlistPath)) {
        return JSON.parse(fs.readFileSync(playlistPath, "utf-8"));
      }
    } catch (err) {
      ctx.logger?.warn?.(`[playlist] load failed: ${err?.message || err}`);
    }
    return null;
  }

  function savePlaylistToDisk(tracks) {
    try {
      fs.writeFileSync(playlistPath, JSON.stringify(tracks, null, 2), "utf-8");
    } catch (err) {
      ctx.logger?.warn?.(`[playlist] save failed: ${err?.message || err}`);
    }
  }

  /** 扫本应用的 media 目录。v2 只扫 app-data 一份，不再兼容 v1 的老路径。 */
  function collectMediaFiles() {
    const out = [];
    const seen = new Set();
    const exts = [".mp3", ".wav", ".ogg", ".flac", ".m4a"];
    if (!fs.existsSync(mediaDir)) return out;

    let names = {};
    try {
      const namesPath = path.join(mediaDir, "_names.json");
      if (fs.existsSync(namesPath)) names = JSON.parse(fs.readFileSync(namesPath, "utf-8"));
    } catch {
      /* 名字表读不了就用文件名 */
    }

    for (const name of fs.readdirSync(mediaDir)) {
      const lower = name.toLowerCase();
      if (!exts.some((e) => lower.endsWith(e))) continue;
      if (name.startsWith("_") || seen.has(name)) continue;
      seen.add(name);
      out.push({
        id: name,
        name: names[name] || name.replace(/\.\w+$/, ""),
        url: `${MEDIA_PREFIX}/${encodeURIComponent(name)}`,
        mode: "本地",
      });
    }
    return out;
  }

  /**
   * 按稳定 id 去重。与 tools/play.js 的 appendToPlaylist 同语义：
   * 保留首次出现的位置，后面的重复项并入（后写覆盖同名非空字段），
   * 这样不会因重复导入丢掉 pic/author 之类的补充信息。
   */
  function dedupeTracks(tracks) {
    const out = [];
    const index = new Map();
    for (const t of tracks) {
      if (!t || typeof t !== "object") continue;
      const key = trackKey(t);
      const at = index.get(key);
      if (at === undefined) {
        index.set(key, out.length);
        out.push({ ...t });
      } else {
        out[at] = { ...out[at], ...t };
      }
    }
    return out;
  }

  app.get("/widget/api/playlist", (c) => {
    const saved = loadPlaylistFromDisk();
    if (Array.isArray(saved) && saved.length) {
      return c.json({ ok: true, tracks: saved, count: saved.length });
    }
    const initial = collectMediaFiles().map((f) => ({ ...f, dur: 0, group: "本地音乐" }));
    savePlaylistToDisk(initial);
    return c.json({ ok: true, tracks: initial, count: initial.length });
  });

  app.post("/widget/api/playlist", async (c) => {
    const body = await c.req.json().catch(() => null);
    if (!body || !Array.isArray(body.tracks)) {
      return c.json({ ok: false, error: "invalid tracks" }, 400);
    }
    // 按稳定 id 去重（老数据无 id 时回退到完整 url，不做 split('?')[0]）。
    // 这样重复导入同一首在线曲目 / 同名本地文件只会留一条。
    const deduped = dedupeTracks(body.tracks);
    savePlaylistToDisk(deduped);
    return c.json({ ok: true, count: deduped.length });
  });

  // ── 删除曲目 ──────────────────────────────────────────────
  //
  // 新增端点走 /api/... 清爽路径（旧 UI 不引用它，不必进 /widget 族）。
  // 删列表项 + 清对应文件：本地曲目（id = 文件名含扩展名）删 app-data/media/<文件>，
  // 并按曲名删 app-data/lyrics/<曲名>.lrc；在线曲目（id = server:metingId）无文件可清。
  //
  // 只删“这一首”：列表里其余同 id 项（理论上去重后不应存在）一并不留，
  // 返回 removed 是实际从列表移除的条数。
  app.delete("/api/track", async (c) => {
    const id = (c.req.query("id") || "").trim();
    if (!id) return c.json({ ok: false, error: "id required" }, 400);
    // list 可选：带上时只删该列表里的那一份（同一首歌可在多个歌单里各自独立删除）；
    // 不带时保持旧行为（按 id 全删），兼容旧调用。
    const list = (c.req.query("list") || "").trim();
    const wantList = (c.req.query("list") !== undefined && c.req.query("list") !== null);

    const saved = loadPlaylistFromDisk();
    const all = Array.isArray(saved) ? saved : [];
    // 匹配：优先稳定 id；老数据没 id 时用完整 url 兜底。
    const keep = [];
    const removedTracks = [];
    for (const t of all) {
      const sameId = t && typeof t === "object" && (String(t.id ?? "") === id || String(t.url ?? "") === id);
      const sameList = !wantList || String(t?.list ?? "") === list;
      if (sameId && sameList) {
        removedTracks.push(t);
      } else {
        keep.push(t);
      }
    }

    if (!removedTracks.length) {
      return c.json({ ok: false, error: "not found" }, 404);
    }

    savePlaylistToDisk(keep);

    // 清文件：删掉的每一首都尝试；失败不影响列表变更（只在响应里记下来）。
    const deletedFiles = [];
    const failedFiles = [];
    for (const t of removedTracks) {
      const rawId = String(t.id ?? "");
      // 本地曲目的 id 就是 media 目录下的文件名。在线 id 含 ":"（server:metingId），不是文件。
      const isLocalFile = rawId && !rawId.includes(":") && isAudio(rawId);
      if (isLocalFile) {
        const safe = safeName(rawId);
        const p = path.join(mediaDir, safe);
        // 防目录穿越：只允许 media 目录内的简单文件名。
        if (safe === rawId && !safe.includes("/") && !safe.includes("\\") && !safe.includes("..") && fs.existsSync(p)) {
          try {
            fs.unlinkSync(p);
            deletedFiles.push(safe);
          } catch (err) {
            failedFiles.push({ file: safe, error: err?.message || String(err) });
          }
        }
      }
      // 歌词：离线库按曲名存（与 /widget/api/lrc/load|save 同一套命名）。
      const trackName = String(t.name ?? "").trim();
      if (trackName) {
        const lrcFile = lrcSafeName(trackName) + ".lrc";
        const lp = path.join(lyricsDir, lrcFile);
        if (fs.existsSync(lp)) {
          try {
            fs.unlinkSync(lp);
          } catch (err) {
            failedFiles.push({ file: lrcFile, error: err?.message || String(err) });
          }
        }
      }
    }

    return c.json({
      ok: true,
      removed: removedTracks.length,
      count: keep.length,
      deletedFiles,
      ...(failedFiles.length ? { failedFiles } : {}),
    });
  });

  // 队列的两个端点 v1 就是空实现 / 恒等返回，照搬即可。
  app.get("/widget/api/queue", (c) => c.json({ ok: true, tracks: [] }));
  app.post("/widget/api/queue", async (c) => c.json({ ok: true }));
  app.get("/widget/api/queue/diff", (c) => {
    const files = collectMediaFiles();
    return c.json({ added: files, removed: [] });
  });

  // ── 本地音频流 ──────────────────────────────────────────────
  //
  // 旧 UI 把播放列表里本地曲目的 url 直接喂给 <audio src>，所以这个端点必须
  // 支持 Range：没有它，拖动进度条和 Safari 类浏览器都不能分段取。
  // v1 用 TransformStream + 手写 streamPipe，这里改用 Readable.toWeb —— 同一个
  // Node 流，少一层手动转发，边界（end / error）由平台负责关。
  app.get("/widget/media/:filename", async (c) => {
    const filename = c.req.param("filename");
    if (filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
      return c.json({ error: "invalid filename" }, 400);
    }

    const filePath = path.join(mediaDir, filename);
    if (!fs.existsSync(filePath)) return c.json({ error: "not found" }, 404);

    const stat = fs.statSync(filePath);
    const mime = MIME[path.extname(filename).slice(1).toLowerCase()] || "audio/mpeg";
    const total = stat.size;
    const range = c.req.header("range");

    if (range) {
      const match = range.match(/^bytes=(\d+)-(\d*)$/);
      if (!match) return c.text("Invalid Range", 416);
      const start = parseInt(match[1], 10);
      const end = match[2] !== "" ? parseInt(match[2], 10) : total - 1;
      if (start >= total || end >= total) return c.text("Range Not Satisfiable", 416);

      const part = fs.createReadStream(filePath, { start, end });
      return new Response(Readable.toWeb(part), {
        status: 206,
        headers: {
          "Content-Type": mime,
          "Content-Range": `bytes ${start}-${end}/${total}`,
          "Content-Length": String(end - start + 1),
          "Accept-Ranges": "bytes",
          "Cache-Control": "public, max-age=86400",
        },
      });
    }

    return new Response(Readable.toWeb(fs.createReadStream(filePath)), {
      status: 200,
      headers: {
        "Content-Type": mime,
        "Content-Length": String(total),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=86400",
      },
    });
  });
}
