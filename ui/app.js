/* ============================================================
   Hana 极简播放器 · 生产 UI
   纯原生 JS：真 <audio> 驱动、后端路由拉真数据、记忆走 hana.storage.global
   主题只消费宿主 hana.theme（不定义同名变量）
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);
  var SHOT = params.get('shot') === '1';
  if (SHOT) document.body.classList.add('is-shot');

  /* ---------- 卡片鉴权 ----------
   * App 卡片的 iframe URL 带 `appSurfaceSession`。后端路由（/api/apps/<id>/routes/...）
   * 靠它鉴权 —— 宿主**不**给页面注入 cookie、也不替页面加头，必须自己带上。
   * fetch 走 header（`X-Hana-App-Surface-Session`，与旧 UI 同路）；
   * <audio>/封面这类改不了头的，走 query（宿主两种都认）。
   * 票只在发请求时贴，存进 playlist.json 的永远是干净 URL。 */
  var SURFACE_SESSION = params.get('appSurfaceSession') || '';
  var SESSION_HEADER = 'X-Hana-App-Surface-Session';
  function sameOrigin(url) {
    try { return new URL(url, location.href).origin === location.origin; }
    catch (e) { return url.charAt(0) === '/'; }
  }
  function withSession(url) {
    if (!SURFACE_SESSION || !url) return url;
    if (url.indexOf('appSurfaceSession=') >= 0) return url;
    if (!sameOrigin(url)) return url;
    return url + (url.indexOf('?') > -1 ? '&' : '?') + 'appSurfaceSession=' + encodeURIComponent(SURFACE_SESSION);
  }
  function apiFetch(url, init) {
    init = init || {};
    if (SURFACE_SESSION) {
      var h = new Headers(init.headers || {});
      if (!h.has(SESSION_HEADER)) h.set(SESSION_HEADER, SURFACE_SESSION);
      init.headers = h;
    }
    return fetch(url, init);
  }

  /* ---------- 后端 ----------
   * 页面由宿主从 /api/apps/<id>/ui/ 下发，路由挂在 /api/apps/<id>/routes/ 下：
   * 同源相对路径，plain fetch 即可（与旧 UI 一致，不需要 surface session）。 */
  var API = (function () {
    var m = /^\/api\/apps\/([^/]+)\/ui(?:\/|$)/.exec(location.pathname || '');
    return m ? '/api/apps/' + m[1] + '/routes' : '/api/apps/hanako-audio-player/routes';
  })();

  var ENDPOINT = {
    playlist: API + '/widget/api/playlist',
    track: API + '/api/track',
    nowPlaying: API + '/api/now-playing',
    lrcLoad: API + '/widget/api/lrc/load',
    lrcSave: API + '/widget/api/lrc/save',
    musicLrc: API + '/widget/api/music/lrc',
    lrcProxy: API + '/widget/api/music/lrc-proxy',
    ttml: API + '/widget/api/music/ttml',
    song: API + '/widget/api/music/song',
    musicPlaylist: API + '/widget/api/music/playlist',
    search: API + '/widget/api/music/search',
    importFile: API + '/widget/api/import-file',
    scanFolder: API + '/widget/api/scan-folder',
    playbackState: API + '/api/playback-state'
  };

  function apiJson(url, init) {
    return apiFetch(url, init).then(function (r) {
      return r.text().then(function (txt) {
        var body = null;
        try { body = txt ? JSON.parse(txt) : null; } catch (e) { body = null; }
        return { ok: r.ok, status: r.status, body: body };
      });
    });
  }
  function apiGetJson(url) { return apiJson(url, { cache: 'no-store' }); }
  function apiPostJson(url, data) {
    return apiJson(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data)
    });
  }
  function apiDeleteJson(url) { return apiJson(url, { method: 'DELETE' }); }
  function apiText(url) {
    return apiFetch(url, { cache: 'no-store' }).then(function (r) {
      return r.text().then(function (txt) { return { ok: r.ok, status: r.status, text: txt }; });
    });
  }

  var MODES = [
    { key: 'list', label: '列表循环', icon: 'i-repeat' },
    { key: 'one', label: '单曲循环', icon: 'i-repeat-one' },
    { key: 'shuffle', label: '随机播放', icon: 'i-shuffle' }
  ];

  /* ---------- 曲目对象 ----------
   * 接口约定：{ id, name, url, mode, dur, group, pic? }，在线导入时 author 另存。
   * id：本地 = 文件名（含扩展名）；在线 = `server:metingId`。
   * 老数据没有 id 时自己派生稳定键（不能不给——后端按稳定 id 去重，
   * 空 id 会把几条无 url 的老条目并成一条，那是数据损失）。 */
  function deriveId(t, url) {
    var id = String(t.id || '').trim();
    if (id) return id;
    var mg = /\/widget\/media\/([^/?#]+)/.exec(url);
    if (mg) return decodeURIComponent(mg[1]);
    var go = /\/music\/go\/([A-Za-z0-9_-]+)(?:\?[^#]*)?/.exec(url);
    var server = /[?&]server=([^&#]+)/.exec(url);
    if (go) return (server ? decodeURIComponent(server[1]) : 'netease') + ':' + go[1];
    var qid = /[?&]id=([^&#]+)/.exec(url);
    if (qid && server) return decodeURIComponent(server[1]) + ':' + decodeURIComponent(qid[1]);
    /* 旧版导入的「在线」曲目只有搜索词（searchKey），没有 url/id。
     * 给它一个稳定的 search: 键，别用歌名（同名会互相覆盖）。 */
    if (t.searchKey) return 'search:' + String(t.searchKey).trim();
    return 'name:' + String(t.name || t.title || '').trim();
  }

  /* 归属列表：'local' = 本地（固定文件夹），'imp:N' = 第 N 个导入歌单。
   * 同一首歌可以同时存在于多个列表 —— 稳定 id 会重复，所以列表内定位一律用
   * uid = `list|id`（见 uidOf），不能用裸 id。 */
  function listOf(t) { return String((t && t.list) || '').trim(); }
  function uidOf(t) { return listOf(t) + '|' + String((t && t.id) || ''); }

  function normalizeTrack(raw) {
    var t = raw && typeof raw === 'object' ? raw : {};
    var url = String(t.url || '');
    var mode = t.mode === '在线' ? '在线' : (t.mode === '本地' ? '本地' : (t.group === '在线音乐' ? '在线' : '本地'));
    var title = String(t.name || t.title || '').trim() || '未命名';
    var author = String(t.author || '').trim();
    var id = deriveId(t, url);
    var list = listOf(t);
    return {
      id: id,
      list: list,
      uid: list + '|' + id,
      title: title,
      /* 只放真歌手（author）：拿不到就空。绝不用 group 冒充（来源重做）。 */
      artist: author,
      author: author,
      url: url,
      source: mode === '在线' ? 'online' : 'local',
      mode: mode,
      group: String(t.group || '').trim(),
      pic: String(t.pic || '').trim(),
      lrcUrl: String(t.lrcUrl || t.lrc || '').trim(),
      dur: Number(t.dur) > 0 ? Number(t.dur) : 0,
      raw: t
    };
  }

  /* 回写形状：保留未识别字段（后端去重会合并同 id 的补充信息，别丢） */
  function toStoredTrack(t) {
    var out = {};
    var k;
    for (k in t.raw) if (Object.prototype.hasOwnProperty.call(t.raw, k)) out[k] = t.raw[k];
    out.id = t.id;
    out.list = t.list;
    out.name = t.title;
    out.url = t.url;
    out.mode = t.mode;
    out.dur = t.dur || 0;
    out.group = t.group;
    if (t.author) out.author = t.author; else delete out.author;
    if (t.pic) out.pic = t.pic; else delete out.pic;
    if (t.lrcUrl) out.lrcUrl = t.lrcUrl; else delete out.lrcUrl;
    delete out.title;
    delete out.lrc;
    return out;
  }

  /* ---------- 状态（接口约定的 playback-state 字段） ---------- */
  var state = {
    tracks: [],
    lists: [],          // [{ id:'local'|'fav'|'imp:N', name }]，顺序即顶部切换条顺序
    activeList: 'fav',  // 全新会话默认落在「我的喜欢」（它排切换条最前，当首页）
    localDir: '',       // 本地固定文件夹绝对路径（空 = 没设过）
    currentUid: '',
    progress: 0,
    volume: 0.8,
    muted: false,
    mode: 'list',
    playing: false,
    needsResume: false, // 自动播放被拦时的「继续播放」引导
    follow: true,
    page: 'play',
    drawer: false,
    splitRatio: 0.62,   // 长卡：舞台占比（可拖分隔线），默认 62%
    lyricLines: [],
    loadError: ''
  };

  /* ---------- 记忆：播放状态走后端路由，歌单元数据走 hana.storage.global ----------
   * 播放状态改后端路由的原因（拖进/拖出 bug）：hana.storage.global.set 是异步 IPC，
   * 页面卸载时可能来不及发出；而「拖进/拖出 = 整份文档被换掉」需要旧文档在 pagehide
   * 时把快照可靠地交给宿主。后端路由可以用 sendBeacon / keepalive fetch，专为卸载时
   * 发一次请求设计，能跨文档存活。快照落 app-data/playback.json。
   * 歌单元数据（顺序 + 名字）与本地文件夹路径仍走 hana.storage.global，它们不涉及卸载竞速。 */
  function hanaStorage() {
    return (window.hana && window.hana.storage && window.hana.storage.global) || null;
  }
  function unwrapStored(v) {
    if (v && typeof v === 'object' && !Array.isArray(v) && ('value' in v)) return v.value;
    return v;
  }
  function snapshot() {
    return {
      currentId: state.currentUid,
      activeList: state.activeList,
      progress: Math.round(state.progress * 10) / 10,
      volume: state.volume,
      muted: !!state.muted,
      mode: state.mode,
      playing: !!state.playing,
      /* 随机模式的来路：拖进/拖出会整份换文档，不落盘就丢了 */
      shuffleTrail: shuffleTrail.slice(-SHUFFLE_TRAIL_MAX)
    };
  }

  /* 常规写入：串行链 + 节流；切歌/暂停/导入/删除走立即写 */
  var writeChain = Promise.resolve();
  var writeTimer = 0;
  function persistNow() {
    clearTimeout(writeTimer);
    var snap = snapshot();
    writeChain = writeChain.then(function () {
      return apiPostJson(ENDPOINT.playbackState, snap).then(function (res) {
        if (!res.ok) console.warn('[player] playback-state 写入失败', res.status);
      }).catch(function (e) {
        console.warn('[player] playback-state 写入异常', e);
      });
    });
    return writeChain;
  }
  function persistThrottled() {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(persistNow, 900);
  }
  function persistState() { persistThrottled(); }

  /* 卸载落盘：sendBeacon（首选）→ keepalive fetch（兜底）。
   * 票走 query（同 withSession 口径，宿主 header/query 两种都认）。 */
  function beaconPlayback() {
    var snap = snapshot();
    var url = withSession(ENDPOINT.playbackState);
    var body = JSON.stringify(snap);
    try {
      if (navigator.sendBeacon) {
        var blob = new Blob([body], { type: 'application/json' });
        if (navigator.sendBeacon(url, blob)) return true;
      }
    } catch (e) { /* 落到 keepalive fetch */ }
    try {
      apiFetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: body,
        keepalive: true
      });
      return true;
    } catch (e) { /* 都不行就算了 */ }
    return false;
  }

  function loadPlaybackState() {
    return apiGetJson(ENDPOINT.playbackState).then(function (res) {
      if (res.ok && res.body && res.body.ok && res.body.state && typeof res.body.state === 'object') {
        return res.body.state;
      }
      return null;
    }).catch(function () { return null; });
  }

  /* ---------- 歌单：列表元数据 + 本地固定文件夹 ----------
   * 列表元数据（顺序 + 原始名）与本地文件夹路径都存 hana.storage.global；
   * 曲目本身仍写在 playlist.json（每条带 list 字段）。
   * 宿主存储不可用时（纯浏览器 / 无宿主 / 卡在 SDK 落地前）退化为内存态：
   * 功能照常，只是不跨重启。绝不写 localStorage（契约）。 */
  var LISTS_KEY = 'player-lists';
  var LOCALDIR_KEY = 'player-local-dir';
  var memStore = {};

  /* 读存储，返回 { ok, value }：ok=false 表示这次**没读到**（宿主未就绪 / 超时 / 报错）。
   * 存储走宿主桥（v2 应用态存储经宿主代调 server），刚 reload 时桥可能还没应答，
   * 所以超时给宽（5s）；调用方据此避免拿「默认值」覆盖盘上的真实数据。 */
  function storeRead(key) {
    var st = hanaStorage();
    var fallback = Object.prototype.hasOwnProperty.call(memStore, key) ? memStore[key] : null;
    if (!st) return Promise.resolve({ ok: false, value: fallback });
    return Promise.resolve(st.get(key, { timeoutMs: 5000 })).then(function (raw) {
      var v = unwrapStored(raw);
      if (v !== null && v !== undefined) memStore[key] = v;
      return { ok: true, value: v === undefined ? null : v };
    }).catch(function () { return { ok: false, value: fallback }; });
  }
  function storeGet(key) {
    return storeRead(key).then(function (r) { return r.value; });
  }
  function storeSet(key, value) {
    memStore[key] = value;
    var st = hanaStorage();
    if (!st) return Promise.resolve();
    return Promise.resolve(st.set(key, value)).catch(function (e) {
      console.warn('[player] ' + key + ' 写入失败', e);
    });
  }

  function findList(id) {
    for (var i = 0; i < state.lists.length; i++) if (state.lists[i].id === id) return state.lists[i];
    return null;
  }
  function ensureList(id, name) {
    var l = findList(id);
    if (!l) { l = { id: id, name: name || id }; state.lists.push(l); }
    else if (name && !l.name) l.name = name;
    return l;
  }
  function listNum(id) {
    var m = /^imp:(\d+)$/.exec(String(id || ''));
    return m ? parseInt(m[1], 10) : 999999;
  }
  /* 没有保存名字时的默认显示名（元数据丢失时用，避免标题显示 imp:1） */
  function defaultListName(id) {
    if (id === 'fav') return '我的喜欢';
    if (id === 'local') return '本地';
    var m = /^imp:(\d+)$/.exec(String(id || ''));
    return m ? '歌单 ' + m[1] : String(id || '');
  }

  /* 歌单名压缩（切换条展示用）：罐头歌单叫「Can_0201喜欢的音乐」→ 显示「Can_0201」。
   * 规则可预期：先去掉「喜欢的音乐 / 的歌单 / 歌单」这类后缀，标点归一，
   * 仍超过 8 字就截断加省略号。完整名放 title 悬停。自动名「歌单 3」归一成编号。 */
  function compressListName(name) {
    var raw = String(name == null ? '' : name).trim();
    if (!raw) return '';
    var auto = /^(?:歌单|单曲|本地文件)\s+(\d+)$/.exec(raw);
    if (auto) return auto[1];
    var s = raw.replace(/\s*(?:的)?(?:喜欢的音乐|喜欢的歌曲|喜欢的歌|喜欢的单曲|的歌单|歌单)$/, '').trim();
    if (!s) s = raw;
    s = s.replace(/[，、]/g, ',').replace(/[。]/g, '.').replace(/[：]/g, ':').replace(/\s+/g, ' ').trim();
    if (s.length > 8) s = s.slice(0, 8) + '…';
    return s;
  }

  /* 切换条上显示的列表名：我的喜欢 / 本地固定；导入歌单走压缩名，没有名字退编号。 */
  function listDisplayName(l) {
    if (!l) return '';
    if (l.id === 'fav') return '我的喜欢';
    if (l.id === 'local') return '本地';
    var name = String(l.name || '').trim();
    var shown = compressListName(name);
    if (shown) return shown;
    return String(l.id || '').replace(/^imp:/, '');
  }

  /* 曲目的「来源」名 = 它所属列表的名字（本地 →「本地」）。列表没了就退回默认名。 */
  function sourceName(t) {
    var id = listOf(t);
    var l = findList(id);
    if (l && l.name) return l.name;
    if (id === 'local') return '本地';
    if (id) return defaultListName(id);
    return t.mode === '在线' ? '在线' : '本地';
  }
  function nextImportId() {
    var max = 0;
    for (var i = 0; i < state.lists.length; i++) {
      var m = /^imp:(\d+)$/.exec(state.lists[i].id);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
    return 'imp:' + (max + 1);
  }
  function saveLists() { storeSet(LISTS_KEY, state.lists); }

  /* ---------- 我的喜欢（fav 固定列表）----------
   * 判定用**稳定 id**（不是 uid）：同一首歌在不同列表里 uid 不同，用 uid 判会
   * 出现「在原歌单点过心、切到我的喜欢里心是灭的」。
   * 加入 = 在 fav 列表里放一份副本；取消 = 只摘掉 fav 那份，原歌单纹丝不动。
   * 这沿用了现有约定：同一首歌可同时存在于多个列表。 */
  function favEntryOf(stableId) {
    var id = String(stableId || '').trim();
    if (!id) return null;
    for (var i = 0; i < state.tracks.length; i++) {
      var t = state.tracks[i];
      if (t.list === 'fav' && t.id === id) return t;
    }
    return null;
  }
  function isFav(stableId) { return !!favEntryOf(stableId); }

  function findAnyById(stableId) {
    var id = String(stableId || '').trim();
    for (var i = 0; i < state.tracks.length; i++) {
      if (state.tracks[i].id === id) return state.tracks[i];
    }
    return null;
  }

  function addFav(stableId) {
    if (favEntryOf(stableId)) return true;
    var src = findAnyById(stableId);
    if (!src) return false;
    ensureList('fav', '我的喜欢');
    var stored = toStoredTrack(src);   // 借用回写形状，保住 pic/author/lrcUrl/raw 补充字段
    stored.list = 'fav';
    state.tracks.push(normalizeTrack(stored));
    savePlaylist();
    return true;
  }

  /* 取消喜欢。若正在播的恰好是 fav 里那份副本，不能直接掋掉指针：
   *  · 原歌单/其他列表里有同一首歌 → 把播放指针转过去（无缝，不打断）；
   *  · 确实没有别的副本 → 打 detached（只够播完当前这首，不回写盘，
   *    下次启动不会把「我的喜欢」里已取消的那首重建）。 */
  function removeFav(stableId) {
    var id = String(stableId || '').trim();
    if (!id) return false;
    var playingEntry = null;
    state.tracks = state.tracks.filter(function (t) {
      if (!(t.list === 'fav' && t.id === id)) return true;
      if (t.uid === state.currentUid) { playingEntry = t; return true; }   // 暂留
      return false;
    });
    if (playingEntry) {
      var alt = null;
      for (var i = 0; i < state.tracks.length; i++) {
        var x = state.tracks[i];
        if (x.id === id && x.uid !== playingEntry.uid) { alt = x; break; }
      }
      if (alt) {
        state.currentUid = alt.uid;
        state.tracks = state.tracks.filter(function (t) { return t.uid !== playingEntry.uid; });
      } else {
        playingEntry.detached = true;
      }
    }
    savePlaylist();
    return false;
  }

  /* 切换喜欢。返回切换后的状态。 */
  function toggleFav(stableId) {
    if (isFav(stableId)) return removeFav(stableId);
    return addFav(stableId);
  }

  /* 把一颗红心按当前状态刷成「亮/灭」。按钮可复用（队列行、播放页各一个）。 */
  function paintFav(btn, t) {
    if (!btn) return;
    var on = !!(t && isFav(t.id));
    btn.classList.toggle('is-on', on);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    var label = on ? '取消喜欢' : '加入我的喜欢';
    btn.setAttribute('aria-label', label);
    btn.title = label;
  }

  /* 每个列表内按 uid 去重（跨列表不去重 —— 同一首歌在两个歌单里是合理的）。
   * 保留首次出现的位置，后出现的同 uid 项并入（补齐 pic/author 之类）。 */
  function dedupeWithinLists(tracks) {
    var seen = {};
    var out = [];
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      if (!t.uid) t.uid = uidOf(t);
      if (seen[t.uid] !== undefined) { out[seen[t.uid]] = t; continue; }
      seen[t.uid] = out.length;
      out.push(t);
    }
    tracks.length = 0;
    for (var j = 0; j < out.length; j++) tracks.push(out[j]);
  }

  /* 旧数据迁移（幂等）：
   *  · 本地列表 = 严格等于那个固定文件夹（拍板），所以旧数据不再往 local 塞；
   *    一律按原 group 各自成一个导入列表，按首次出现顺序编 1/2/3…
   *  · group 缺失 → "未分类"
   *  · 每个列表内按稳定 id 去重；跨列表不去重
   *  · 已经带 list 字段的数据原样保留，再跑一次不改变结构
   * 返回是否真正改写了曲目（需要回写 playlist.json）。 */
  function migrateLists(tracks, savedLists) {
    var i, t;
    var needsAssign = false;
    for (i = 0; i < tracks.length; i++) {
      if (!String(tracks[i].list || '').trim()) { needsAssign = true; break; }
    }

    /* 「我的喜欢」是固定列表：任何迁移路径下都保证它在，且不可删/不可重命名。
     * 它排在排序函数的第一位（见下），所以这里只需确保存在。 */
    if (needsAssign) {
      var groupToId = {};
      var ordered = [];
      var seq = 0;
      for (i = 0; i < tracks.length; i++) {
        t = tracks[i];
        var list = String(t.list || '').trim();
        if (!list) {
          var g = String(t.group || '').trim() || '未分类';
          if (!groupToId[g]) { seq++; groupToId[g] = { id: 'imp:' + seq, name: g }; ordered.push(groupToId[g]); }
          list = groupToId[g].id;
        }
        t.list = list;
        t.uid = uidOf(t);
      }
      state.lists = [{ id: 'local', name: '本地' }];
      for (i = 0; i < ordered.length; i++) state.lists.push(ordered[i]);
    } else {
      state.lists = [];
      ensureList('local', '本地');
      if (savedLists && savedLists.length) {
        for (i = 0; i < savedLists.length; i++) {
          var s = savedLists[i];
          if (s && s.id && s.id !== 'local') ensureList(String(s.id), String(s.name || s.id));
        }
      }
      for (i = 0; i < tracks.length; i++) {
        t = tracks[i];
        if (t.list && t.list !== 'local') ensureList(t.list, defaultListName(t.list));
        t.uid = uidOf(t);
      }
    }

    dedupeWithinLists(tracks);
    ensureList('fav', '我的喜欢');   // 固定列表，永不缺位
    /* 切换条顺序：我的喜欢 → 本地 → 导入歌单（imp:N 按编号）。 */
    var listRank = function (id) { return id === 'fav' ? 0 : (id === 'local' ? 1 : 2); };
    state.lists.sort(function (a, b) {
      var ra = listRank(a.id), rb = listRank(b.id);
      if (ra !== rb) return ra - rb;
      if (ra === 2) return listNum(a.id) - listNum(b.id);
      return 0;
    });
    return needsAssign;
  }

  /* SDK 是 ES module，可能比本脚本晚落地；宿主没给就走无宿主降级（不留 localStorage） */
  function waitForHana(timeoutMs) {
    return new Promise(function (resolve) {
      if (window.hana) return resolve(true);
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(false); } }, timeoutMs);
      window.addEventListener('hana-sdk-ready', function () {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  /* ---------- 播放列表：读写都走后端（与工具侧共用 playlist.json） ---------- */
  function loadPlaylist() {
    return apiGetJson(ENDPOINT.playlist).then(function (res) {
      if (!res.ok || !res.body || !Array.isArray(res.body.tracks)) {
        throw new Error('playlist 接口异常 ' + res.status);
      }
      return res.body.tracks.map(normalizeTrack);
    });
  }

  var saveChain = Promise.resolve();
  function savePlaylist() {
    /* detached 曲目（删列表时被豁免、只为播完当前那首的运行时条目）不回写盘：
     * 否则下次启动会按它的 list 把已删列表重建出来。 */
    var payload = { tracks: state.tracks.filter(function (t) { return !t.detached; }).map(toStoredTrack) };
    saveChain = saveChain.then(function () {
      return apiPostJson(ENDPOINT.playlist, payload).then(function (res) {
        if (!res.ok) console.warn('[player] playlist 写入失败', res.status);
        return res;
      });
    }).catch(function (e) {
      console.warn('[player] playlist 写入异常', e);
    });
    return saveChain;
  }

  /* 把新曲目并入指定列表（按 uid 去重，保留原位置；同 uid 覆盖补充信息）。
   * 返回真正新增的条数。 */
  function mergeTracks(incoming, listId) {
    var index = {};
    var i;
    for (i = 0; i < state.tracks.length; i++) index[state.tracks[i].uid] = i;
    var added = 0;
    for (i = 0; i < incoming.length; i++) {
      var t = normalizeTrack(incoming[i]);
      t.list = listId;
      t.uid = uidOf(t);
      if (index[t.uid] !== undefined) {
        state.tracks[index[t.uid]] = t;
      } else {
        index[t.uid] = state.tracks.length;
        state.tracks.push(t);
        added++;
      }
    }
    return added;
  }

  /* ---------- 元素 ---------- */
  var frame = $('frame');
  var player = $('player');
  var sceneTop = $('sceneTop');
  var queue = $('queue');
  var queueHead = $('queueHead');
  var listTabs = $('listTabs');
  var queueList = $('queueList');
  var lyrics = $('lyrics');
  var lyricWrap = $('lyricWrap');
  var lyricScrim = $('lyricScrim');
  var drawerScrim = $('drawerScrim');
  var seek = $('seek');
  var vol = $('vol');
  var toastEl = $('toast');
  var audio = $('audio');

  /* ---------- 工具 ---------- */
  function icon(id, cls) {
    return '<svg class="icon ' + (cls || '') + '" aria-hidden="true"><use href="#' + id + '"></use></svg>';
  }
  function fmtTime(s) {
    s = Math.max(0, Math.round(s));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  }
  function visibleTracks() {
    var out = [];
    for (var i = 0; i < state.tracks.length; i++) {
      if (state.tracks[i].list === state.activeList) out.push(state.tracks[i]);
    }
    return out;
  }
  function trackByUid(uid) {
    if (!uid) return null;
    for (var i = 0; i < state.tracks.length; i++) {
      if (state.tracks[i].uid === uid) return state.tracks[i];
    }
    return null;
  }
  function currentTrack() {
    var t = trackByUid(state.currentUid);
    if (t) return t;
    var vis = visibleTracks();
    return vis[0] || state.tracks[0] || null;
  }
  function currentIndex() {
    var vis = visibleTracks();
    for (var i = 0; i < vis.length; i++) {
      if (vis[i].uid === state.currentUid) return i;
    }
    return -1;
  }
  /* 时长：优先拿真实 <audio> 的（本地/在线都可能比列表里存的准） */
  function trackDuration(t) {
    if (!t) return 0;
    if (t.uid === state.currentUid && isFinite(audio.duration) && audio.duration > 0) return audio.duration;
    return Number(t.dur) > 0 ? Number(t.dur) : 0;
  }
  var toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2600);
  }
  /* 真实歌名里会有引号/尖括号，进 innerHTML 前必须转义 */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  /* 封面：有 pic 就用在线封面，没有（或加载失败）就露兜底渐变 */
  function coverImage(url) {
    return url ? 'url(' + JSON.stringify(withSession(url)) + '), var(--cover-fallback)' : 'var(--cover-fallback)';
  }
  /* 舞台封面专用：不叠兜底层 —— contain 的留白要让底下的环境色透出来，
   * 而不是盖一块纸（队列行的小封面仍用 coverImage，那里留白小、叠兜底更稳）。 */
  function coverStageImage(url) {
    return url ? 'url(' + JSON.stringify(withSession(url)) + ')' : 'var(--cover-fallback)';
  }
  function coverUrlOnly(url) {
    return url ? 'url(' + JSON.stringify(withSession(url)) + ')' : 'none';
  }

  /* ============================================================
     封面主色调（背景色来源）
     网易式：右列（歌词那侧）铺一层「封面主色调」平色，封面右缘淡出融进去。
     —— 不再用「封面模糊照片」当底（照片里的集中色会被糊成一坨暖块）。
     做法：整图降采样 → 4bit 量化统计 → 取占比最多的色（跳过近中性，
     没有才退回全图最多）。同时算亮度定字色极性 data-ambient。
     封面带 CORS，canvas 取像素不 taint；非 CORS / 解码失败静默退回主题极性。
     ============================================================ */
  var coverAR = 0;             // 封面画幅比（只读自然尺寸，不碰 canvas）
  var coverProbeToken = 0;     // 切歌竞态：过期结果丢弃
  var ambientCache = {};       // pic → { color, polarity }（或 null=失败）
  var stagePic = '';           // 当前舞台封面

  function lumOf(c) {
    function ch(v) { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }
    return 0.2126 * ch(c[0]) + 0.7152 * ch(c[1]) + 0.0722 * ch(c[2]);
  }

  /* RGB → HSL（h 0~360, s/l 0~1）。 */
  function toHsl(c) {
    var r = c[0] / 255, g = c[1] / 255, b = c[2] / 255;
    var mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    var h = 0, s = 0, l = (mx + mn) / 2;
    if (d > 1e-6) {
      s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
      if (mx === r) h = ((g - b) / d + (g < b ? 6 : 0));
      else if (mx === g) h = (b - r) / d + 2;
      else h = (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  /* HSL → RGB。 */
  function fromHsl(h, s, l) {
    h = ((h % 360) + 360) % 360;
    function f(n) {
      var k = (n + h / 30) % 12;
      var a = s * Math.min(l, 1 - l);
      return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    }
    return [f(0), f(8), f(4)];
  }
  /* 背景撞色：取主色的互补色相（转 150° 附近，够撞但不髿），
   * 再按极性定亮度 —— 深纱上提亮、浅纱上压深，保证在纱上可读。
   * 输入主色 + 'light'/'dark'（当前极性）。 */
  function accentFrom(color, polarity) {
    var hsl = toHsl(color);
    var h = hsl[0] + 150;                       // 互补偏一点，避开刺眼的纯 180
    var s = Math.max(0.42, Math.min(0.72, hsl[1] * 0.9 + 0.22)); // 保底彩度
    var l = polarity === 'dark' ? 0.72 : 0.40;  // 深纱亮、浅纱暗
    return fromHsl(h, s, l);
  }
  function rgbStr(c) { return 'rgb(' + c[0] + ',' + c[1] + ',' + c[2] + ')'; }

  /* 占比最多的色（4bit/通道量化）。近中性色（灰/黑/白）降权，优先取有彩的：
   * 纯灰底当背景平淡，封面里的彩才是「主色调」的观感来源。 */
  function dominantColor(data, w, h) {
    var buckets = {};
    for (var i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue;
      var r = data[i], g = data[i + 1], b = data[i + 2];
      var key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
      var bk = buckets[key] || (buckets[key] = { n: 0, r: 0, g: 0, b: 0 });
      bk.n++; bk.r += r; bk.g += g; bk.b += b;
    }
    var best = null, bestColored = null;
    for (var k in buckets) {
      if (!Object.prototype.hasOwnProperty.call(buckets, k)) continue;
      var x = buckets[k];
      var avg = [Math.round(x.r / x.n), Math.round(x.g / x.n), Math.round(x.b / x.n)];
      var mx = Math.max(avg[0], avg[1], avg[2]), mn = Math.min(avg[0], avg[1], avg[2]);
      var sat = mx === 0 ? 0 : (mx - mn) / mx;
      if (!best || x.n > best.n) best = { n: x.n, c: avg };
      if (sat >= 0.14 && (!bestColored || x.n > bestColored.n)) bestColored = { n: x.n, c: avg };
    }
    return bestColored ? bestColored.c : (best ? best.c : null);
  }

  /* 平面主色下选字色极性：哪种纱（浅纱墨字 / 深纱纸字）在该底色上对比度更高。 */
  function polarityFor(color) {
    var cs = getComputedStyle(document.documentElement);
    function hex(s) {
      var m = /^#([0-9a-f]{6})$/i.exec(String(s).trim());
      if (!m) return null;
      var v = parseInt(m[1], 16);
      return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
    }
    function ratio(a, b) {
      var la = lumOf(a), lb = lumOf(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    }
    function over(fg, bg, a) { return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)]; }
    var sets = [
      { key: 'light', veil: hex(cs.getPropertyValue('--veil-paper')), text: hex(cs.getPropertyValue('--on-veil-ink')), a: parseFloat(cs.getPropertyValue('--veil-paper-a')) },
      { key: 'dark', veil: hex(cs.getPropertyValue('--veil-ink')), text: hex(cs.getPropertyValue('--on-veil-paper')), a: parseFloat(cs.getPropertyValue('--veil-ink-a')) }
    ];
    var best = null;
    for (var i = 0; i < sets.length; i++) {
      var s = sets[i];
      if (!s.veil || !s.text || !(s.a > 0)) continue;
      var bg = over(s.veil, color, s.a);
      var ct = ratio(s.text, bg);
      if (!best || ct > best.ct) best = { key: s.key, ct: ct };
    }
    return best ? best.key : (lumOf(color) > 0.45 ? 'light' : 'dark');
  }

  function themePolarity() {
    var t = document.documentElement.getAttribute('data-theme');
    if (t === 'dark' || t === 'light') return t;
    try { return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; }
    catch (e) { return 'light'; }
  }

  function applyAmbient(res) {
    if (!res || !res.color) {
      /* 取色失败 / 无封面：撤掉主色底，退回主题纸面；字色跟主题 */
      player.style.removeProperty('--ambient-color');
      player.style.removeProperty('--ambient-accent');
      player.classList.remove('ambient-ok');
      player.setAttribute('data-ambient', player.classList.contains('nocover') ? 'none' : themePolarity());
      return;
    }
    player.style.setProperty('--ambient-color', rgbStr(res.color));
    /* 当前句高亮：用背景撞色（互补色相 + 按极性定亮度），不跟随主题强调色 */
    player.style.setProperty('--ambient-accent', rgbStr(accentFrom(res.color, res.polarity)));
    player.classList.add('ambient-ok');
    player.setAttribute('data-ambient', res.polarity);
  }

  /* 取色还没回来时的临时态：先按主题极性亮字，出结果再校正 */
  function applyAmbientPending() {
    if (!player.classList.contains('nocover')) player.setAttribute('data-ambient', themePolarity());
  }

  /* 取色用小图：网易云封面支持 ?param=100y100（约 25KB），省流量也快 */
  function ambientUrl(url) {
    var u = withSession(url);
    if (/\.music\.126\.net/.test(u) && u.indexOf('param=') < 0) {
      u += (u.indexOf('?') > -1 ? '&' : '?') + 'param=100y100';
    }
    return u;
  }

  /* 取封面主色调（与画幅探测分开：非 CORS 封面也要量得出画幅） */
  function probeAmbient(pic, token) {
    if (Object.prototype.hasOwnProperty.call(ambientCache, pic)) {
      applyAmbient(ambientCache[pic]);
      return;
    }
    var img = new Image();
    var settled = false;
    function done(res) {
      if (settled) return;
      settled = true;
      ambientCache[pic] = res || null;
      if (token !== coverProbeToken) return;
      applyAmbient(res);
    }
    img.crossOrigin = 'anonymous';
    img.onload = function () {
      try {
        var SW = 40, SH = 40;
        var cv = document.createElement('canvas');
        cv.width = SW; cv.height = SH;
        var ctx = cv.getContext('2d');
        ctx.drawImage(img, 0, 0, SW, SH);
        var data = ctx.getImageData(0, 0, SW, SH).data;
        var color = dominantColor(data, SW, SH);
        done(color ? { color: color, polarity: polarityFor(color) } : null);
      } catch (e) {
        /* 非 CORS 封面 / 解码失败 / getImageData 抛 SecurityError → 静默退回 */
        done(null);
      }
    };
    img.onerror = function () { done(null); };
    img.src = ambientUrl(pic);
  }

  /* 舞台指标（纯呈现）：封面锚定「左/上/下」三边、满高贴左；
   * 宽度 = 舞台高 × 画幅比（方图就是方的），溢出交给 scene 裁。
   * 过渡：封面右缘与歌词底层共用同一个「接缝」--seam 和「带宽」--band，
   * 在一个水平带里做镜像 alpha mask（网易式）——两边严丝合缝交汇。 */
  function updateStageMetrics() {
    var sceneEl = $('scene');
    if (!sceneEl) return;
    var w = sceneEl.clientWidth;
    var h = sceneEl.clientHeight;
    if (!(w > 0) || !(h > 0)) return;
    var ar = coverAR > 0 ? coverAR : 1;
    var coverW = Math.max(96, h * ar);
    /* 带宽：跟舞台宽走，夹在 120~220 */
    var band = Math.max(120, Math.min(220, w * 0.19));
    /* 接缝：淡出带末端（seam+band/2）必须收在封面右缘内 —— 否则封面 mask 走到
     * 元素边界还没淡完，就会被硬切一刀（那条接缝）。留 8px 余量，末端落在封面宽
     * 的 ~94% 处（与高手做法一致：淡出在封面内部就结束，末尾一段全透）。 */
    var seam = coverW - band * 0.5 - 8;
    /* 但也不能太靠左：夹在舞台宽的 32%~58% */
    seam = Math.max(w * 0.32, Math.min(seam, w * 0.58));
    /* 歌词列起点：宽窗下跟随面板宽度线性右移（网易式：右缘锚定，左缘占面板宽的比
   * 随宽度缓慢上升）—— 封面固定三边、不跟随；窄卡仍叠进过渡带，与封面右缘重叠。
   * 线性系数由网易两档实测反推：911px→0.513、1253px→0.526。 */
    var contentX;
    if (player.getAttribute('data-layout') === 'wide') {
      var ratio = 0.478 + 0.000038 * w;
      ratio = Math.max(0.48, Math.min(ratio, 0.56));
      contentX = w * ratio;
      /* 下限：不落进封面实体中部（贴在封面右缘的羽化带里）；上限：留最小列宽 */
      contentX = Math.max(contentX, coverW * 0.72);
      contentX = Math.min(contentX, w - 210);
    } else {
      contentX = Math.max(w * 0.30, seam - band * 0.30);
    }
    player.style.setProperty('--cover-w', Math.round(coverW) + 'px');
    player.style.setProperty('--seam', Math.round(seam) + 'px');
    player.style.setProperty('--band', Math.round(band) + 'px');
    player.style.setProperty('--content-x', Math.round(contentX) + 'px');
    if (stagePic) probeAmbient(stagePic, coverProbeToken);
    measureLyricTop();
  }
  /* 歌词阅读列必须从标题块下方开始，否则歌名/歌手/元信息会与歌词行叠字。
   * 标题块高度随歌名行数与 meta 有无变化，所以量而不是写死。 */
  function measureLyricTop() {
    var sceneEl = $('scene');
    if (!sceneEl) return;
    var host = sceneTop;
    if (!host || host.offsetParent === null) return;
    var hb = host.getBoundingClientRect();
    var sb = sceneEl.getBoundingClientRect();
    var gap = 10;
    var top = Math.max(44, Math.round(hb.bottom - sb.top + gap));
    player.style.setProperty('--lyric-top', top + 'px');
  }
  function probeCover(pic) {
    var token = ++coverProbeToken;
    if (!pic) {
      coverAR = 0;
      applyAmbient(null);
      updateStageMetrics();
      return;
    }
    applyAmbientPending();
    /* 画幅比例：只读 Image 自然尺寸 —— 绝不碰 canvas（非 CORS 封面也要量得出来） */
    var img = new Image();
    img.onload = function () {
      if (token !== coverProbeToken) return;
      coverAR = img.naturalHeight > 0 ? img.naturalWidth / img.naturalHeight : 0;
      updateStageMetrics();   /* 尺寸齐了再由它触发取色（带可见右缘比例） */
    };
    img.onerror = function () {
      if (token !== coverProbeToken) return;
      coverAR = 0;
      updateStageMetrics();
    };
    img.src = withSession(pic);
  }
  function applyCovers() {
    var t = currentTrack();
    var pic = t && t.pic ? t.pic : '';
    stagePic = pic;
    /* 呈现层标记：无封面时走「纸面留白」兜底（只切 CSS 变量，不动业务） */
    player.classList.toggle('nocover', !pic);
    $('cover').style.backgroundImage = coverStageImage(pic);
    /* 晕开层：同一张封面的模糊放大副本（取色失败时的兜底） */
    $('coverHaze').style.backgroundImage = coverUrlOnly(pic);
    probeCover(pic);
    var rows = queueList.querySelectorAll('.q-row');
    for (var i = 0; i < rows.length; i++) {
      var tr = trackByUid(rows[i].getAttribute('data-uid'));
      var el = rows[i].querySelector('.q-cover');
      if (el && tr) el.style.backgroundImage = coverImage(tr.pic || '');
    }
  }

  /* ============================================================
     渲染
     ============================================================ */
  /* 元信息行（罐头指定）：来源 = 这首歌所属歌单名，格式「来源·<歌单名>」，
   * 用间隔点。本地列表 →「来源·本地」。不再吃 group（v1 遗留），也不再显示专辑
   * （后端无此字段，硬留只会多一个空标签）。 */
  function metaLine(t) {
    return '来源·' + sourceName(t);
  }

  function renderTrack() {
    var t = currentTrack();
    var favBtn = $('stageFavBtn');
    var favTextBtn = $('favBtn');
    /* 播放页红心是空标签（只有外壳），图标得自己塞（只塞一次）。 */
    if (favBtn && !favBtn.querySelector('use')) favBtn.innerHTML = icon('i-heart');
    if (!t) {
      $('trackTitle').textContent = '还没有曲目';
      $('trackArtist').textContent = '用右上角的 ＋ 导入';
      $('trackMeta').textContent = '';
      paintFav(favBtn, null);
      paintFav(favTextBtn, null);
      if (favBtn) favBtn.hidden = true;   // 没曲目可喜欢，不留孤零零一颗心
      $('ciTitle').textContent = '还没有曲目';
      $('ciArtist').textContent = '';
      seek.max = '0';
      $('durTime').textContent = '--:--';
      applyCovers();
      syncMediaSession();
      return;
    }
    $('trackTitle').textContent = t.title;
    /* 副标题只放真歌手：拿不到就留空省略，不把来源/分组冒充歌手（R3） */
    $('trackArtist').textContent = t.author || '';
    $('trackMeta').textContent = metaLine(t);
    paintFav(favBtn, t);
    paintFav(favTextBtn, t);
    if (favBtn) favBtn.hidden = false;
    $('ciTitle').textContent = t.title;
    $('ciArtist').textContent = t.author || '';
    var d = trackDuration(t);
    seek.max = String(d || 0);
    $('durTime').textContent = d ? fmtTime(d) : '--:--';
    applyCovers();
    measureLyricTop();
    syncMediaSession();
  }

  function renderListTabs() {
    if (!listTabs) return;
    var html = '';
    for (var i = 0; i < state.lists.length; i++) {
      var l = state.lists[i];
      var label = listDisplayName(l);
      var active = l.id === state.activeList;
      html += '<button class="list-tab' + (active ? ' is-active' : '') + '" type="button" role="tab"' +
        ' aria-selected="' + (active ? 'true' : 'false') + '" data-list="' + esc(l.id) + '"' +
        ' title="' + esc(l.name || label) + '">' + esc(label) + '</button>';
    }
    listTabs.innerHTML = html;
  }

  /* 列表空时的安静引导（不是空白） */
  function emptyGuide() {
    if (state.activeList === 'fav') {
      return '<li class="q-empty q-guide">' +
        '<p class="q-guide-text">还没有喜欢的歌</p>' +
        '<p class="q-guide-hint">在队列或播放页点亮红心，就会收到这里</p>' +
        '</li>';
    }
    if (state.activeList === 'local') {
      if (!state.localDir) {
        return '<li class="q-empty q-guide">' +
          '<p class="q-guide-text">还没有选择本地文件夹</p>' +
          '<button class="q-guide-btn" id="localPickBtn" type="button">' +
            icon('i-folder', 'icon-sm') + '<span>选择文件夹</span>' +
          '</button>' +
          '</li>';
      }
      return '<li class="q-empty q-guide">' +
        '<p class="q-guide-text">这个文件夹里还没有音频文件</p>' +
        '<button class="q-guide-btn" id="localRescanBtn" type="button">' +
          icon('i-repeat', 'icon-sm') + '<span>重新扫描</span>' +
        '</button>' +
        '</li>';
    }
    return '<li class="q-empty">这个歌单还没有曲目</li>';
  }

  function renderQueue() {
    renderListTabs();
    var vis = visibleTracks();
    var html = '';
    for (var i = 0; i < vis.length; i++) {
      var t = vis[i];
      var cur = t.uid === state.currentUid;
      html += '<li class="q-row' + (cur ? ' is-current' : '') + '" data-id="' + esc(t.id) + '" data-uid="' + esc(t.uid) + '">' +
        '<button class="q-hit" type="button" title="' + esc(t.title + (t.artist ? ' — ' + t.artist : '')) + '">' +
          '<span class="q-cover"></span>' +
          '<span class="q-meta">' +
            '<span class="q-title">' + esc(t.title) + '</span>' +
            /* 队列第二行：有歌手显歌手，没有就留空（不让 group 再冒充） */
            '<span class="q-artist">' + esc(t.author || '') + '</span>' +
          '</span>' +
          /* 正在播放指示：行内 SVG（不走 <use>，否则选择器进不了 shadow tree，条形动画不会生效） */
          '<span class="q-eq"><svg viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="M6.5 9.5v9"/><path d="M12 5.5v13"/><path d="M17.5 11.5v7"/>' +
          '</svg></span>' +
          '<span class="q-dur">' + (t.dur ? fmtTime(t.dur) : '--:--') + '</span>' +
        '</button>' +
        '<button class="q-fav' + (isFav(t.id) ? ' is-on' : '') + '" type="button" aria-pressed="' + (isFav(t.id) ? 'true' : 'false') + '" aria-label="' + (isFav(t.id) ? '取消喜欢' : '加入我的喜欢') + '" title="' + (isFav(t.id) ? '取消喜欢' : '加入我的喜欢') + '">' + icon('i-heart') + '</button>' +
        '<button class="q-more" type="button" aria-label="更多操作：' + esc(t.title) + '">' + icon('i-more') + '</button>' +
      '</li>';
    }
    if (!html) html = emptyGuide();
    queueList.innerHTML = html;
    applyCovers();
    var n = vis.length;
    $('queueCount').textContent = String(n);
    $('queueBtnCount').textContent = String(n);
    // 队列头显示当前列表名（重命名后这里可见）；本地页固定「本地」
    var act = findList(state.activeList);
    var qt = $('queueTitle');
    if (qt && !renaming) qt.textContent = (act && act.name) || '播放队列';
    var rb = $('renameBtn');
    if (rb) rb.hidden = !(act && act.id !== 'local' && act.id !== 'fav');
  }

  /* 把正在播的那首滚进队列可视区中部。切列表 / 切歌时调（罐头拍板）。
   * 为什么不在 renderQueue 里无条件重建后就居中：点心/移出等操作也会重渲染，
   * 那时不该抢用户的滚动位置。所以只在两个明确时机调。 */
  function centerCurrentInQueue() {
    if (!queueList) return;
    var row = queueList.querySelector('.q-row.is-current');
    if (!row) return;
    var rTop = row.offsetTop;
    var rH = row.offsetHeight;
    var vH = queueList.clientHeight;
    var max = queueList.scrollHeight - vH;
    if (max <= 0) return;   // 内容不滚，无需居中
    var target = Math.max(0, Math.min(rTop - vH / 2 + rH / 2, max));
    queueList.scrollTop = target;
  }

  function renderResume() {
    var btn = $('resumeBtn');
    if (btn) btn.hidden = !state.needsResume;
  }

  function renderProgress() {
    var t = currentTrack();
    if (!t) {
      seek.value = '0';
      $('curTime').textContent = '0:00';
      seek.style.setProperty('--fill', '0%');
      return;
    }
    var d = trackDuration(t);
    var p = d ? Math.min(state.progress, d) : state.progress;
    seek.value = String(p);
    $('curTime').textContent = fmtTime(p);
    seek.style.setProperty('--fill', (d ? (p / d * 100) : 0).toFixed(2) + '%');
  }

  function renderVolume() {
    var v = Math.round(state.volume * 100);
    vol.value = String(v);
    vol.style.setProperty('--fill', v + '%');
    var muted = state.muted || v === 0;
    $('muteBtn').innerHTML = icon(muted ? 'i-volume-mute' : 'i-volume');
    $('muteBtn').setAttribute('aria-label', muted ? '取消静音' : '静音');
    $('muteBtn').title = muted ? '取消静音' : '静音';
  }

  function renderMode() {
    var m = MODES.filter(function (x) { return x.key === state.mode; })[0] || MODES[0];
    var btn = $('modeBtn');
    btn.innerHTML = icon(m.icon);
    btn.setAttribute('aria-label', '播放模式：' + m.label + '（点击切换）');
    btn.title = '播放模式：' + m.label;
  }

  function renderPlayState() {
    var btn = $('playBtn');
    btn.innerHTML = icon(state.playing ? 'i-pause' : 'i-play');
    btn.setAttribute('aria-label', state.playing ? '暂停' : '播放');
    btn.title = state.playing ? '暂停' : '播放';
    player.setAttribute('data-playing', state.playing ? '1' : '0');
  }

  /* 歌词不再有用户开关：有词就显、没词才出频谱（见 syncPanels）。
   * data-lyrics 保留为常量 "1" —— CSS 的换层交叉动画以它做命名空间，别删。 */
  function renderLyricMode() {
    player.setAttribute('data-lyrics', '1');
  }

  /* 频谱（R4）：歌词关闭 / 无词时的替代内容。
   * 条形结构一次性建好；真音频可用时由 JS 写 transform:scaleY（见 reactive），
   * 建链失败则退回 CSS 装饰循环（specPulse，见 style.css）。 */
  function renderSpectrum() {
    var host = $('spectrum');
    if (!host || host.childNodes.length) return;
    var html = '';
    for (var i = 0; i < 34; i++) {
      var h = 10 + Math.round((Math.abs(Math.sin(i * 1.7)) * 26 + Math.abs(Math.cos(i * 0.6)) * 12 + (i % 4) * 2));
      var d = (0.85 + ((i * 37) % 13) / 10).toFixed(2);
      var delay = (-((i * 53) % 19) / 10).toFixed(2);
      html += '<i class="spec-bar" style="height:' + h + '%; --d:' + d + 's; --delay:' + delay + 's"></i>';
    }
    host.innerHTML = html;
  }

  /* ============================================================
     音频反应（真 FFT）：用 captureStream() 把 <audio> 的音频**另拷一路**
     接到 AnalyserNode，驱动频谱柱。

     为什么不用 createMediaElementSource（2026-10-09 实测，别改回去）：
       它把元素的输出**重定向**进 Web Audio，而且**不可逆**。跨源音频
       （非网易云曲目会 302 到平台自己的 CDN）一旦进去，浏览器会**输出全零**
       （控制台：MediaElementAudioSource outputs zeroes due to CORS access
       restrictions）——歌在播、时间在走，但**完全没声音**。而全曲共用一个
       <audio> 元素，一次建链就再也退不回，后面所有歌一起哑。

     captureStream() 不碰元素输出：
       · 同源 → 拿到 MediaStream，能读频域，真频谱照常；
       · 跨源 → 抛 SecurityError，被我们捕获，**元素照常出声**，
                移除 is-reactive、退回 CSS 装饰循环（specPulse）。
     ============================================================ */
  var reactive = { actx: null, msSrc: null, analyser: null, data: null, raf: 0, ready: false, failed: false, building: false };
  var barSmooth = null;

  /* 是否接入真音频反应。**现为 true**。
   * 同源媒体（走 music/go 的同源分片代理）才拿得到数据；跨源时 captureStream
   * 直接抛错，自动退回 CSS 装饰循环。拿不到数据 / 捕获失败 → 绝不静音。 */
  var REACTIVE_ENABLED = true;

  function reactiveSupported() {
    return !!(window.AudioContext || window.webkitAudioContext);
  }

  function spectrumBars() {
    var host = $('spectrum');
    return host ? host.querySelectorAll('.spec-bar') : [];
  }

  /* 把 64 段频域数据映射到 34 根柱：低频多分几格（对数取样），加平滑免得一格一格跳 */
  function applyBins(data) {
    var bars = spectrumBars();
    var n = bars.length;
    if (!n || !data) return;
    if (!barSmooth || barSmooth.length !== n) barSmooth = new Float32Array(n);
    var bins = data.length;
    var span = bins * 0.72;   // 高频尾部基本是空的，砍掉
    for (var i = 0; i < n; i++) {
      var lo = Math.floor(Math.pow(i / n, 1.6) * span);
      var hi = Math.max(lo + 1, Math.floor(Math.pow((i + 1) / n, 1.6) * span));
      var sum = 0, c = 0;
      for (var k = lo; k < hi && k < bins; k++) { sum += data[k]; c++; }
      var v = c ? (sum / c) / 255 : 0;
      barSmooth[i] = barSmooth[i] * 0.7 + v * 0.3;
      var s = 0.16 + barSmooth[i] * 1.05;
      if (s > 1) s = 1;
      bars[i].style.transform = 'scaleY(' + s.toFixed(3) + ')';
    }
  }

  /* 拆掉当前的真频谱链（换源前调）。不复用 AudioContext（留着复用）。 */
  function detachReactive() {
    stopBars();
    player.classList.remove('is-reactive');
    if (reactive.msSrc) { try { reactive.msSrc.disconnect(); } catch (e) {} reactive.msSrc = null; }
    if (reactive.analyser) { try { reactive.analyser.disconnect(); } catch (e) {} reactive.analyser = null; }
    reactive.data = null;
    reactive.ready = false;
  }

  /* 换曲调它：断掉旧流、清 ready，让下一首 play 时重新捕获。
   * 不设 failed —— 同源跨源会交替出现，得允许重试。 */
  function resetReactive() {
    detachReactive();
    reactive.building = false;
  }

  function buildReactive() {
    if (!REACTIVE_ENABLED || reactive.building || !reactiveSupported()) return;
    if (reactive.ready) return;                // 已在跟当前这首
    if (!audio.src) return;
    reactive.building = true;
    var AC = window.AudioContext || window.webkitAudioContext;
    var actx = reactive.actx;
    if (!actx) {
      try { actx = new AC(); } catch (e) { reactive.failed = true; reactive.building = false; return; }
    }

    function attach() {
      if (actx.state !== 'running') return false;
      try {
        var stream = audio.captureStream ? audio.captureStream() : null;
        if (!stream) throw new Error('captureStream unsupported');
        var tracks = stream.getAudioTracks ? stream.getAudioTracks() : [];
        if (!tracks.length) throw new Error('no audio track');
        var ms = actx.createMediaStreamSource(stream);
        var an = actx.createAnalyser();
        an.fftSize = 128;                      // → 64 个频段
        an.smoothingTimeConstant = 0.82;
        var g = actx.createGain();
        g.gain.value = 0;                      // 副本静音：只取数据，不与元素自身出声叠加
        ms.connect(an);
        an.connect(g);
        g.connect(actx.destination);           // 图要通到 destination，AnalyserNode 才会被拉数据
        reactive.actx = actx;
        reactive.msSrc = ms;
        reactive.analyser = an;
        reactive.data = new Uint8Array(an.frequencyBinCount);
        reactive.ready = true;
        reactive.building = false;
        player.classList.add('is-reactive');   // CSS 关掉装饰循环，交给 JS
        startBars();
        return true;
      } catch (e) {
        // 跨源（SecurityError）或浏览器不支持：元素输出不受影响，只是拿不到数据。
        // 退回 CSS 装饰循环，绝不静音。
        detachReactive();
        reactive.building = false;
        return false;
      }
    }

    if (actx.state === 'running') { if (attach()) return; }
    actx.resume().then(function () {
      if (!attach()) reactive.building = false;
    }).catch(function () {
      reactive.failed = true; reactive.building = false;
    });
  }

  function startBars() {
    if (reactive.raf) return;
    var bars = spectrumBars();
    if (!bars.length) return;
    (function tick() {
      reactive.raf = requestAnimationFrame(tick);
      var an = reactive.analyser, data = reactive.data;
      if (!an || !data || audio.paused) return;   // 暂停时定格
      try { an.getByteFrequencyData(data); applyBins(data); } catch (e) {}
    })();
  }

  function stopBars() {
    if (reactive.raf) { cancelAnimationFrame(reactive.raf); reactive.raf = 0; }
  }

  function renderLyrics() {
    var has = state.lyricLines.length > 0;
    player.setAttribute('data-haslyrics', has ? '1' : '0');
    syncPanels(true);   // 可见层若变了，做一次交叉淡入淡出
    var html = '';
    if (!has) {
      /* 无词不再显示「暂无歌词」—— 改由频谱接管（motion 5） */
      html = '';
    } else {
      for (var i = 0; i < state.lyricLines.length; i++) {
        html += '<p class="lyric-line" data-i="' + i + '">' + esc(state.lyricLines[i].text) + '</p>';
      }
    }
    lyrics.innerHTML = html;
  }

  function renderChrome() {
    player.setAttribute('data-page', state.page);
    player.setAttribute('data-drawer', state.drawer ? '1' : '0');
    drawerScrim.hidden = !(player.getAttribute('data-layout') === 'wide' && state.drawer);

    var qBtn = $('queueBtn');
    var lay = player.getAttribute('data-layout');
    var isLong = lay === 'long';
    qBtn.classList.toggle('is-static', isLong);
    qBtn.disabled = isLong;
    var qLabel = isLong ? '播放队列（常驻显示）'
      : (lay === 'compact'
        ? (state.page === 'queue' ? '回到播放' : '打开队列')
        : (state.drawer ? '收起队列' : '展开队列'));
    qBtn.title = qLabel;
    qBtn.setAttribute('aria-label', qLabel);
  }

  /* ============================================================
     歌词
     ============================================================ */
  var lyricIndex = -1;
  var lyricGen = 0;

  function sizeLyricPad() {
    var h = lyricWrap.clientHeight;
    if (!h) return;
    var pad = Math.max(28, Math.round(h / 2 - 26));
    lyrics.style.paddingTop = pad + 'px';
    lyrics.style.paddingBottom = pad + 'px';
  }

  function centerCurrentLine(instant) {
    if (!state.follow) return;
    var el = lyrics.querySelector('.lyric-line.is-current');
    if (!el) return;
    var target = el.offsetTop - lyrics.offsetTop - lyricWrap.clientHeight / 2 + el.offsetHeight / 2;
    lyrics.scrollTo({ top: Math.max(0, target), behavior: instant ? 'auto' : 'smooth' });
  }

  function updateLyricIndex(instant) {
    var idx = -1;
    for (var i = 0; i < state.lyricLines.length; i++) {
      if (state.lyricLines[i].t <= state.progress + 0.01) idx = i; else break;
    }
    if (idx === lyricIndex) return;
    lyricIndex = idx;
    var nodes = lyrics.querySelectorAll('.lyric-line');
    for (var j = 0; j < nodes.length; j++) {
      var d = j - idx;
      nodes[j].classList.toggle('is-current', d === 0);
      nodes[j].classList.toggle('is-near', Math.abs(d) === 1);
    }
    if (state.follow) centerCurrentLine(instant);
  }

  /* 歌词跟随：滚完停 3s 自动回归（motion 2）。
   * 去掉「回到当前歌词」按钮 —— 不再需要手动回。
   * 定时器在交互进行中不触发；每次滚动/指针交互重置计时。 */
  var followTimer = 0;
  function clearFollowTimer() { if (followTimer) { clearTimeout(followTimer); followTimer = 0; } }
  function scheduleResume() {
    clearFollowTimer();
    if (state.follow) return;   // 本来就跟着，不需要回归
    followTimer = setTimeout(function () { followTimer = 0; resumeFollow(); }, 3000);
  }
  function pauseFollow() {
    lyrics.classList.add('is-browsing');   // 3 行聚焦：滚动时全部行显形
    if (state.follow) state.follow = false;
    scheduleResume();
  }
  function resumeFollow() {
    clearFollowTimer();
    state.follow = true;
    lyrics.classList.remove('is-browsing');
    centerCurrentLine(false);
  }

  lyricWrap.addEventListener('wheel', pauseFollow, { passive: true });
  lyricWrap.addEventListener('touchstart', pauseFollow, { passive: true });
  lyricWrap.addEventListener('touchmove', function () { scheduleResume(); }, { passive: true });
  lyricWrap.addEventListener('pointerdown', pauseFollow);
  /* 只认触摸/笔：桌面鼠标悬停移动不算「在浏览」，否则 3s 自动回归会被无限重置 */
  lyricWrap.addEventListener('pointermove', function (e) {
    if (e.pointerType !== 'mouse' && !state.follow) scheduleResume();
  });
  lyrics.addEventListener('scroll', function () { if (!state.follow) scheduleResume(); }, { passive: true });

  /* LRC：[mm:ss.xx] 行级时间戳，一行可带多个 */
  function parseLrc(text) {
    if (!text) return [];
    var out = [];
    var lines = String(text).split(/\r?\n/);
    var re = /\[(\d{1,3}):(\d{1,2})(?:[.:](\d{1,3}))?\]/g;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      re.lastIndex = 0;
      var stamps = [];
      var m;
      while ((m = re.exec(line))) {
        var frac = m[3] ? parseInt(m[3].length >= 3 ? m[3] : m[3] + '0', 10) : 0;
        stamps.push(parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac / 1000);
      }
      if (!stamps.length) continue;
      var body = line.replace(re, '').trim();
      for (var s = 0; s < stamps.length; s++) out.push({ t: stamps[s], text: body });
    }
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }

  /* TTML（AMLL 逐字库）：只取行级 —— 剥掉字级 <span>，留 <p begin> 文本 */
  function parseTtmlTime(v) {
    var m = /^(?:(\d+):)?(\d+):(\d+(?:\.\d+)?)$/.exec(String(v || ''));
    if (!m) return 0;
    return (parseInt(m[1] || '0', 10) * 3600) + parseInt(m[2], 10) * 60 + parseFloat(m[3]);
  }
  function parseTtml(text) {
    if (!text || !/<p[\s>]/i.test(text)) return [];
    var out = [];
    var re = /<p\b[^>]*\bbegin="([^"]+)"[^>]*>([\s\S]*?)<\/p>/g;
    var m;
    while ((m = re.exec(text))) {
      var body = m[2].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      if (body) out.push({ t: parseTtmlTime(m[1]), text: body });
    }
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }

  function onlineIdOf(t) {
    /* 只认真正的 Meting 数字 id（server:123 / …/music/go/123），
     * search: 开头的伪 id 不是 id，交给 lrcUrl / 搜索路径。 */
    var m = /^[a-z]+:(\d+)$/.exec(String(t.id || ''));
    if (m) return m[1];
    var g = /\/music\/go\/([0-9]+)/.exec(t.url || '');
    return g ? g[1] : '';
  }
  function onlineServerOf(t) {
    /* 先看 url 上的 server（在线曲目都有），再退到 id 前缀。
     * 旧版 searchKey 曲目的 id 是 `search:…` 伪前缀，不能当 server 用。 */
    var s = /[?&]server=([^&#]+)/.exec(t.url || '');
    if (s) return decodeURIComponent(s[1]);
    var m = /^([a-z]+):/.exec(String(t.id || ''));
    if (m && m[1] !== 'search') return m[1];
    return 'netease';
  }

  /* 归一化标题：去空白、去括号后缀（(Live)/(伴奏) 等）、小写。 */
  function normLyricTitle(s) {
    return String(s || '').toLowerCase()
      .replace(/[\s\u3000]+/g, '')
      .replace(/[（(【\[].*?[）)】\]]/g, '');
  }
  function normLyricAuthor(s) {
    return String(s || '').toLowerCase().replace(/[\s\u3000\/、,，&]+/g, '');
  }
  /* 从搜索结果里挑一个「标题对得上」的（作者对得上加权），防同名不同版本乱匹配。
   * 只有当标题完全相等，或标题部分包含 + 作者也对得上时才接受；
   * 没有歌手的曲目（纯音乐等）只认标题完全相等。宁可没词，不可错配。 */
  function pickLyricHit(list, title, author) {
    var want = normLyricTitle(title);
    if (!want) return null;
    var wantA = normLyricAuthor(author);
    var best = null, bestScore = 0;
    for (var i = 0; i < (list || []).length; i++) {
      var it = list[i];
      if (!it || !it.url) continue;
      var nm = normLyricTitle(it.title);
      if (!nm) continue;
      var exact = nm === want;
      var ts = exact ? 3 : (nm.indexOf(want) >= 0 || want.indexOf(nm) >= 0 ? 2 : 0);
      if (!ts) continue;
      var na = normLyricAuthor(it.author);
      var as = (wantA && na && (na === wantA || na.indexOf(wantA) >= 0 || wantA.indexOf(na) >= 0)) ? 2 : 0;
      // 接受条件：标题完全相等，或（标题部分包含且作者对得上）。
      // 没有歌手时不做部分匹配 —— 防纯音乐被配成同名歌曲的人工版。
      if (!exact && !as) continue;
      var score = ts + as;
      if (score > bestScore) { bestScore = score; best = it; }
    }
    return best;
  }

  /* 降级链：离线库 → music/lrc → lrc-proxy → ttml(404 退空) → **跨源兜底**。
   * 每次带代次，迟到响应不许覆盖新歌。 */
  function loadLyrics(t) {
    var gen = ++lyricGen;
    state.lyricLines = [];
    lyricIndex = -1;
    renderLyrics();
    sizeLyricPad();
    if (!t || !t.title) return;

    function done(lines, cacheText) {
      if (gen !== lyricGen) return;
      state.lyricLines = lines;
      lyricIndex = -1;
      renderLyrics();
      sizeLyricPad();
      updateLyricIndex(true);
      if (cacheText) apiPostJson(ENDPOINT.lrcSave, { name: t.title, lrc: cacheText }).catch(function () {});
    }
    function ttmlTry() {
      if (gen !== lyricGen) return Promise.resolve();
      var id = onlineIdOf(t);
      if (!id) return Promise.resolve();
      var platform = onlineServerOf(t) === 'tencent' ? 'qq' : 'ncm';
      return apiText(ENDPOINT.ttml + '?id=' + encodeURIComponent(id) + '&platform=' + platform).then(function (r) {
        if (gen !== lyricGen) return;
        if (r.ok && /<tt[\s>]/i.test(r.text)) {
          var lines = parseTtml(r.text);
          if (lines.length) return done(lines, null);
        }
      }).catch(function () {});
    }
    function online() {
      if (gen !== lyricGen) return Promise.resolve();
      var id = onlineIdOf(t);
      // 1) 有 meting id → music/lrc（后端直接问 meting，不受 host 白名单限制）
      if (id) {
        return apiText(ENDPOINT.musicLrc + '?id=' + encodeURIComponent(id) + '&server=' + encodeURIComponent(onlineServerOf(t))).then(function (r) {
          if (gen !== lyricGen) return;
          if (r.ok && r.text && !/^lyric fetch failed/.test(r.text)) return done(parseLrc(r.text), r.text);
          return proxy();
        }).catch(function () { return proxy(); });
      }
      return proxy();

      // 2) 拿到的是 lrc 文件地址而非 id → lrc-proxy
      function proxy() {
        if (gen !== lyricGen) return Promise.resolve();
        if (!(t.lrcUrl && /^https?:/i.test(t.lrcUrl))) return ttmlTry();
        return apiText(ENDPOINT.lrcProxy + '?url=' + encodeURIComponent(t.lrcUrl)).then(function (r) {
          if (gen !== lyricGen) return;
          if (r.ok && r.text && !/^lyric fetch failed/.test(r.text)) return done(parseLrc(r.text), r.text);
          return ttmlTry();
        }).catch(function () { return ttmlTry(); });
      }
    }

    // 跨源兜底：本平台/本 id 拿不到词时，拿「标题+歌手」去别的平台搜一次，
    // 命中标题匹配的首条再取词。只兜 online 曲目；本地文件不动（避免纯音乐乱配）。
    function crossLyric() {
      if (gen !== lyricGen) return Promise.resolve();
      if (state.lyricLines.length) return Promise.resolve();    // 已有词，不兜
      if (t.mode !== '在线') return Promise.resolve();
      var kw = [t.title, t.author].filter(Boolean).join(' ').trim();
      if (!kw) return Promise.resolve();
      var cur = onlineServerOf(t);
      var servers = ['netease', 'tencent', 'kugou', 'kuwo', 'baidu'].filter(function (s) { return s !== cur; });
      var i = 0;
      function next() {
        if (gen !== lyricGen || i >= servers.length) return Promise.resolve();
        var sv = servers[i++];
        return apiGetJson(ENDPOINT.search + '?keyword=' + encodeURIComponent(kw) + '&server=' + encodeURIComponent(sv)).then(function (res) {
          if (gen !== lyricGen) return;
          var list = (res.ok && res.body && res.body.ok && Array.isArray(res.body.results)) ? res.body.results : [];
          var hit = pickLyricHit(list, t.title, t.author);
          var hid = hit ? onlineIdOf(hit) : '';
          if (!hid) return next();
          return apiText(ENDPOINT.musicLrc + '?id=' + encodeURIComponent(hid) + '&server=' + encodeURIComponent(sv)).then(function (r) {
            if (gen !== lyricGen) return;
            if (r.ok && r.text && !/^lyric fetch failed/.test(r.text)) {
              var lines = parseLrc(r.text);
              if (lines.length) return done(lines, r.text);   // 标题对上了才落盘
            }
            return next();
          }).catch(function () { return next(); });
        }).catch(function () { return next(); });
      }
      return next();
    }

    apiGetJson(ENDPOINT.lrcLoad + '?name=' + encodeURIComponent(t.title)).then(function (res) {
      if (gen !== lyricGen) return;
      if (res.ok && res.body && res.body.ok && res.body.lrc) return done(parseLrc(res.body.lrc), null);
      return online();
    }).catch(function () { return online(); })
    .then(function () { return crossLyric(); });
  }

  /* ============================================================
     音频引擎
     ============================================================ */
  var pendingSeek = 0;
  var pendingAutoplay = false;
  var durSaveTimer = 0;

  function scheduleDurSave() {
    clearTimeout(durSaveTimer);
    durSaveTimer = setTimeout(function () { savePlaylist(); }, 1500);
  }

  function loadAudio(t, seekTo, autoplay) {
    if (!t || !t.url) {
      audio.removeAttribute('src');
      try { audio.load(); } catch (e) {}
      pendingAutoplay = false;
      return;
    }
    var srcUrl = withSession(t.url);
    var same = audio.getAttribute('src') === srcUrl;
    if (!same) {
      resetReactive();          // 换源：断掉旧链，play 时按新源重新判同源/跨源
      audio.src = srcUrl;
      try { audio.load(); } catch (e) {}
    }
    pendingSeek = seekTo > 0 ? seekTo : 0;
    pendingAutoplay = !!autoplay;
    scheduleSeekRetry();
    if (same && pendingAutoplay && audio.paused) {
      // 同一首（恢复场景）：直接播
      audio.play().catch(onAutoplayBlocked);
      pendingAutoplay = false;
    }
  }

  /* 卸载期：拖进/拖出 = 整份文档被换掉，audio 销毁可能补发一次 pause。
   * 那一下不能当成「用户暂停」写回 playing=false，否则新文档读到 false 就永不续播。 */
  var unloading = false;

  function flushOnTeardown() {
    unloading = true;   // 之后 audio 销毁补发的 pause 不写回
    // 每次 pagehide / 隐藏都立即把完整快照交给宿主（sendBeacon / keepalive，跨文档可靠）。
    // 不做「只落一次」的锁：重复落同一份快照无害，漏落才会丢状态。
    try { beaconPlayback(); } catch (e) {}
  }
  window.addEventListener('pagehide', flushOnTeardown);
  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') flushOnTeardown();
    else unloading = false;   // 只是被隐藏后又回来（并未真卸载）
  });
  window.addEventListener('pageshow', function () { unloading = false; });

  function onAutoplayBlocked(e) {
    if (e && e.name === 'AbortError') return;
    // 不归零：保留进度与暂停态，给一个轻量的「继续播放」引导（而不是 toast 完就停死）
    state.playing = false;
    state.needsResume = true;
    renderPlayState();
    renderResume();
    toast('自动播放被拦，点「继续播放」');
  }

  /* 恢复进度：loadedmetadata 时媒体往往还不可 seek（seekable=[0,0]），此时赋
   * currentTime 会被忽略或夹到已缓冲范围。把 seek 挂到多个就绪事件上，并配一个短重试
   * 定时器，可 seek 了再落。落成功后清 pendingSeek。这是续播能接上位置的关键。 */
  var seekRetryTimer = 0;
  function scheduleSeekRetry() {
    if (seekRetryTimer || !(pendingSeek > 0)) return;
    var tries = 0;
    seekRetryTimer = setInterval(function () {
      tries++;
      applyPendingSeek();
      if (pendingSeek <= 0 || tries > 20) { clearInterval(seekRetryTimer); seekRetryTimer = 0; }
    }, 150);
  }
  function applyPendingSeek() {
    if (!(pendingSeek > 0) || audio.seeking) return;
    var sk = audio.seekable;
    if (!sk || !sk.length || sk.end(0) <= 0) return;   // 还不可 seek，等下一个事件/重试
    var dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    var target = dur ? Math.min(pendingSeek, Math.max(0, dur - 0.25)) : pendingSeek;
    // 目标超出当前可 seek 范围就先不落，等缓冲跟上来
    if (sk.end(0) < target) return;
    try { audio.currentTime = target; } catch (e) { return; }
    pendingSeek = 0;
    renderProgress();
  }

  audio.addEventListener('loadedmetadata', function () {
    var t = currentTrack();
    var real = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    if (t && real > 0 && !(Number(t.dur) > 0)) { t.dur = real; scheduleDurSave(); }
    applyPendingSeek();
    renderTrack();
    renderQueue();
    renderProgress();
    if (pendingAutoplay) {
      pendingAutoplay = false;
      audio.play().catch(onAutoplayBlocked);
    }
  });
  audio.addEventListener('loadeddata', applyPendingSeek);
  audio.addEventListener('canplay', applyPendingSeek);
  audio.addEventListener('progress', applyPendingSeek);
  audio.addEventListener('seeked', function () {
    if (!isFinite(audio.currentTime)) return;
    state.progress = audio.currentTime;
    renderProgress();
    updateLyricIndex(true);
    syncPositionState(true);
  });

  audio.addEventListener('timeupdate', function () {
    if (!isFinite(audio.currentTime)) return;
    state.progress = audio.currentTime;
    renderProgress();
    updateLyricIndex(false);
    syncPositionState();
    persistState();
  });

  audio.addEventListener('play', function () {
    state.playing = true;
    state.needsResume = false;
    renderPlayState();
    renderResume();
    msPlayback('playing');
    buildReactive();                 // 首次播放的用户手势里建音频反应链
    if (reactive.ready) startBars();
  });
  audio.addEventListener('pause', function () {
    // 卸载逼出的暂停不写回（否则新文档永不续播）
    if (unloading) return;
    state.playing = false;
    renderPlayState();
    msPlayback('paused');
    stopBars();                      // 暂停时定格频谱
  });
  audio.addEventListener('ended', function () { onTrackEnd(); });
  audio.addEventListener('error', function () {
    var t = currentTrack();
    if (!t || !t.url) return;
    state.playing = false;
    renderPlayState();
    toast('播放失败：' + t.title);
  });

  /* ============================================================
     系统「正在播放」（macOS 控制中心 / 媒体键）
     宿主是 Electron，Chromium 把 navigator.mediaSession 桥到 macOS 的 MediaRemote：
     metadata → 面板的标题/歌手/封面，action handler → 面板按钮与键盘媒体键。
     **没注册 handler 的命令，系统不转发给页面**（按了没反应），所以上一曲/下一曲/
     进度得显式接上；默认动作只兜播放/暂停。
     ============================================================ */
  var mediaSessionApi = (typeof navigator !== 'undefined' && navigator.mediaSession) ? navigator.mediaSession : null;

  function msPlayback(name) {
    if (!mediaSessionApi) return;
    try { mediaSessionApi.playbackState = name; } catch (e) {}
  }

  var lastPosAt = 0;
  /* 进度：系统靠这条外推进度条；不报的话面板上那条是浏览器默认值，未必对。
   * 时长未知时报了会抛，所以先判有效时长；节流约 1s，seek/切歌后强制刷。 */
  function syncPositionState(force) {
    if (!mediaSessionApi || typeof mediaSessionApi.setPositionState !== 'function') return;
    var dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    if (!dur) return;
    var now = Date.now();
    if (!force && now - lastPosAt < 900) return;
    var pos = isFinite(audio.currentTime) ? Math.max(0, Math.min(audio.currentTime, dur)) : 0;
    try {
      mediaSessionApi.setPositionState({
        duration: dur,
        playbackRate: audio.playbackRate > 0 ? audio.playbackRate : 1,
        position: pos
      });
      lastPosAt = now;
    } catch (e) {}
  }

  /* 系统面板的封面必须**同源**：跨源图 Chromium 拓不到像素，artwork 会被静默丢掉
   * （面板退回占位图）。所以经 App 自己的路由代理一次，顺带把网易云封面要成 512。 */
  function msArtwork(pic) {
    if (!pic) return [];
    var proxied = API + '/widget/api/music/cover?size=512&url=' + encodeURIComponent(pic);
    return [{ src: withSession(proxied), sizes: '512x512', type: 'image/jpeg' }];
  }

  /* 元数据：只喂真字段，拿不到就不给（宁可空着，也别拿歌单名冒充歌手） */
  function syncMediaSession() {
    if (!mediaSessionApi) return;
    var t = currentTrack();
    if (!t) {
      try { mediaSessionApi.metadata = null; } catch (e) {}
      msPlayback('none');
      return;
    }
    var meta = { title: t.title || '未命名' };
    if (t.author) meta.artist = t.author;
    meta.album = sourceName(t);
    var art = msArtwork(t.pic);
    if (art.length) meta.artwork = art;
    try { mediaSessionApi.metadata = new MediaMetadata(meta); } catch (e) {}
    syncPositionState(true);
  }

  function msSeekBy(delta) {
    var dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    var to = Math.max(0, (audio.currentTime || 0) + delta);
    if (dur) to = Math.min(to, dur);
    try { audio.currentTime = to; } catch (e) { return; }
    state.progress = to;
    renderProgress();
    updateLyricIndex(true);
    syncPositionState(true);
  }

  function msStep(dir) {
    var i = stepIndex(dir);
    var vis = visibleTracks();
    if (i >= 0 && vis[i]) playTrack(vis[i].uid);
  }

  /* handler 一次性挂上：面板按钮 / 媒体键 → 与页面内控件同一套逻辑 */
  (function bindMediaSessionActions() {
    if (!mediaSessionApi || typeof mediaSessionApi.setActionHandler !== 'function') return;
    function on(name, fn) { try { mediaSessionApi.setActionHandler(name, fn); } catch (e) {} }
    on('play', function () { if (!currentTrack()) return; audio.play().catch(onAutoplayBlocked); persistNow(); });
    on('pause', function () { audio.pause(); persistNow(); });
    on('previoustrack', function () { msStep(-1); });
    on('nexttrack', function () { msStep(1); });
    on('stop', function () {
      audio.pause();
      try { audio.currentTime = 0; } catch (e) {}
      state.playing = false;
      state.progress = 0;
      renderPlayState();
      renderProgress();
      syncPositionState(true);
      persistNow();
    });
    on('seekbackward', function (d) { msSeekBy(-((d && d.seekOffset) || 10)); });
    on('seekforward', function (d) { msSeekBy((d && d.seekOffset) || 10); });
    on('seekto', function (d) {
      if (!d || typeof d.seekTime !== 'number') return;
      var dur = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
      var to = dur ? Math.min(d.seekTime, dur) : d.seekTime;
      if (d.fastSeek && typeof audio.fastSeek === 'function') {
        try { audio.fastSeek(to); } catch (e) { audio.currentTime = to; }
      } else {
        try { audio.currentTime = to; } catch (e) { return; }
      }
      syncPositionState(true);
    });
  })();

  /* ============================================================
     随机播放的「上一曲」：回家的路
     随机的下一曲是掷骰子，上一曲不是 —— 它得回到**刚听过的那一首**。
     所以随机模式里留一条「听过的路」（uid 栈，末尾永远是当前曲目）：
       · 换曲（下一曲 / 自动续播 / 点队列）→ 压栈
       · 上一曲 → 先弹掉当前，再取新的末尾；路上没有（刚开始、或换了歌单）
         → 退回顺序上一首，不再随机（再随机一次就是你提的那个毛病）
     栈随快照落盘，拖进/拖出换文档也还在。
     ============================================================ */
  var SHUFFLE_TRAIL_MAX = 50;
  var shuffleTrail = [];

  function shuffleTrailPush(uid) {
    if (!uid) return;
    if (shuffleTrail[shuffleTrail.length - 1] === uid) return;
    shuffleTrail.push(uid);
    if (shuffleTrail.length > SHUFFLE_TRAIL_MAX) {
      shuffleTrail.splice(0, shuffleTrail.length - SHUFFLE_TRAIL_MAX);
    }
  }

  /* 往回走一步：返回上一条的 uid，没有来路返回 ''。
   * 顺带把已不在当前歌单的旧条目弹掉（切歌单后那条路就断了）。 */
  function shuffleBackUid() {
    var vis = visibleTracks();
    var cur = state.currentUid;
    if (shuffleTrail.length && shuffleTrail[shuffleTrail.length - 1] === cur) shuffleTrail.pop();
    while (shuffleTrail.length) {
      var uid = shuffleTrail[shuffleTrail.length - 1];
      for (var k = 0; k < vis.length; k++) if (vis[k].uid === uid) return uid;
      shuffleTrail.pop();
    }
    return '';
  }

  function stepIndex(dir) {
    var vis = visibleTracks();
    var n = vis.length;
    if (!n) return -1;
    var i = currentIndex();
    if (i < 0) return dir >= 0 ? 0 : n - 1;
    if (state.mode === 'shuffle') {
      if (n === 1) return 0;
      if (dir < 0) {
        var back = shuffleBackUid();
        for (var k = 0; k < n; k++) if (vis[k].uid === back) return k;
        return (i - 1 + n) % n;      // 没有来路：按顺序往回，别随机
      }
      var j = i;
      while (j === i) j = Math.floor(Math.random() * n);
      return j;
    }
    return (i + dir + n) % n;
  }

  function onTrackEnd() {
    if (state.mode === 'one') {
      audio.currentTime = 0;
      audio.play().catch(onAutoplayBlocked);
      return;
    }
    var i = stepIndex(1);
    var vis = visibleTracks();
    if (i >= 0 && vis[i]) playTrack(vis[i].uid);
  }

  var resolveGen = 0;

  /* 旧版导入的在线曲目只有 searchKey：按搜索词搜完整音频（主源失败依次降级）。
   * 命中后把 url/pic/lrcUrl 补进曲目并回写列表，再交给音频引擎。 */
  function ensurePlayable(t) {
    if (t.url) return Promise.resolve(t);
    var raw = t.raw || {};
    var key = String(raw.searchKey || '').trim();
    if (!key) { toast('无法获取音频：' + t.title); return Promise.resolve(null); }
    var primary = raw.searchServer || 'netease';
    var servers = [primary].concat(['netease', 'tencent', 'kugou', 'kuwo', 'baidu'].filter(function (s) { return s !== primary; }));
    var token = ++resolveGen;
    toast('搜索 ' + t.title + '…');
    function tryServer(i) {
      if (i >= servers.length) return Promise.resolve(null);
      return apiGetJson(ENDPOINT.search + '?keyword=' + encodeURIComponent(key) + '&server=' + servers[i]).then(function (res) {
        if (res.ok && res.body && res.body.ok && Array.isArray(res.body.results)) {
          for (var j = 0; j < res.body.results.length; j++) {
            if (res.body.results[j] && res.body.results[j].url) return res.body.results[j];
          }
        }
        return tryServer(i + 1);
      }).catch(function () { return tryServer(i + 1); });
    }
    return tryServer(0).then(function (hit) {
      if (token !== resolveGen) return null;
      if (!hit || !hit.url) { toast('所有源均未找到：' + t.title); return null; }
      t.url = hit.url;
      if (hit.pic) t.pic = hit.pic;
      if (hit.lrc) t.lrcUrl = hit.lrc;
      if (hit.author) { t.author = hit.author; t.artist = hit.author; }
      raw.url = t.url;
      raw.mode = t.mode;
      if (t.author) raw.author = t.author;
      if (t.pic) raw.pic = t.pic;
      if (t.lrcUrl) raw.lrcUrl = t.lrcUrl;
      savePlaylist();
      return t;
    });
  }

  function playTrack(uid, keepProgress) {
    var t = trackByUid(uid);
    if (!t) return;
    var changed = uid !== state.currentUid;
    state.currentUid = uid;
    if (changed && state.mode === 'shuffle') shuffleTrailPush(uid);
    if (changed && !keepProgress) state.progress = 0;
    if (changed) {
      lyricIndex = -1;
      state.follow = true;
      clearFollowTimer();
      if (lyrics) lyrics.classList.remove('is-browsing');
    }
    state.playing = true;
    state.needsResume = false;
    renderTrack();
    renderQueue();
    if (changed) centerCurrentInQueue();   // 切歌时把新曲滚进视野中部（罐头拍板）
    renderProgress();
    renderPlayState();
    renderResume();
    updateLyricIndex(true);
    if (changed) loadLyrics(t);
    if (t.url) {
      loadAudio(t, changed ? 0 : state.progress, true);
    } else {
      // 无 url：可能是旧版 searchKey 曲目，异步解析后再播
      ensurePlayable(t).then(function (ok) {
        if (!ok || state.currentUid !== t.uid) return;
        renderTrack();
        renderQueue();
        loadLyrics(t);
        loadAudio(t, 0, true);
      });
    }
    persistNow();
    if (t.mode === '在线') apiPostJson(ENDPOINT.nowPlaying, { title: t.title, source: '在线' }).catch(function () {});
  }

  /* ============================================================
     控件
     ============================================================ */
  $('playBtn').addEventListener('click', function () {
    if (!currentTrack()) return;
    if (audio.paused) audio.play().catch(onAutoplayBlocked);
    else audio.pause();
    persistNow();
  });

  /* 「继续播放」引导：自动播放被拦时点一下恢复 */
  if ($('resumeBtn')) {
    $('resumeBtn').addEventListener('click', function () {
      if (!currentTrack()) return;
      audio.play().then(function () {
        state.needsResume = false;
        renderResume();
      }).catch(function () { /* 仍被拦就留着按钮 */ });
      persistNow();
    });
  }

  $('prevBtn').addEventListener('click', function () {
    var i = stepIndex(-1);
    var vis = visibleTracks();
    if (i >= 0 && vis[i]) playTrack(vis[i].uid);
  });

  $('nextBtn').addEventListener('click', function () {
    var i = stepIndex(1);
    var vis = visibleTracks();
    if (i >= 0 && vis[i]) playTrack(vis[i].uid);
  });

  $('modeBtn').addEventListener('click', function () {
    var i = MODES.map(function (m) { return m.key; }).indexOf(state.mode);
    state.mode = MODES[(i + 1) % MODES.length].key;
    renderMode();
    persistNow();
  });

  seek.addEventListener('input', function () {
    var v = parseFloat(seek.value) || 0;
    state.progress = v;
    if (currentTrack()) { try { audio.currentTime = v; } catch (e) {} }
    renderProgress();
    updateLyricIndex(false);
    persistState();
  });

  vol.addEventListener('input', function () {
    state.volume = (parseInt(vol.value, 10) || 0) / 100;
    state.muted = state.volume === 0;
    audio.volume = state.volume;
    audio.muted = state.muted;
    renderVolume();
    persistState();
  });

  $('muteBtn').addEventListener('click', function () {
    if (state.muted || state.volume === 0) {
      state.muted = false;
      if (state.volume === 0) state.volume = 0.6;
    } else {
      state.muted = true;
    }
    audio.muted = state.muted;
    audio.volume = state.volume;
    renderVolume();
    persistState();
  });

  $('favBtn').addEventListener('click', function () {
    var t = currentTrack();
    if (!t) return;
    var nowOn = toggleFav(t.id);
    renderTrack();
    renderQueue();
    toast(nowOn ? '已加入我的喜欢' : '已取消喜欢');
  });

  /* 歌词 ⇄ 频谱：交叉淡入淡出（motion 4）。
   * display 不能过渡 → 过渡期间用 .is-swap-* 强制挂载，到时摘类回到 resting 的
   * display:none（延迟卸载）。两侧同时在场 → 真交叉，不闪；
   * 频谱柱由真音频驱动（见 reactive），换层时动画不重启。 */
  var SWAP_MS = 220;
  var lastPanel = null;   // 'lyric' | 'spectrum'，只在「可见层真的变了」时才过渡

  function syncPanels(animate) {
    var has = player.getAttribute('data-haslyrics') === '1';
    var lyricShown = has;            // 有词就显歌词；没词才轮到频谱（不再是用户选择）
    var next = lyricShown ? 'lyric' : 'spectrum';
    if (lastPanel === next) return;
    if (lastPanel && animate) swapPanels(lyricShown);
    lastPanel = next;
  }

  function swapPanels(lyricsOn) {
    var show = lyricsOn ? lyricWrap : $('spectrum');
    var hide = lyricsOn ? $('spectrum') : lyricWrap;
    if (!show || !hide) return;
    // 退场：保持挂载淡出，到时摘类
    clearTimeout(hide.__swapT);
    hide.classList.remove('is-swap-in');
    hide.classList.add('is-swap-out');
    hide.__swapT = setTimeout(function () {
      hide.classList.remove('is-swap-out');
      hide.__swapT = 0;
    }, SWAP_MS);
    // 入场：淡入 + 轻微上浮
    clearTimeout(show.__swapT); show.__swapT = 0;
    show.classList.remove('is-swap-out');
    show.classList.remove('is-swap-in');
    void show.offsetWidth;
    show.classList.add('is-swap-in');
  }

  /* 队列呼出/收回：进加 .is-anim 滑入；出加 player.is-q-leaving 滑出，
   * 动画结束再摘类回到 resting 的 display:none（延迟卸载，可打断）。 */
  var queueLeaveTimer = 0;
  var queueEnterTimer = 0;

  function pulseQueueAnim() {
    var q = $('queue');
    if (!q) return;
    q.classList.remove('is-anim');
    // 强制回流后重加，保证连点同一方向也能重放
    void q.offsetWidth;
    q.classList.add('is-anim');
  }

  function reducedMotion() {
    try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
  }

  function cancelQueueLeave() {
    clearTimeout(queueLeaveTimer); queueLeaveTimer = 0;
    clearTimeout(queueEnterTimer); queueEnterTimer = 0;
    player.classList.remove('is-q-leaving');
    player.classList.remove('is-q-in');
  }

  /* 降级（reduced-motion）：不做延迟卸载，直接卸 */
  function beginQueueLeave(ms) {
    if (reducedMotion()) return;
    player.classList.remove('is-q-in');
    player.classList.add('is-q-leaving');
    clearTimeout(queueLeaveTimer);
    queueLeaveTimer = setTimeout(function () {
      player.classList.remove('is-q-leaving');
      queueLeaveTimer = 0;
    }, ms);
  }

  /* 入场镜像：播放页留在原地左滑淡出，队列从右滑入（矮卡整页交叉） */
  function beginQueueEnter(ms) {
    if (reducedMotion()) return;
    player.classList.remove('is-q-leaving');
    player.classList.remove('is-q-in');
    void player.offsetWidth;
    player.classList.add('is-q-in');
    clearTimeout(queueEnterTimer);
    queueEnterTimer = setTimeout(function () {
      player.classList.remove('is-q-in');
      queueEnterTimer = 0;
    }, ms);
  }

  function setDrawer(open) {
    if (open) {
      cancelQueueLeave();
      state.drawer = true;
      renderChrome();
      pulseQueueAnim();
    } else {
      state.drawer = false;
      renderChrome();
      beginQueueLeave(280);   // 同帧内重新挂载，不留中间帧
    }
    persistState();
  }

  function setCompactPage(next) {
    if (next === 'queue') {
      cancelQueueLeave();
      state.page = 'queue';
      renderChrome();
      beginQueueEnter(260);   // 整页交叉：播放页左滑出 + 队列右滑入
    } else {
      state.page = 'play';
      renderChrome();
      beginQueueLeave(260);
    }
    persistState();
  }

  $('queueBtn').addEventListener('click', function () {
    var layout = player.getAttribute('data-layout');
    if (layout === 'wide') setDrawer(!state.drawer);
    else if (layout === 'compact') setCompactPage(state.page === 'play' ? 'queue' : 'play');
    else { renderChrome(); persistState(); }   // long：队列常驻，无抽屉
  });

  $('backBtn').addEventListener('click', function () { setCompactPage('play'); });

  /* 播放页红心（曲名下方 meta 旁）：点一下切换对当前曲的喜欢。 */
  if ($('stageFavBtn')) $('stageFavBtn').addEventListener('click', function () {
    var t = currentTrack();
    if (!t) return;
    var nowOn = toggleFav(t.id);
    renderQueue();
    renderTrack();
    toast(nowOn ? '已加入我的喜欢' : '已取消喜欢');
  });

  $('drawerCloseBtn').addEventListener('click', closeDrawer);

  function closeDrawer() { setDrawer(false); }

  drawerScrim.addEventListener('click', closeDrawer);

  /* ---------- 队列行 / 浮层 ---------- */
  var moreTargetUid = null;
  var morePop = $('morePop');
  var importPop = $('importPop');
  var listPop = $('listPop');
  var importNote = $('importNote');
  var importBusy = false;

  function setNote(msg) { if (importNote) importNote.textContent = msg || ''; }

  function closePops() {
    morePop.hidden = true;
    importPop.hidden = true;
    if (listPop) listPop.hidden = true;
    $('importBtn').setAttribute('aria-expanded', 'false');
    moreTargetUid = null;
    suppressTabId = '';
  }

  function placePop(pop, anchor) {
    var pr = queue.getBoundingClientRect();
    var ar = anchor.getBoundingClientRect();
    pop.hidden = false;
    var w = pop.offsetWidth;
    var h = pop.offsetHeight;
    var top = ar.bottom - pr.top + 6;
    if (top + h > pr.height - 8) top = Math.max(8, ar.top - pr.top - h - 6);
    var left = ar.right - pr.left - w;
    left = Math.max(8, Math.min(left, pr.width - w - 8));
    pop.style.top = top + 'px';
    pop.style.left = left + 'px';
  }

  queueList.addEventListener('click', function (e) {
    // 空列表引导按钮（本地页）
    if (e.target.closest('#localPickBtn')) { pickLocalFolder(); return; }
    if (e.target.closest('#localRescanBtn')) { syncLocalFolder(true); return; }

    // 红心：加/取消「我的喜欢」。不改列表归属，只动 fav 那份副本。
    var favHit = e.target.closest('.q-fav');
    if (favHit) {
      e.stopPropagation();
      var fr = favHit.closest('.q-row');
      var ft = trackByUid(fr.getAttribute('data-uid'));
      if (ft) {
        var nowOn = toggleFav(ft.id);
        renderQueue();
        renderTrack();
        toast(nowOn ? '已加入我的喜欢' : '已取消喜欢');
      }
      return;
    }

    var more = e.target.closest('.q-more');
    if (more) {
      e.stopPropagation();
      var row = more.closest('.q-row');
      moreTargetUid = row.getAttribute('data-uid');
      var t = trackByUid(moreTargetUid);
      $('moreTitle').textContent = t ? t.title + ' — ' + t.artist : '';
      importPop.hidden = true;
      placePop(morePop, more);
      return;
    }
    var hit = e.target.closest('.q-hit');
    if (hit) {
      var li = hit.closest('.q-row');
      playTrack(li.getAttribute('data-uid'));
    }
  });

  /* 顶部歌单切换条 */
  var suppressTabId = '';   // 长按弹删除浮层后，紧随释放的 click 不当作切列表
  if (listTabs) {
    listTabs.addEventListener('click', function (e) {
      var tab = e.target.closest('.list-tab');
      if (!tab) return;
      if (suppressTabId && tab.getAttribute('data-list') === suppressTabId) { suppressTabId = ''; return; }
      var id = tab.getAttribute('data-list');
      if (!id || id === state.activeList) return;
      renaming = false;
      state.activeList = id;
      renderQueue();
      centerCurrentInQueue();   // 切回该列表时，把正在播的那首滚进视野中部
      renderTrack();
      persistState();
    });
    // 双击当前项 → 重命名（内联输入，轻量）
    listTabs.addEventListener('dblclick', function (e) {
      var tab = e.target.closest('.list-tab.is-active');
      if (tab) startRename();
    });
    // 右键导入列表 → 删除确认（轻量浮层，不用模态）
    listTabs.addEventListener('contextmenu', function (e) {
      var tab = e.target.closest('.list-tab');
      if (!tab) return;
      var id = tab.getAttribute('data-list');
      if (!id || id === 'local') return;   // 本地不可删，不弹
      e.preventDefault();
      openListPop(tab);
    });
    // 长按导入列表 → 同上（移动端手感）
    listTabs.addEventListener('pointerdown', function (e) {
      var tab = e.target.closest('.list-tab');
      if (!tab) return;
      var id = tab.getAttribute('data-list');
      if (!id || id === 'local') return;
      cancelListPress();
      listPressTimer = setTimeout(function () { listPressTimer = 0; openListPop(tab); }, 520);
    });
    ['pointerup', 'pointercancel', 'pointerleave', 'pointermove'].forEach(function (ev) {
      listTabs.addEventListener(ev, cancelListPress);
    });
  }

  /* ---------- 歌单重命名（内联编辑，不用模态） ---------- */
  var renaming = false;
  function startRename() {
    var l = findList(state.activeList);
    if (!l || l.id === 'local' || l.id === 'fav') return;  // 本地/我的喜欢名固定
    var host = $('queueTitle');
    if (!host || host.querySelector('input')) return;
    renaming = true;
    host.innerHTML = '<input class="list-name-input" id="listNameInput" type="text" maxlength="40" aria-label="歌单名">';
    var inp = $('listNameInput');
    inp.value = l.name || '';
    inp.focus();
    try { inp.select(); } catch (e) {}
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
      else if (e.key === 'Escape') { e.preventDefault(); cancelRename(); }
    });
    inp.addEventListener('blur', commitRename);
  }
  function commitRename() {
    var inp = $('listNameInput');
    if (!inp) return;
    var l = findList(state.activeList);
    var v = String(inp.value || '').trim();
    if (l && v) { l.name = v; saveLists(); }
    renaming = false;
    renderQueue();  // 重渲染队列头，输入框自然移除
  }
  function cancelRename() { renaming = false; renderQueue(); }
  if ($('renameBtn')) $('renameBtn').addEventListener('click', function (e) { e.stopPropagation(); startRename(); });

  /* ---------- 歌单删除（长按 / 右键导入列表，拍板 4）---------- */
  var listPressTimer = 0;
  var listDeleteTarget = null;
  function cancelListPress() {
    if (listPressTimer) { clearTimeout(listPressTimer); listPressTimer = 0; }
  }
  function openListPop(tab) {
    if (!tab) return;
    var id = tab.getAttribute('data-list');
    if (!id || id === 'local' || id === 'fav') return;   // 固定列表不出删除菜单
    var l = findList(id);
    if (!l) return;
    listDeleteTarget = id;
    var title = $('listPopTitle');
    if (title) title.textContent = '删除「' + (l.name || defaultListName(id)) + '」？';
    closePops();
    placePop(listPop, tab);
    suppressTabId = id;   // 紧随长按释放的 click 不当作切列表
  }
  /* 删除一个导入列表：删元数据 + 删该列表下所有曲目条目。
   * 正在播的那首被删时：继续播完，只把列表从切换条拿掉 —— 办法是**豁免当前曲目**
   * （在 state.tracks 里给它打 detached 标记、保留运行时条目；否则 currentTrack() 找不到它，
   * 标题/进度/歌词会崩）。detached 条目不回写盘（见 savePlaylist），下次启动不会把已删列表重建。
   * 本地列表不可删（它是固定文件夹的投影）。 */
  function deleteList(id) {
    id = String(id || '');
    if (!id || id === 'local') { toast('本地列表不可删除'); return false; }
    if (id === 'fav') { toast('「我的喜欢」不可删除，逐首取消红心即可'); return false; }
    var l = findList(id);
    if (!l) return false;
    var keepUid = state.currentUid;
    var dropped = 0;
    state.tracks = state.tracks.filter(function (t) {
      if (t.list !== id) return true;
      if (t.uid === keepUid) { t.detached = true; return true; }   // 豁免正在播的那首
      dropped++;
      return false;
    });
    state.lists = state.lists.filter(function (x) { return x.id !== id; });
    saveLists();
    if (state.activeList === id) {
      state.activeList = findList('local') ? 'local' : (state.lists[0] ? state.lists[0].id : 'local');
    }
    savePlaylist();   // 全量回写（detached 条目不落盘）
    renderQueue();
    renderTrack();
    renderProgress();
    persistNow();
    toast('已删除歌单「' + (l.name || defaultListName(id)) + '」' + (dropped ? '，' + dropped + ' 首' : ''));
    return true;
  }
  if (listPop) {
    $('listDeleteBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      var id = listDeleteTarget;
      listDeleteTarget = null;
      closePops();
      if (id) deleteList(id);
    });
    $('listCancelBtn').addEventListener('click', function (e) {
      e.stopPropagation();
      listDeleteTarget = null;
      closePops();
    });
  }

  /* 删除：先本地移除（即时反馈），再叫后端删列表 + 清 media/lyrics；失败回滚 */
  $('removeBtn').addEventListener('click', function () {
    if (!moreTargetUid) return;
    var uid = moreTargetUid;
    var target = trackByUid(uid);
    var wasCurrent = uid === state.currentUid;
    var idx = currentIndex();
    closePops();

    var prevTracks = state.tracks.slice();
    var prevUid = state.currentUid;
    var prevProgress = state.progress;

    state.tracks = state.tracks.filter(function (x) { return x.uid !== uid; });
    if (wasCurrent) {
      var vis = visibleTracks();
      if (vis.length) {
        var next = vis[Math.min(idx < 0 ? 0 : idx, vis.length - 1)];
        state.currentUid = next.uid;
        state.progress = 0;
        playTrack(next.uid);
      } else {
        state.currentUid = '';
        state.progress = 0;
        state.playing = false;
        resetReactive();          // 无曲可停：一并断掉频谱链
        audio.removeAttribute('src');
        try { audio.load(); } catch (e) {}
        lyricIndex = -1;
        state.lyricLines = [];
        renderLyrics();
        renderTrack();
        renderPlayState();
      }
    }
    renderQueue();
    renderProgress();
    persistNow();
    toast('已从队列移除');

    // 后端按 id + list 定位（同一首歌在两个歌单里各自独立删除）
    var qs = '?id=' + encodeURIComponent(target ? target.id : '') +
             '&list=' + encodeURIComponent(target ? target.list : '');
    function rollback() {
      toast('移除失败，已恢复');
      state.tracks = prevTracks;
      state.currentUid = prevUid;
      state.progress = prevProgress;
      renderQueue();
      renderTrack();
      renderProgress();
    }
    apiDeleteJson(ENDPOINT.track + qs).then(function (res) {
      if (!res.ok) rollback();
    }).catch(rollback);
  });

  $('importBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    var open = importPop.hidden;
    closePops();
    if (open) {
      setNote('');
      placePop(importPop, $('importBtn'));
      $('importBtn').setAttribute('aria-expanded', 'true');
      var input = $('linkInput');
      if (input) setTimeout(function () { input.focus(); }, 30);
    }
  });

  function afterImport(added, label) {
    renderQueue();
    renderTrack();
    if (added > 0) {
      savePlaylist();
      toast(label + '：新增 ' + added + ' 首');
      setNote('已新增 ' + added + ' 首');
    } else {
      toast(label + '：没有新曲目（可能已存在）');
      setNote('没有新曲目（可能已存在）');
    }
  }

  /* 新建一个导入列表并切过去 */
  function newImportList(namePrefix) {
    var id = nextImportId();
    var l = { id: id, name: namePrefix + ' ' + id.replace(/^imp:/, '') };
    state.lists.push(l);
    saveLists();
    state.activeList = id;
    return id;
  }

  /* 单曲 / 本地文件的归处（拍板 1）：归到**当前激活列表**；
   * 当前页是本地列表时（本地严格等于固定文件夹，塞不进去）退化为新建/复用
   * 一个名为 nameIfLocal 的导入列表（复用同名列表，避免越建越多），并切过去。 */
  function resolveImportTarget(nameIfLocal) {
    if (/^imp:/.test(state.activeList) && findList(state.activeList)) return state.activeList;
    for (var i = 0; i < state.lists.length; i++) {
      if (state.lists[i].id !== 'local' && state.lists[i].name === nameIfLocal) {
        state.activeList = state.lists[i].id;
        return state.lists[i].id;
      }
    }
    var id = nextImportId();
    state.lists.push({ id: id, name: nameIfLocal });
    saveLists();
    state.activeList = id;
    return id;
  }

  /* 在线链接导入：单曲 / 歌单
   *  · 歌单 → 新建一个导入列表（按导入顺序编号，名「歌单 N」，可重命名），并切过去
   *  · 单曲 → 归入当前激活列表；当前是本地列表时新建/复用名为「单曲」的导入列表 */
  function importLink(raw) {
    var v = String(raw || '').trim();
    if (!v) { setNote('请先粘贴链接'); return; }
    var isPlaylist = /playlist|toplist|album|discover\/toplist/i.test(v) || /\/album\?/.test(v);
    var idm = /[?&]id=(\d+)/.exec(v);
    var id = idm ? idm[1] : (/^\d+$/.test(v) ? v : '');
    if (!id) { setNote('无法从链接里识别歌曲 / 歌单 id'); return; }
    setNote('正在解析…');
    var url = isPlaylist
      ? ENDPOINT.musicPlaylist + '?id=' + encodeURIComponent(id) + '&server=netease'
      : ENDPOINT.song + '?id=' + encodeURIComponent(id) + '&server=netease';
    apiGetJson(url).then(function (res) {
      if (!res.ok || !res.body || !res.body.ok) {
        setNote('解析失败：' + ((res.body && res.body.error) || res.status));
        return;
      }
      var list = isPlaylist ? (res.body.tracks || []) : (res.body.track ? [res.body.track] : []);
      var targetId = isPlaylist ? newImportList('歌单') : resolveImportTarget('单曲');
      /* 歌单真名（netease 官方接口给的 meta.name）：写进列表元数据，切换条显示压缩名。
       * 后端取不到时 meta 缺失，列表保持自动名「歌单 N」（切换条退回编号）。 */
      if (isPlaylist) {
        var meta = res.body.meta;
        var metaName = meta && String(meta.name || '').trim();
        if (metaName) {
          var nl = findList(targetId);
          if (nl) {
            nl.name = metaName;
            if (meta.creator) nl.creator = String(meta.creator).trim();
            saveLists();
          }
        }
      }
      var added = mergeTracks(list, targetId);
      afterImport(added, isPlaylist ? '在线歌单' : '在线单曲');
      var input = $('linkInput');
      if (input) input.value = '';
    }).catch(function () { setNote('解析失败：网络错误'); });
  }

  /* 本地文件 / 文件夹：需要宿主文件选择器（hana.resources.pick）。
   * 纯浏览器里拿不到磁盘绝对路径 —— 明确提示，不假装能用。 */
  function hostPick(input) {
    if (!window.hana || !window.hana.resources || typeof window.hana.resources.pick !== 'function') {
      return Promise.reject(new Error('宿主不支持文件选择'));
    }
    return window.hana.resources.pick(input);
  }

  /* 扫描本地固定文件夹，**替换** local 列表内容（拍板：本地 = 严格等于该文件夹）。
   * 扫描失败时不动已存内容（不误删）。 */
  function syncLocalFolder(announce) {
    if (!state.localDir) return Promise.resolve(0);
    ensureList('local', '本地');
    return apiGetJson(ENDPOINT.scanFolder + '?path=' + encodeURIComponent(state.localDir)).then(function (r) {
      if (!r.ok || !r.body || !r.body.ok) {
        if (announce) toast('扫描失败：' + ((r.body && r.body.error) || r.status));
        return 0;
      }
      // 先拿掉旧的 local 曲目，再放入本次扫描结果（替换语义）
      state.tracks = state.tracks.filter(function (x) { return x.list !== 'local'; });
      var added = mergeTracks(r.body.files || [], 'local');
      // 正在播的那首若被本次替换移除，保留当前播放指针不强行切歌
      savePlaylist();
      renderQueue();
      if (announce) toast(added > 0 ? '本地文件夹：' + added + ' 首' : '文件夹里没有音频文件');
      return added;
    }).catch(function () { if (announce) toast('扫描失败：网络错误'); return 0; });
  }

  /* 选本地固定文件夹（入口：本地页引导按钮 / 导入面板「本地文件夹」） */
  function pickLocalFolder() {
    if (importBusy) return;
    importBusy = true;
    setNote('请选择文件夹…');
    hostPick({ mode: 'directory' }).then(function (res) {
      var ref = res && res.resources && res.resources[0];
      var dir = ref && ref.path;
      if (!dir) { setNote('未选择文件夹'); importBusy = false; return; }
      state.localDir = String(dir);
      storeSet(LOCALDIR_KEY, state.localDir);
      if (!findList('local')) ensureList('local', '本地');
      state.activeList = 'local';
      setNote('正在扫描…');
      return syncLocalFolder(true);
    }).catch(function (e) {
      setNote(e && e.message ? e.message : '文件夹选择不可用');
    }).then(function () { importBusy = false; });
  }

  function importLocalFiles() {
    if (importBusy) return;
    importBusy = true;
    setNote('请选择文件…');
    hostPick({ mode: 'file', multiple: true }).then(function (res) {
      var refs = (res && res.resources) || [];
      var paths = refs.map(function (r) { return r && r.path; }).filter(Boolean);
      if (!paths.length) { setNote('未选择文件'); importBusy = false; return; }
      setNote('导入 ' + paths.length + ' 个文件…');
      return Promise.all(paths.map(function (p) {
        return apiGetJson(ENDPOINT.importFile + '?path=' + encodeURIComponent(p))
          .then(function (r) { return (r.ok && r.body && r.body.ok) ? r.body : null; })
          .catch(function () { return null; });
      })).then(function (items) {
        // 本地文件不再往「本地列表」（那严格等于固定文件夹），归到当前导入列表；
        // 当前页是本地时新建/复用名为「本地文件」的导入列表。
        var target = resolveImportTarget('本地文件');
        afterImport(mergeTracks(items.filter(Boolean), target), '本地文件');
      });
    }).catch(function (e) {
      setNote(e && e.message ? e.message : '文件选择不可用');
    }).then(function () { importBusy = false; });
  }

  /* ---------- 歌手补齐（拍板 3，一次性全量）----------
   * 旧数据（有 searchKey、无 author）逐首走 music/search 取首条 author 写回。
   * 串行/≤3 并发 + 节流；单项失败不中断；幂等（已有 author 跳过）；带进度。
   * 只在用户点「补全歌手」时跑，**不**开机自动跑。 */
  var backfilling = false;
  function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
  function backfillTargets() {
    var out = [];
    for (var i = 0; i < state.tracks.length; i++) {
      var t = state.tracks[i];
      if (String(t.author || '').trim()) continue;                    // 幂等：已有歌手跳过
      if (String((t.raw && t.raw.searchKey) || '').trim()) out.push(t);
    }
    return out;
  }
  function backfillArtists() {
    if (backfilling) return Promise.resolve();
    var targets = backfillTargets();
    if (!targets.length) { toast('歌手已齐，无需补全'); setNote('歌手已补全'); return Promise.resolve(); }
    backfilling = true;
    var btn = $('backfillBtn');
    if (btn) btn.disabled = true;
    var cursor = 0, done = 0, ok = 0;
    setNote('补全歌手 0/' + targets.length + '…');
    toast('开始补全 ' + targets.length + ' 首的歌手');

    function worker() {
      if (cursor >= targets.length) return Promise.resolve();
      var t = targets[cursor++];
      var key = String((t.raw && t.raw.searchKey) || '').trim();
      var server = String((t.raw && t.raw.searchServer) || 'netease');
      return apiGetJson(ENDPOINT.search + '?keyword=' + encodeURIComponent(key) + '&server=' + encodeURIComponent(server))
        .then(function (res) {
          if (res.ok && res.body && res.body.ok && Array.isArray(res.body.results)) {
            for (var j = 0; j < res.body.results.length; j++) {
              var a = res.body.results[j] && String(res.body.results[j].author || '').trim();
              if (a) { t.author = a; t.artist = a; if (t.raw) t.raw.author = a; ok++; break; }
            }
          }
        })
        .catch(function () { /* 单项失败不中断整体 */ })
        .then(function () {
          done++;
          setNote('补全歌手 ' + done + '/' + targets.length + '…');
          if (done % 25 === 0) savePlaylist();   // 中途落盘，防打断丢进度
          return sleep(80).then(worker);         // 节流
        });
    }
    var runners = [];
    for (var k = 0; k < 3; k++) runners.push(worker());   // ≤3 并发
    return Promise.all(runners).then(function () {
      backfilling = false;
      if (btn) btn.disabled = false;
      savePlaylist();
      renderQueue();
      renderTrack();
      setNote('歌手补全完成：' + ok + '/' + targets.length);
      toast('歌手补全完成：' + ok + '/' + targets.length);
    });
  }

  importPop.addEventListener('click', function (e) {
    var item = e.target.closest('[data-import]');
    if (item) {
      var kind = item.getAttribute('data-import');
      if (kind === 'file') importLocalFiles();
      else if (kind === 'folder') pickLocalFolder();
      else if (kind === 'backfill') backfillArtists();
      return;
    }
    if (e.target.closest('#linkAddBtn')) {
      importLink($('linkInput') ? $('linkInput').value : '');
    }
  });
  var linkInput = $('linkInput');
  if (linkInput) {
    linkInput.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); importLink(linkInput.value); }
    });
  }

  document.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.pop') || e.target.closest('.q-more') || e.target.closest('#importBtn')) return;
    closePops();
  });

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    if (!morePop.hidden || !importPop.hidden) { closePops(); return; }
    if (player.getAttribute('data-layout') === 'wide' && state.drawer) closeDrawer();
  });

  /* ============================================================
     布局：按容器尺寸切三种形态
     ============================================================ */
  var layout = 'long';
  function applyLayout() {
    var r = frame.getBoundingClientRect();
    var w = r.width;
    var h = r.height;
    var next = w >= 720 ? 'wide' : (h < 560 ? 'compact' : 'long');
    /* 窄容器（真机聊天卡实测 ~312px）控制条走紧凑排布（R6）：
     * 只收排布不藏控件，断言里 control-visible:* 仍然逐个校验。 */
    player.setAttribute('data-bar', w < 420 ? 'tight' : 'loose');
    if (next !== layout) {
      layout = next;
      player.setAttribute('data-layout', next);
      if (next !== 'wide') state.drawer = false;
      if (next !== 'compact') state.page = 'play';
      renderChrome();
    }
    updateStageMetrics();
    sizeLyricPad();
    updateLyricIndex(true);
    positionSplitHandle();
  }
  if (window.ResizeObserver) {
    new ResizeObserver(applyLayout).observe(frame);
  } else {
    window.addEventListener('resize', applyLayout);
  }

  /* ---------- 舞台/队列 可拖分隔线（仅长卡，motion/布局）----------
   * 拖动改封面区/队列区比例，写 --stage-flex/--queue-flex；松手落盘（player-split）。
   * 只动 flex，不动 width/height；可打断（指针一抬就结束）。 */
  var SPLIT_KEY = 'player-split';
  var splitHandle = $('splitHandle');
  var stageEl = $('stage');
  function setSplit(ratio, persist) {
    var r = Math.max(0.25, Math.min(0.78, ratio));
    state.splitRatio = r;
    player.style.setProperty('--stage-flex', String(Math.round(r * 100)));
    player.style.setProperty('--queue-flex', String(Math.round((1 - r) * 100)));
    positionSplitHandle();
    if (persist) storeSet(SPLIT_KEY, r);
  }
  function positionSplitHandle() {
    if (!splitHandle || player.getAttribute('data-layout') !== 'long') return;
    /* 交界 = scene 的底（不是 #stage 的底 —— stage 把 queue 也包进去了）。
     * top 相对 #stage（position:relative 的祖先）。 */
    var sceneEl = $('scene');
    if (!sceneEl) return;
    var sbr = sceneEl.getBoundingClientRect();
    var stb = stageEl.getBoundingClientRect();
    splitHandle.style.top = Math.round(sbr.bottom - stb.top) + 'px';
  }
  if (splitHandle && stageEl) {
    splitHandle.hidden = false;
    var splitting = false;
    splitHandle.addEventListener('pointerdown', function (e) {
      if (player.getAttribute('data-layout') !== 'long') return;
      splitting = true;
      player.classList.add('is-splitting');
      try { splitHandle.setPointerCapture(e.pointerId); } catch (err) {}
      e.preventDefault();
    });
    splitHandle.addEventListener('pointermove', function (e) {
      if (!splitting) return;
      /* 指针相对分区容器（#stage）的高度比 = 封面区占比。
       * 用 stage 自身的矩形做基准（它已排除控制条），不要用 frame。 */
      var stb = stageEl.getBoundingClientRect();
      var avail = stb.height || 1;
      var y = e.clientY - stb.top;
      setSplit(y / avail, false);
    });
    function endSplit() {
      if (!splitting) return;
      splitting = false;
      player.classList.remove('is-splitting');
      setSplit(state.splitRatio, true);
      updateStageMetrics();
      sizeLyricPad();
    }
    splitHandle.addEventListener('pointerup', endSplit);
    splitHandle.addEventListener('pointercancel', endSplit);
    window.addEventListener('resize', positionSplitHandle);
  }

  /* ============================================================
     主题（R5 + macOS 夜间模式）
     优先级：宿主显式注入的变量 > @media prefers-color-scheme 兜底 > 写死默认。
     style.css 的 --hk-* 桥已保证优先级；这里负责「让宿主值真的进来」：
     宿主把 hana-css / hana-palette-* 拼进 iframe URL，但 SDK 只在用户换主题
     （THEME_CHANGED）时才拉样式表，初始并不拉 —— 线上从未见过 theme.css 请求，
     --accent 一直落兜底就是这个原因。这里按 Creator 模板的方式自己补初始注入：
       1) 有 hana-palette-light/dark-css → 分别包 @media 注入（跟随 macOS 深浅，
          用宿主真主题的深浅两套，不是自己配的颜色）；
       2) 否则有 hana-css → 注入单份；
       3) 都没有但知道主题名 → 自己拉 /api/apps/theme.css?theme=…；
       4) 全都没有 → 不注水，交给 CSS 兜底层（prefers-color-scheme）。
     拉不到就静默降级，绝不硬编宿主主题值。 */
  function setThemeStyle(key, css) {
    var el = document.querySelector('style[data-app-theme="' + key + '"]');
    if (!css) {
      if (el && el.parentNode) el.parentNode.removeChild(el);
      return;
    }
    if (!el) {
      el = document.createElement('style');
      el.setAttribute('data-app-theme', key);
      (document.head || document.documentElement).appendChild(el);
    }
    el.textContent = css;
  }
  function fetchThemeCss(url) {
    return apiText(url).then(function (r) {
      return (r.ok && r.text && r.text.indexOf('{') >= 0) ? r.text : '';
    }).catch(function () { return ''; });
  }
  var themeGen = 0;
  function injectHostTheme(snap, isUpdate) {
    var gen = ++themeGen;
    function put(url, key, media) {
      return fetchThemeCss(url).then(function (css) {
        if (gen !== themeGen || !css) return;
        if (media) css = '@media (prefers-color-scheme: ' + media + ') {\n' + css + '\n}';
        setThemeStyle(key, css);
      });
    }
    if (isUpdate && snap && snap.cssUrl) {
      /* 运行时换主题：单份覆盖，初始的 palette 对必须撤掉，避免夜间态串色 */
      setThemeStyle('palette-light', '');
      setThemeStyle('palette-dark', '');
      return put(snap.cssUrl, 'base', '');
    }
    if (!isUpdate) {
      var lightCss = params.get('hana-palette-light-css');
      var darkCss = params.get('hana-palette-dark-css');
      if (lightCss && darkCss) {
        return Promise.all([
          put(lightCss, 'palette-light', 'light'),
          put(darkCss, 'palette-dark', 'dark')
        ]);
      }
      var cssUrl = params.get('hana-css');
      if (cssUrl) return put(cssUrl, 'base', '');
    }
    var name = (snap && snap.theme) || params.get('hana-theme') || '';
    if (name) return put('/api/apps/theme.css?theme=' + encodeURIComponent(name), 'base', '');
    return Promise.resolve();
  }
  function applyHostTheme() {
    var forced = params.get('theme');
    if (forced) { document.documentElement.setAttribute('data-theme', forced); return; }
    try {
      if (window.hana && window.hana.theme) {
        var snap0 = window.hana.theme.getSnapshot ? window.hana.theme.getSnapshot() : null;
        if (snap0 && snap0.theme) document.documentElement.setAttribute('data-theme', snap0.theme);
        injectHostTheme(snap0, false);
        if (typeof window.hana.theme.subscribe === 'function') {
          var first = true;
          window.hana.theme.subscribe(function (s) {
            if (s && s.theme) document.documentElement.setAttribute('data-theme', s.theme);
            /* 首次回调是当前快照回放，注入已在上面做过，不重复 */
            if (first) { first = false; return; }
            injectHostTheme(s, true);
          });
        }
        return;
      }
    } catch (e) { /* 无宿主主题：交给 CSS 兜底层 */ }
    injectHostTheme(null, false);
  }

  /* ============================================================
     初始化
     ============================================================ */
  function renderAll() {
    renderTrack();
    renderQueue();
    renderProgress();
    renderVolume();
    renderMode();
    renderPlayState();
    renderLyricMode();
    renderLyrics();
    renderSpectrum();
    renderResume();
    renderChrome();
  }

  function applyTracks(tracks) {
    state.tracks = tracks;
    if (!state.tracks.length) { state.currentUid = ''; }
    else if (!trackByUid(state.currentUid)) {
      var vis = visibleTracks();
      state.currentUid = (vis[0] || state.tracks[0]).uid;
    }
  }

  function restorePlayback(pb) {
    if (pb) {
      if (typeof pb.volume === 'number' && isFinite(pb.volume)) state.volume = Math.max(0, Math.min(1, pb.volume));
      state.muted = !!pb.muted;
      if (pb.mode === 'one' || pb.mode === 'shuffle' || pb.mode === 'list') state.mode = pb.mode;
      if (Array.isArray(pb.shuffleTrail)) {
        shuffleTrail = pb.shuffleTrail
          .filter(function (x) { return typeof x === 'string' && x; })
          .slice(-SHUFFLE_TRAIL_MAX);
      }
    }
    renderVolume();
    renderMode();
    renderLyricMode();
    audio.volume = state.volume;
    audio.muted = state.muted;

    // 恢复当前曲目：优先 uid（list|id）；旧版存的是裸 id，兼容回退
    var t = trackByUid(pb && pb.currentId);
    if (!t && pb && pb.currentId) {
      for (var i = 0; i < state.tracks.length; i++) {
        if (state.tracks[i].id === pb.currentId) { t = state.tracks[i]; break; }
      }
    }
    if (!t) t = visibleTracks()[0] || state.tracks[0] || null;
    if (!t) {
      renderTrack();
      renderQueue();
      renderProgress();
      renderPlayState();
      return;
    }
    state.currentUid = t.uid;
    state.progress = pb && Number(pb.progress) > 0 ? Number(pb.progress) : 0;
    var wantPlay = !!(pb && pb.playing);
    state.playing = false;
    renderTrack();
    renderQueue();
    renderProgress();
    renderPlayState();
    updateLyricIndex(true);
    loadLyrics(t);
    if (t.url) {
      loadAudio(t, state.progress, wantPlay);
    } else if (wantPlay) {
      ensurePlayable(t).then(function (ok) {
        if (!ok || state.currentUid !== t.uid) return;
        renderTrack();
        renderQueue();
        loadLyrics(t);
        loadAudio(t, state.progress, true);
      });
    }
  }

  /* 列表名快照：只在真名确实变了才重渲染 */
  function listNamesKey() {
    var out = [];
    for (var i = 0; i < state.lists.length; i++) out.push(state.lists[i].id + '=' + (state.lists[i].name || ''));
    return out.join('|');
  }

  function boot() {
    renderAll();
    applyLayout();

    /* boot() 跑在 app.js（defer）里，早于 sdk.js（module）——那时 window.hana 还没有，
     * hanaStorage() 为 null。所以必须先等宿主 SDK 落地再读存储；否则永远读回 null，
     * 而回写默认名会把用户改过的歌单名覆盖回「歌单 N」（改名不持久化的根因）。 */
    waitForHana(2000).then(function () {
      return Promise.all([
        loadPlaylist().catch(function (e) {
          state.loadError = e && e.message ? e.message : String(e);
          console.warn('[player] playlist 读取失败', e);
          return null;
        }),
        loadPlaybackState()
      ]);
    }).then(function (results) {
      var tracks = results[0];
      var pb = results[1];
      applyHostTheme();
      /* 先用派生名把列表立起来：首屏不等存储读取（宿主桥没应答时不至于卡住） */
      if (tracks) {
        var needsAssign = migrateLists(tracks, null);
        applyTracks(tracks);                             // 先落 state.tracks
        if (needsAssign) savePlaylist();                 // 再回写（savePlaylist 读的是 state.tracks）
      } else {
        state.lists = [{ id: 'local', name: '本地' }];
      }
      // 恢复当前列表
      if (pb && pb.activeList && findList(pb.activeList)) state.activeList = pb.activeList;
      else if (!findList(state.activeList)) state.activeList = 'local';
      restorePlayback(pb);
      if (!tracks) toast('列表加载失败，请稍后重试');
      if (params.get('assert') === '1') setTimeout(runSelfCheck, 60);
      /* 再读存储：读到就套用真名 / 本地目录 / 分隔比例。
       * 读不到（宿主没应答）绝不回写默认值 —— 那会把盘上的真名覆盖掉。 */
      return Promise.all([storeRead(LISTS_KEY), storeRead(LOCALDIR_KEY), storeRead(SPLIT_KEY)]);
    }).then(function (reads) {
      var listsRead = reads[0], dirRead = reads[1], splitRead = reads[2];
      if (dirRead.value) { state.localDir = String(dirRead.value); syncLocalFolder(false); }
      var sp = splitRead.value;
      if (typeof sp === 'number' && sp > 0 && sp < 1) setSplit(sp, false);
      if (listsRead.ok && state.tracks.length) {
        var before = listNamesKey();
        if (migrateLists(state.tracks, listsRead.value)) savePlaylist();
        saveLists();
        if (before !== listNamesKey()) renderAll();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

  /* ============================================================
     自检：?assert=1 时在页面里跑一遍清单并输出到 #report
     （dev 截图/断言用；不参与正常使用）
     ============================================================ */
  function runSelfCheck() {
    var checks = [];
    var fr = frame.getBoundingClientRect();

    function add(name, ok, detail) {
      checks.push({ name: name, ok: !!ok, detail: String(detail === undefined ? '' : detail) });
    }
    function inside(r) {
      return r.left >= fr.left - 1 && r.top >= fr.top - 1 &&
             r.right <= fr.right + 1 && r.bottom <= fr.bottom + 1;
    }
    function shown(el) {
      var cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return false;
      var r = el.getBoundingClientRect();
      return r.width > 0 && r.height > 0;
    }

    /* 1. 不出现整页滚动条 */
    var de = document.documentElement;
    add('no-page-scroll',
      de.scrollHeight <= window.innerHeight + 1 && de.scrollWidth <= window.innerWidth + 1,
      'doc ' + de.scrollWidth + 'x' + de.scrollHeight + ' / viewport ' + window.innerWidth + 'x' + window.innerHeight);

    /* 2. 横向不溢出 */
    add('no-h-overflow',
      player.scrollWidth <= player.clientWidth + 1 && queueList.scrollWidth <= queueList.clientWidth + 1,
      'player ' + player.scrollWidth + '/' + player.clientWidth);

    /* 3. 顶栏在容器内可见 */
    var topbar = (player.getAttribute('data-layout') === 'compact' && state.page === 'queue')
      ? queue : sceneTop;
    var tr = topbar.getBoundingClientRect();
    add('topbar-visible', shown(topbar) && inside(tr),
      Math.round(tr.left) + ',' + Math.round(tr.top) + ' ' + Math.round(tr.width) + 'x' + Math.round(tr.height));

    /* 4. 右上 100x40 宿主安全区没有控件 */
    var safe = { left: fr.right - 100, top: fr.top, right: fr.right, bottom: fr.top + 40 };
    var hits = [];
    player.querySelectorAll('button, input').forEach(function (el) {
      if (!shown(el)) return;
      var r = el.getBoundingClientRect();
      if (r.right > safe.left && r.left < safe.right && r.bottom > safe.top && r.top < safe.bottom) {
        hits.push(el.id || el.className);
      }
    });
    add('host-safe-clear', hits.length === 0, hits.join(','));

    /* 5. 播放控制全在容器内 */
    ['playBtn', 'prevBtn', 'nextBtn', 'modeBtn', 'seek', 'muteBtn', 'favBtn', 'queueBtn'].forEach(function (id) {
      var el = $(id);
      add('control-visible:' + id, shown(el) && inside(el.getBoundingClientRect()), '');
    });
    // 音量滑杆只在宽窗出现（窄容器放不下，改由静音键承担）；出现时必须完整可见
    if (shown($('vol'))) add('control-visible:vol', inside($('vol').getBoundingClientRect()), '');

    /* 6/7. 队列能滚到底，且滚动时顶栏不动 */
    var queueVisible = shown(queueList) && queueList.scrollHeight > queueList.clientHeight;
    if (queueVisible) {
      var before = topbar.getBoundingClientRect();
      queueList.scrollTop = 0;
      var atTop = queueList.scrollTop;
      queueList.scrollTop = queueList.scrollHeight;
      var atBottom = queueList.scrollTop;
      var after = topbar.getBoundingClientRect();
      var reached = atBottom + queueList.clientHeight >= queueList.scrollHeight - 2;
      add('queue-scroll-bottom', reached && atBottom > atTop,
        'scrollTop ' + Math.round(atTop) + ' -> ' + Math.round(atBottom) + ' / content ' + queueList.scrollHeight + ' / view ' + queueList.clientHeight);
      add('topbar-stable-on-scroll',
        Math.abs(before.top - after.top) < 0.5 && Math.abs(before.height - after.height) < 0.5,
        'top ' + before.top.toFixed(1) + ' -> ' + after.top.toFixed(1));
      queueList.scrollTop = params.get('queuepos') === 'bottom' ? queueList.scrollHeight : 0;
    } else {
      add('queue-scroll-bottom', true, 'n/a（本状态下队列不滚动：内容不足或已隐藏）');
      add('topbar-stable-on-scroll', true, 'n/a（同上）');
    }

    var hasLyrics = player.getAttribute('data-haslyrics') === '1';
    /* 7b. 歌词只滚自己：不牵动顶栏、控制条、队列 */
    if (hasLyrics && shown(lyrics) && lyrics.scrollHeight > lyrics.clientHeight + 1) {
      var topBefore = sceneTop.getBoundingClientRect().top;
      var ctlBefore = $('controls').getBoundingClientRect().top;
      var qBefore = queueList.scrollTop;
      var saved = lyrics.scrollTop;
      lyrics.scrollTop = lyrics.scrollHeight;
      var okIso = Math.abs(sceneTop.getBoundingClientRect().top - topBefore) < 0.5 &&
                  Math.abs($('controls').getBoundingClientRect().top - ctlBefore) < 0.5 &&
                  Math.abs(queueList.scrollTop - qBefore) < 0.5;
      add('lyric-scroll-isolated', okIso,
        'topbar ' + topBefore.toFixed(1) + '->' + sceneTop.getBoundingClientRect().top.toFixed(1) +
        ' / controls ' + ctlBefore.toFixed(1) + '->' + $('controls').getBoundingClientRect().top.toFixed(1) +
        ' / queueScroll ' + qBefore + '->' + queueList.scrollTop);
      lyrics.scrollTop = saved;
    } else {
      add('lyric-scroll-isolated', true, 'n/a（歌词关闭或本状态下歌词不滚动）');
    }

    /* 8. 歌词不横向溢出 */
    if (hasLyrics && shown(lyrics)) {
      add('lyric-no-overflow', lyrics.scrollWidth <= lyrics.clientWidth + 1,
        'lyrics ' + lyrics.scrollWidth + '/' + lyrics.clientWidth);
    } else {
      add('lyric-no-overflow', true, 'n/a（歌词关闭）');
    }

    /* 9. 无词兜底（R4）：无词只出频谱，蒙层/渐变必须保持在线 */
    if (!hasLyrics) {
      add('spectrum-swap-when-no-lyrics',
        !shown(lyricWrap) && shown(lyricScrim) && shown($('spectrum')),
        'wrap=' + getComputedStyle(lyricWrap).display +
        ' scrim=' + getComputedStyle(lyricScrim).display +
        ' spec=' + getComputedStyle($('spectrum')).display);
    } else if (shown($('scene'))) {
      add('lyrics-swap-when-lyrics-on',
        shown(lyricWrap) && shown(lyricScrim) && !shown($('spectrum')), '');
    } else {
      add('lyrics-swap-when-lyrics-on', true, 'n/a（本状态整页是队列页，舞台整体隐藏）');
    }

    /* 9b. 标题块与歌词/频谱文字不得重叠（舞台重构遗留缺陷） */
    if (shown($('scene'))) {
      var tb = sceneTop.getBoundingClientRect();
      var band = ((hasLyrics && shown(lyricWrap)) ? lyricWrap : $('spectrum')).getBoundingClientRect();
      add('title-not-overlap-content', band.top >= tb.bottom - 1,
        'titleBottom=' + Math.round(tb.bottom) + ' contentTop=' + Math.round(band.top));
    }
    /* 10. 字号下限 */
    var small = [];
    player.querySelectorAll('*').forEach(function (el) {
      if (!shown(el)) return;
      if (!el.textContent.trim() && el.tagName !== 'INPUT') return;
      var fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < 11) small.push((el.id || el.className || el.tagName) + '=' + fs);
    });
    add('font-min-11px', small.length === 0, small.join(','));

    /* 11. 无 emoji */
    var emoji = /\p{Extended_Pictographic}/u.test(player.textContent);
    add('no-emoji', !emoji, '');

    /* 12. 根容器：无外描边/外阴影；顶部两角圆、下两角直角。
     *     宿主在独立窗里会把 App 面裁圆，卡片里不裁 —— 所以卡片壳自己补上顶部圆角，
     *     值跟宿主 token 走（body[data-shell] 两条，见 style.css）。 */
    var cs = getComputedStyle(player);
    var topR = parseFloat(cs.borderTopLeftRadius) || 0;
    var botR = parseFloat(cs.borderBottomLeftRadius) || 0;
    add('root-corners-and-no-shadow',
      topR >= 12 && botR === 0 && cs.boxShadow === 'none' &&
      cs.borderTopWidth === '0px' && cs.borderLeftWidth === '0px',
      cs.borderRadius + ' / ' + cs.boxShadow);

    var payload = {
      type: 'self-check',
      case: [window.innerWidth + 'x' + window.innerHeight, themeLabel(), hasLyrics ? 'lyrics-on' : 'no-lyrics', player.getAttribute('data-layout')].join(' / '),
      passed: checks.filter(function (c) { return !c.ok; }).length === 0,
      checks: checks
    };
    var rep = $('report');
    if (rep) rep.textContent = JSON.stringify(payload, null, 2);
    return payload;
  }
  function themeLabel() {
    return document.documentElement.getAttribute('data-theme') || 'light';
  }
  window.__playerSelfCheck = runSelfCheck;
  /* 自检钩子：频谱反应链的可观测状态 + 可直接喂 bins 验证映射（测试用） */
  window.__playerDebug = {
    reactive: function () {
      return { ready: reactive.ready, failed: reactive.failed, state: reactive.actx ? reactive.actx.state : 'none' };
    },
    applyBins: applyBins,
    /* 跨源歌词兜底的匹配判定（测试用）：不依赖网络，直接喂结果集。 */
    pickLyricHit: pickLyricHit,
    normLyricTitle: normLyricTitle,
    normLyricAuthor: normLyricAuthor
  };
})();
