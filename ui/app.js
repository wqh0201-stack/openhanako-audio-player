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
    scanFolder: API + '/widget/api/scan-folder'
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

  function normalizeTrack(raw) {
    var t = raw && typeof raw === 'object' ? raw : {};
    var url = String(t.url || '');
    var mode = t.mode === '在线' ? '在线' : (t.mode === '本地' ? '本地' : (t.group === '在线音乐' ? '在线' : '本地'));
    var title = String(t.name || t.title || '').trim() || '未命名';
    var author = String(t.author || '').trim();
    return {
      id: deriveId(t, url),
      title: title,
      artist: author || String(t.group || '').trim() || (mode === '在线' ? '在线音乐' : '本地音乐'),
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
    currentId: '',
    progress: 0,
    volume: 0.8,
    muted: false,
    mode: 'list',
    lyrics: true,      // 对外字段名 lyricsVisible
    playing: false,
    follow: true,
    page: 'play',
    drawer: false,
    lyricLines: [],
    loadError: ''
  };

  /* ---------- 记忆：hana.storage.global（不写 localStorage） ---------- */
  var STORE_KEY = 'player-playback-state';
  function hanaStorage() {
    return (window.hana && window.hana.storage && window.hana.storage.global) || null;
  }
  function unwrapStored(v) {
    if (v && typeof v === 'object' && !Array.isArray(v) && ('value' in v)) return v.value;
    return v;
  }
  function snapshot() {
    return {
      currentId: state.currentId,
      progress: Math.round(state.progress * 10) / 10,
      volume: state.volume,
      muted: !!state.muted,
      mode: state.mode,
      lyricsVisible: !!state.lyrics,
      playing: !!state.playing
    };
  }

  /* 写入：串行链 + 节流；切歌/暂停/导入/删除走立即写 */
  var writeChain = Promise.resolve();
  var writeTimer = 0;
  function persistNow() {
    clearTimeout(writeTimer);
    var snap = snapshot();
    writeChain = writeChain.then(function () {
      var st = hanaStorage();
      if (!st) return null;
      return Promise.resolve(st.set(STORE_KEY, snap)).catch(function (e) {
        console.warn('[player] playback-state 写入失败', e);
      });
    });
    return writeChain;
  }
  function persistThrottled() {
    clearTimeout(writeTimer);
    writeTimer = setTimeout(persistNow, 900);
  }
  function persistState() { persistThrottled(); }

  function loadPlaybackState() {
    var st = hanaStorage();
    if (!st) return Promise.resolve(null);
    return Promise.resolve(st.get(STORE_KEY, { timeoutMs: 3000 })).then(function (raw) {
      var v = unwrapStored(raw);
      return v && typeof v === 'object' ? v : null;
    }).catch(function (e) {
      console.warn('[player] playback-state 读取失败', e);
      return null;
    });
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
    var payload = { tracks: state.tracks.map(toStoredTrack) };
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

  /* 把新曲目并入列表（按稳定 id 去重，保留原位置；同 id 覆盖补充信息）。
   * 返回真正新增的条数。 */
  function mergeTracks(incoming) {
    var index = {};
    var i;
    for (i = 0; i < state.tracks.length; i++) index[state.tracks[i].id] = i;
    var added = 0;
    for (i = 0; i < incoming.length; i++) {
      var t = normalizeTrack(incoming[i]);
      if (index[t.id] !== undefined) {
        state.tracks[index[t.id]] = t;
      } else {
        index[t.id] = state.tracks.length;
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
  var queueList = $('queueList');
  var lyrics = $('lyrics');
  var lyricWrap = $('lyricWrap');
  var lyricScrim = $('lyricScrim');
  var lyricBack = $('lyricBack');
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
  function currentTrack() {
    for (var i = 0; i < state.tracks.length; i++) {
      if (state.tracks[i].id === state.currentId) return state.tracks[i];
    }
    return state.tracks[0] || null;
  }
  function trackById(id) {
    for (var i = 0; i < state.tracks.length; i++) {
      if (state.tracks[i].id === id) return state.tracks[i];
    }
    return null;
  }
  function currentIndex() {
    for (var i = 0; i < state.tracks.length; i++) {
      if (state.tracks[i].id === state.currentId) return i;
    }
    return -1;
  }
  /* 时长：优先拿真实 <audio> 的（本地/在线都可能比列表里存的准） */
  function trackDuration(t) {
    if (!t) return 0;
    if (t.id === state.currentId && isFinite(audio.duration) && audio.duration > 0) return audio.duration;
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
  function applyCovers() {
    var t = currentTrack();
    var pic = t && t.pic ? t.pic : '';
    /* 呈现层标记：无封面时走「纸面留白」兜底（只切 CSS 变量，不动业务） */
    player.classList.toggle('nocover', !pic);
    $('cover').style.backgroundImage = coverImage(pic);
    var rows = queueList.querySelectorAll('.q-row');
    for (var i = 0; i < rows.length; i++) {
      var tr = state.tracks[i];
      var el = rows[i].querySelector('.q-cover');
      if (el && tr) el.style.backgroundImage = coverImage(tr.pic || '');
    }
  }

  /* ============================================================
     渲染
     ============================================================ */
  function renderTrack() {
    var t = currentTrack();
    if (!t) {
      $('trackTitle').textContent = '还没有曲目';
      $('trackArtist').textContent = '用右上角的 ＋ 导入';
      $('ciTitle').textContent = '还没有曲目';
      $('ciArtist').textContent = '';
      seek.max = '0';
      $('durTime').textContent = '--:--';
      applyCovers();
      return;
    }
    $('trackTitle').textContent = t.title;
    $('trackArtist').textContent = t.artist;
    $('ciTitle').textContent = t.title;
    $('ciArtist').textContent = t.artist;
    var d = trackDuration(t);
    seek.max = String(d || 0);
    $('durTime').textContent = d ? fmtTime(d) : '--:--';
    applyCovers();
  }

  function renderQueue() {
    var html = '';
    for (var i = 0; i < state.tracks.length; i++) {
      var t = state.tracks[i];
      var cur = t.id === state.currentId;
      html += '<li class="q-row' + (cur ? ' is-current' : '') + '" data-id="' + esc(t.id) + '">' +
        '<button class="q-hit" type="button" title="' + esc(t.title + (t.artist ? ' — ' + t.artist : '')) + '">' +
          '<span class="q-cover"></span>' +
          '<span class="q-meta">' +
            '<span class="q-title">' + esc(t.title) + '</span>' +
            '<span class="q-artist">' + esc(t.artist) + '</span>' +
          '</span>' +
          /* 正在播放指示：行内 SVG（不走 <use>，否则选择器进不了 shadow tree，条形动画不会生效） */
          '<span class="q-eq"><svg viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="M6.5 9.5v9"/><path d="M12 5.5v13"/><path d="M17.5 11.5v7"/>' +
          '</svg></span>' +
          '<span class="q-dur">' + (t.dur ? fmtTime(t.dur) : '--:--') + '</span>' +
        '</button>' +
        '<button class="q-more" type="button" aria-label="更多操作：' + esc(t.title) + '">' + icon('i-more') + '</button>' +
      '</li>';
    }
    if (!html) {
      html = '<li class="q-empty">还没有曲目，点右上角的 ＋ 导入</li>';
    }
    queueList.innerHTML = html;
    applyCovers();
    var n = state.tracks.length;
    $('queueCount').textContent = String(n);
    $('queueBtnCount').textContent = String(n);
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

  function renderLyricToggle() {
    var btn = $('lyricToggle');
    btn.setAttribute('aria-pressed', state.lyrics ? 'true' : 'false');
    btn.title = '歌词显示：' + (state.lyrics ? '开' : '关');
    player.setAttribute('data-lyrics', state.lyrics ? '1' : '0');
  }

  function renderLyrics() {
    var html = '';
    if (!state.lyricLines.length) {
      html = '<p class="lyric-line lyric-empty">暂无歌词</p>';
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
    if (!state.lyrics) return;
    var h = lyricWrap.clientHeight;
    if (!h) return;
    var pad = Math.max(28, Math.round(h / 2 - 26));
    lyrics.style.paddingTop = pad + 'px';
    lyrics.style.paddingBottom = pad + 'px';
  }

  function centerCurrentLine(instant) {
    if (!state.lyrics || !state.follow) return;
    var el = lyrics.querySelector('.lyric-line.is-current');
    if (!el) return;
    var target = el.offsetTop - lyrics.offsetTop - lyricWrap.clientHeight / 2 + el.offsetHeight / 2;
    lyrics.scrollTo({ top: Math.max(0, target), behavior: instant ? 'auto' : 'smooth' });
  }

  function updateLyricIndex(instant) {
    if (!state.lyrics) return;
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

  function pauseFollow() {
    if (!state.follow) return;
    state.follow = false;
    lyricBack.hidden = false;
  }
  function resumeFollow() {
    state.follow = true;
    lyricBack.hidden = true;
    centerCurrentLine(false);
    persistState();
  }

  lyricWrap.addEventListener('wheel', pauseFollow, { passive: true });
  lyricWrap.addEventListener('touchstart', pauseFollow, { passive: true });
  lyricWrap.addEventListener('pointerdown', function (e) {
    if (e.target.closest('.lyric-back')) return;
    pauseFollow();
  });
  lyricBack.addEventListener('click', resumeFollow);

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

  /* 降级链：离线库 → music/lrc → lrc-proxy → ttml(404 退空)。
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

    apiGetJson(ENDPOINT.lrcLoad + '?name=' + encodeURIComponent(t.title)).then(function (res) {
      if (gen !== lyricGen) return;
      if (res.ok && res.body && res.body.ok && res.body.lrc) return done(parseLrc(res.body.lrc), null);
      return online();
    }).catch(function () { return online(); });
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
      audio.src = srcUrl;
      try { audio.load(); } catch (e) {}
    }
    pendingSeek = seekTo > 0 ? seekTo : 0;
    pendingAutoplay = !!autoplay;
    if (same && pendingAutoplay && audio.paused) {
      // 同一首（恢复场景）：直接播
      audio.play().catch(onAutoplayBlocked);
      pendingAutoplay = false;
    }
  }

  function onAutoplayBlocked(e) {
    if (e && e.name === 'AbortError') return;
    state.playing = false;
    renderPlayState();
    toast('需要点击播放');
  }

  audio.addEventListener('loadedmetadata', function () {
    var t = currentTrack();
    var real = isFinite(audio.duration) && audio.duration > 0 ? audio.duration : 0;
    if (t && real > 0 && !(Number(t.dur) > 0)) { t.dur = real; scheduleDurSave(); }
    if (pendingSeek > 0) {
      var max = real;
      audio.currentTime = max ? Math.min(pendingSeek, Math.max(0, max - 0.25)) : pendingSeek;
    }
    pendingSeek = 0;
    renderTrack();
    renderQueue();
    renderProgress();
    if (pendingAutoplay) {
      pendingAutoplay = false;
      audio.play().catch(onAutoplayBlocked);
    }
  });

  audio.addEventListener('timeupdate', function () {
    if (!isFinite(audio.currentTime)) return;
    state.progress = audio.currentTime;
    renderProgress();
    updateLyricIndex(false);
    persistState();
  });

  audio.addEventListener('play', function () {
    state.playing = true;
    renderPlayState();
  });
  audio.addEventListener('pause', function () {
    state.playing = false;
    renderPlayState();
  });
  audio.addEventListener('ended', function () { onTrackEnd(); });
  audio.addEventListener('error', function () {
    var t = currentTrack();
    if (!t || !t.url) return;
    state.playing = false;
    renderPlayState();
    toast('播放失败：' + t.title);
  });

  function stepIndex(dir) {
    var n = state.tracks.length;
    if (!n) return -1;
    var i = currentIndex();
    if (i < 0) return dir >= 0 ? 0 : n - 1;
    if (state.mode === 'shuffle') {
      if (n === 1) return 0;
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
    if (i >= 0) playTrack(state.tracks[i].id);
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

  function playTrack(id, keepProgress) {
    var t = trackById(id);
    if (!t) return;
    var changed = id !== state.currentId;
    state.currentId = id;
    if (changed && !keepProgress) state.progress = 0;
    if (changed) {
      lyricIndex = -1;
      state.follow = true;
      lyricBack.hidden = true;
    }
    state.playing = true;
    renderTrack();
    renderQueue();
    renderProgress();
    renderPlayState();
    updateLyricIndex(true);
    if (changed) loadLyrics(t);
    if (t.url) {
      loadAudio(t, changed ? 0 : state.progress, true);
    } else {
      // 无 url：可能是旧版 searchKey 曲目，异步解析后再播
      ensurePlayable(t).then(function (ok) {
        if (!ok || state.currentId !== t.id) return;
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

  $('prevBtn').addEventListener('click', function () {
    var i = stepIndex(-1);
    if (i >= 0) playTrack(state.tracks[i].id);
  });

  $('nextBtn').addEventListener('click', function () {
    var i = stepIndex(1);
    if (i >= 0) playTrack(state.tracks[i].id);
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

  $('lyricToggle').addEventListener('click', function () {
    state.lyrics = !state.lyrics;
    lyricIndex = -1;
    renderLyricToggle();
    if (state.lyrics) {
      sizeLyricPad();
      updateLyricIndex(true);
    }
    persistState();
  });

  $('queueBtn').addEventListener('click', function () {
    var layout = player.getAttribute('data-layout');
    if (layout === 'wide') {
      state.drawer = !state.drawer;
    } else if (layout === 'compact') {
      state.page = state.page === 'play' ? 'queue' : 'play';
    }
    renderChrome();
    persistState();
  });

  $('backBtn').addEventListener('click', function () {
    state.page = 'play';
    renderChrome();
    persistState();
  });

  $('drawerCloseBtn').addEventListener('click', closeDrawer);

  function closeDrawer() {
    state.drawer = false;
    renderChrome();
    persistState();
  }

  drawerScrim.addEventListener('click', closeDrawer);

  /* ---------- 队列行 / 浮层 ---------- */
  var moreTargetId = null;
  var morePop = $('morePop');
  var importPop = $('importPop');
  var importNote = $('importNote');
  var importBusy = false;

  function setNote(msg) { if (importNote) importNote.textContent = msg || ''; }

  function closePops() {
    morePop.hidden = true;
    importPop.hidden = true;
    $('importBtn').setAttribute('aria-expanded', 'false');
    moreTargetId = null;
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
    var more = e.target.closest('.q-more');
    if (more) {
      e.stopPropagation();
      var row = more.closest('.q-row');
      moreTargetId = row.getAttribute('data-id');
      var t = state.tracks.filter(function (x) { return x.id === moreTargetId; })[0];
      $('moreTitle').textContent = t ? t.title + ' — ' + t.artist : '';
      importPop.hidden = true;
      placePop(morePop, more);
      return;
    }
    var hit = e.target.closest('.q-hit');
    if (hit) {
      var li = hit.closest('.q-row');
      playTrack(li.getAttribute('data-id'));
    }
  });

  /* 删除：先本地移除（即时反馈），再叫后端删列表 + 清 media/lyrics；失败回滚 */
  $('removeBtn').addEventListener('click', function () {
    if (!moreTargetId) return;
    var id = moreTargetId;
    var wasCurrent = id === state.currentId;
    var idx = currentIndex();
    closePops();

    var prevTracks = state.tracks.slice();
    var prevId = state.currentId;
    var prevProgress = state.progress;

    state.tracks = state.tracks.filter(function (x) { return x.id !== id; });
    if (wasCurrent) {
      if (state.tracks.length) {
        var next = state.tracks[Math.min(idx < 0 ? 0 : idx, state.tracks.length - 1)];
        state.currentId = next.id;
        state.progress = 0;
        playTrack(next.id);
      } else {
        state.currentId = '';
        state.progress = 0;
        state.playing = false;
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

    apiDeleteJson(ENDPOINT.track + '?id=' + encodeURIComponent(id)).then(function (res) {
      if (!res.ok) {
        toast('移除失败，已恢复');
        state.tracks = prevTracks;
        state.currentId = prevId;
        state.progress = prevProgress;
        renderQueue();
        renderTrack();
        renderProgress();
      }
    }).catch(function () {
      toast('移除失败，已恢复');
      state.tracks = prevTracks;
      state.currentId = prevId;
      state.progress = prevProgress;
      renderQueue();
      renderTrack();
      renderProgress();
    });
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
    if (added > 0) {
      savePlaylist();
      toast(label + '：新增 ' + added + ' 首');
      setNote('已新增 ' + added + ' 首');
    } else {
      toast(label + '：没有新曲目（可能已存在）');
      setNote('没有新曲目（可能已存在）');
    }
  }

  /* 在线链接导入：单曲 / 歌单 */
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
      var added = mergeTracks(list);
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
        afterImport(mergeTracks(items.filter(Boolean)), '本地文件');
      });
    }).catch(function (e) {
      setNote(e && e.message ? e.message : '文件选择不可用');
    }).then(function () { importBusy = false; });
  }
  function importLocalFolder() {
    if (importBusy) return;
    importBusy = true;
    setNote('请选择文件夹…');
    hostPick({ mode: 'directory' }).then(function (res) {
      var ref = res && res.resources && res.resources[0];
      var dir = ref && ref.path;
      if (!dir) { setNote('未选择文件夹'); importBusy = false; return; }
      setNote('正在扫描…');
      return apiGetJson(ENDPOINT.scanFolder + '?path=' + encodeURIComponent(dir)).then(function (r) {
        if (!r.ok || !r.body || !r.body.ok) {
          setNote('扫描失败：' + ((r.body && r.body.error) || r.status));
          return;
        }
        afterImport(mergeTracks(r.body.files || []), '本地文件夹');
      });
    }).catch(function (e) {
      setNote(e && e.message ? e.message : '文件夹选择不可用');
    }).then(function () { importBusy = false; });
  }

  importPop.addEventListener('click', function (e) {
    var item = e.target.closest('[data-import]');
    if (item) {
      var kind = item.getAttribute('data-import');
      if (kind === 'file') importLocalFiles();
      else if (kind === 'folder') importLocalFolder();
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
    if (next !== layout) {
      layout = next;
      player.setAttribute('data-layout', next);
      if (next !== 'wide') state.drawer = false;
      if (next !== 'compact') state.page = 'play';
      renderChrome();
    }
    sizeLyricPad();
    updateLyricIndex(true);
  }
  if (window.ResizeObserver) {
    new ResizeObserver(applyLayout).observe(frame);
  } else {
    window.addEventListener('resize', applyLayout);
  }

  /* ============================================================
     主题：跟随宿主（宿主样式表已注入 --bg/--text/--accent/...）
     ============================================================ */
  function applyHostTheme() {
    var forced = params.get('theme');
    if (forced) { document.documentElement.setAttribute('data-theme', forced); return; }
    try {
      if (window.hana && window.hana.theme && typeof window.hana.theme.subscribe === 'function') {
        window.hana.theme.subscribe(function (s) {
          if (s && s.theme) document.documentElement.setAttribute('data-theme', s.theme);
        });
      }
    } catch (e) { /* 无宿主主题时保持默认 */ }
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
    renderLyricToggle();
    renderLyrics();
    renderChrome();
  }

  function applyTracks(tracks) {
    state.tracks = tracks;
    if (!state.tracks.length) { state.currentId = ''; }
    else if (!trackById(state.currentId)) { state.currentId = state.tracks[0].id; }
  }

  function restorePlayback(pb) {
    if (pb) {
      if (typeof pb.volume === 'number' && isFinite(pb.volume)) state.volume = Math.max(0, Math.min(1, pb.volume));
      state.muted = !!pb.muted;
      if (pb.mode === 'one' || pb.mode === 'shuffle' || pb.mode === 'list') state.mode = pb.mode;
      if (typeof pb.lyricsVisible === 'boolean') state.lyrics = pb.lyricsVisible;
    }
    renderVolume();
    renderMode();
    renderLyricToggle();
    audio.volume = state.volume;
    audio.muted = state.muted;

    var t = trackById(pb && pb.currentId) || state.tracks[0];
    if (!t) {
      renderTrack();
      renderQueue();
      renderProgress();
      renderPlayState();
      return;
    }
    state.currentId = t.id;
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
        if (!ok || state.currentId !== t.id) return;
        renderTrack();
        renderQueue();
        loadLyrics(t);
        loadAudio(t, state.progress, true);
      });
    }
  }

  function boot() {
    renderAll();
    applyLayout();

    Promise.all([
      waitForHana(2000),
      loadPlaylist().catch(function (e) {
        state.loadError = e && e.message ? e.message : String(e);
        console.warn('[player] playlist 读取失败', e);
        return null;
      }),
      loadPlaybackState()
    ]).then(function (results) {
      applyHostTheme();
      var tracks = results[1];
      var pb = results[2];
      if (tracks) applyTracks(tracks);
      restorePlayback(pb);
      if (!tracks) toast('列表加载失败，请稍后重试');
      if (params.get('assert') === '1') setTimeout(runSelfCheck, 60);
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
    ['playBtn', 'prevBtn', 'nextBtn', 'modeBtn', 'seek', 'muteBtn', 'lyricToggle', 'queueBtn'].forEach(function (id) {
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

    /* 7b. 歌词只滚自己：不牵动顶栏、控制条、队列 */
    if (state.lyrics && shown(lyrics) && lyrics.scrollHeight > lyrics.clientHeight + 1) {
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
    if (state.lyrics && shown(lyrics)) {
      add('lyric-no-overflow', lyrics.scrollWidth <= lyrics.clientWidth + 1,
        'lyrics ' + lyrics.scrollWidth + '/' + lyrics.clientWidth);
    } else {
      add('lyric-no-overflow', true, 'n/a（歌词关闭）');
    }

    /* 9. 歌词关闭：正文与渐变蒙层都不在 */
    if (!state.lyrics) {
      add('scrim-gone-when-lyrics-off',
        !shown(lyricScrim) && !shown(lyricWrap),
        'scrim=' + getComputedStyle(lyricScrim).display + ' wrap=' + getComputedStyle(lyricWrap).display);
    } else if (shown($('scene'))) {
      add('scrim-shown-when-lyrics-on', shown(lyricScrim), '');
    } else {
      add('scrim-shown-when-lyrics-on', true, 'n/a（本状态整页是队列页，舞台整体隐藏）');
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

    /* 12. 根容器直角、无外描边/外阴影 */
    var cs = getComputedStyle(player);
    add('root-square-no-shadow',
      cs.borderRadius === '0px' && cs.boxShadow === 'none' &&
      cs.borderTopWidth === '0px' && cs.borderLeftWidth === '0px',
      cs.borderRadius + ' / ' + cs.boxShadow);

    var payload = {
      type: 'self-check',
      case: [window.innerWidth + 'x' + window.innerHeight, themeLabel(), state.lyrics ? 'lyrics-on' : 'lyrics-off', player.getAttribute('data-layout')].join(' / '),
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
})();
