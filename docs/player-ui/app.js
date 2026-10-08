/* ============================================================
   Hana 极简播放器 · UI 原型
   纯原生 JS：定时器模拟播放、写死演示数据、不接宿主/存储
   ============================================================ */
(function () {
  'use strict';

  var $ = function (id) { return document.getElementById(id); };
  var params = new URLSearchParams(location.search);

  var SHOT = params.get('shot') === '1';
  var SELFTEST = params.get('selftest') === '1';

  /* ---------- 演示数据 ---------- */
  var DEMO_TRACKS = [
    { id: 't01', title: '风经过的地方', artist: '林间来信', dur: 284, source: 'local' },
    { id: 't02', title: '雨停以前', artist: '夏至未至', dur: 232, source: 'local' },
    { id: 't03', title: '无人经过的站台', artist: '陈暮光', dur: 241, source: 'online' },
    { id: 't04', title: '山间来信', artist: '林间来信', dur: 260, source: 'local' },
    { id: 't05', title: '微光旅行', artist: '鹿与诗', dur: 216, source: 'online' },
    { id: 't06', title: '窗边的海', artist: '海边来信', dur: 248, source: 'local' },
    { id: 't07', title: '长街灯火', artist: '苏晚晴', dur: 224, source: 'local' },
    { id: 't08', title: '白鸟与旧信', artist: '顾南声', dur: 252, source: 'online' },
    { id: 't09', title: '迟到的雪', artist: '沈叙', dur: 238, source: 'local' },
    { id: 't10', title: '夏末的站台', artist: '半山', dur: 271, source: 'online' },
    { id: 't11', title: '云层之上', artist: '林间来信', dur: 207, source: 'local' },
    { id: 't12', title: '夜航船', artist: '陈暮光', dur: 256, source: 'online' }
  ];

  /* 当前曲的整段歌词（含重复副歌） */
  var DEMO_LYRICS = [
    { t: 6, text: '当最后一班车驶过长街' },
    { t: 14, text: '把夜色轻轻折进唱片里' },
    { t: 22, text: '风从很远的山间寄来信' },
    { t: 30, text: '说云海正在慢慢退潮' },
    { t: 38, text: '我把灯火叠成小小的船' },
    { t: 46, text: '放进写着你名字的河流' },
    { t: 55, text: '风经过的地方 都亮了起来' },
    { t: 63, text: '你的声音落在金色草坡上' },
    { t: 71, text: '风经过的地方 雪化成了海' },
    { t: 79, text: '我在清晨的雾里 等一班不知名的列车' },
    { t: 92, text: '[ 间奏 ]' },
    { t: 104, text: '如果时间是一张慢速的唱片' },
    { t: 112, text: '就让这一圈多绕一会儿' },
    { t: 120, text: '你从副歌里走来 携一身雨' },
    { t: 128, text: '呼吸之间 山色慢慢青' },
    { t: 137, text: '风经过的地方 都亮了起来' },
    { t: 145, text: '你的声音落在金色草坡上' },
    { t: 153, text: '风经过的地方 雪化成了海' },
    { t: 161, text: '我在清晨的雾里 等一班不知名的列车' },
    { t: 174, text: '[ 间奏 ]' },
    { t: 185, text: '站台的灯一盏一盏熄灭' },
    { t: 193, text: '像我们说过的话 轻轻落地' },
    { t: 201, text: '如果明天还有一场远行' },
    { t: 209, text: '请把这首歌留在风里' },
    { t: 218, text: '风经过的地方 都亮了起来' },
    { t: 226, text: '你的声音落在金色草坡上' },
    { t: 234, text: '风经过的地方 雪化成了海' },
    { t: 242, text: '我在清晨的雾里 等一班不知名的列车' },
    { t: 254, text: '风经过的地方 都亮了起来' },
    { t: 264, text: '你的名字落在 风经过的地方' },
    { t: 274, text: '[ 尾奏 ]' }
  ];

  var DEMO_ADDS = [
    { title: '雨落下的声音', artist: '夏至未至', dur: 223, source: 'local' },
    { title: '远山之外', artist: '陈暮光', dur: 247, source: 'online' },
    { title: '晚风信箱', artist: '林间来信', dur: 205, source: 'local' },
    { title: '候鸟日历', artist: '鹿与诗', dur: 232, source: 'online' }
  ];

  var MODES = [
    { key: 'list', label: '列表循环', icon: 'i-repeat' },
    { key: 'one', label: '单曲循环', icon: 'i-repeat-one' },
    { key: 'shuffle', label: '随机播放', icon: 'i-shuffle' }
  ];

  /* ---------- 状态（原型用内存模拟，接线时换成 App 存储） ---------- */
  var state = {
    tracks: DEMO_TRACKS.map(function (t) { return Object.assign({}, t); }),
    order: DEMO_TRACKS.map(function (t) { return t.id; }),
    currentId: 't01',
    progress: 63,
    volume: 0.72,
    muted: false,
    mode: 'list',
    lyrics: true,
    playing: true,
    follow: true,
    page: 'play',
    drawer: false
  };

  /* 接线点：真实实现时把下面这组字段节流串行写入 App 存储（不要 localStorage） */
  function persistState() {
    /* 演示原型：内存即记忆，页面刷新丢失可接受 */
  }

  /* ---------- 参数覆盖（仅预览/自检用） ---------- */
  var theme = params.get('theme') === 'dark' ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', theme);
  if (SHOT) document.body.classList.add('is-shot');
  if (params.get('lyrics') === '0') state.lyrics = false;
  if (params.get('paused') === '1') state.playing = false;
  if (params.get('page') === 'queue') state.page = 'queue';
  if (params.get('drawer') === '1') state.drawer = true;
  if (params.get('nocover') === '1') $('player').classList.add('nocover');
  if (params.get('longtitle') === '1') {
    state.tracks[0].title = '当风吹过山谷的时候请你替我记得那年夏天没有寄出的信';
    state.tracks[0].artist = '林间来信 / 山谷邮差 / 十七夜电台';
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
  function currentIndex() {
    for (var i = 0; i < state.tracks.length; i++) {
      if (state.tracks[i].id === state.currentId) return i;
    }
    return -1;
  }
  var toastTimer = 0;
  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.hidden = true; }, 2400);
  }

  /* ============================================================
     渲染
     ============================================================ */
  function renderTrack() {
    var t = currentTrack();
    if (!t) return;
    $('trackTitle').textContent = t.title;
    $('trackArtist').textContent = t.artist;
    $('ciTitle').textContent = t.title;
    $('ciArtist').textContent = t.artist;
    seek.max = String(t.dur);
    $('durTime').textContent = fmtTime(t.dur);
  }

  function renderQueue() {
    var html = '';
    for (var i = 0; i < state.tracks.length; i++) {
      var t = state.tracks[i];
      var cur = t.id === state.currentId;
      html += '<li class="q-row' + (cur ? ' is-current' : '') + '" data-id="' + t.id + '">' +
        '<button class="q-hit" type="button" title="' + t.title + ' — ' + t.artist + '">' +
          '<span class="q-cover"></span>' +
          '<span class="q-meta">' +
            '<span class="q-title">' + t.title + '</span>' +
            '<span class="q-artist">' + t.artist + '</span>' +
          '</span>' +
          /* 正在播放指示：行内 SVG（不走 <use>，否则选择器进不了 shadow tree，条形动画不会生效） */
          '<span class="q-eq"><svg viewBox="0 0 24 24" aria-hidden="true">' +
            '<path d="M6.5 9.5v9"/><path d="M12 5.5v13"/><path d="M17.5 11.5v7"/>' +
          '</svg></span>' +
          '<span class="q-dur">' + fmtTime(t.dur) + '</span>' +
        '</button>' +
        '<button class="q-more" type="button" aria-label="更多操作：' + t.title + '">' + icon('i-more') + '</button>' +
      '</li>';
    }
    queueList.innerHTML = html;
    var n = state.tracks.length;
    $('queueCount').textContent = String(n);
    $('queueBtnCount').textContent = String(n);
  }

  function renderProgress() {
    var t = currentTrack();
    if (!t) return;
    var p = Math.min(state.progress, t.dur);
    seek.value = String(p);
    $('curTime').textContent = fmtTime(p);
    seek.style.setProperty('--fill', (t.dur ? (p / t.dur * 100) : 0).toFixed(2) + '%');
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
    for (var i = 0; i < DEMO_LYRICS.length; i++) {
      html += '<p class="lyric-line" data-i="' + i + '">' + DEMO_LYRICS[i].text + '</p>';
    }
    lyrics.innerHTML = html;
  }

  function renderChrome() {
    player.setAttribute('data-page', state.page);
    player.setAttribute('data-drawer', state.drawer ? '1' : '0');
    drawerScrim.hidden = !(player.getAttribute('data-layout') === 'wide' && state.drawer);

    var qBtn = $('queueBtn');
    var isLong = player.getAttribute('data-layout') === 'long';
    qBtn.classList.toggle('is-static', isLong);
    qBtn.disabled = isLong;
    qBtn.title = isLong ? '队列常驻显示' : (state.drawer || state.page === 'queue' ? '收起队列' : '展开队列');
    qBtn.setAttribute('aria-label', isLong ? '播放队列（常驻显示）' : qBtn.title);
  }

  /* ============================================================
     歌词跟随
     ============================================================ */
  var lyricIndex = -1;

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
    lyrics.scrollTo({ top: Math.max(0, target), behavior: (instant || SHOT) ? 'auto' : 'smooth' });
  }

  function updateLyricIndex(instant) {
    if (!state.lyrics) return;
    var idx = -1;
    for (var i = 0; i < DEMO_LYRICS.length; i++) {
      if (DEMO_LYRICS[i].t <= state.progress + 0.01) idx = i; else break;
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

  /* ============================================================
     播放（定时器模拟）
     ============================================================ */
  function playTrack(id, keepProgress) {
    var changed = id !== state.currentId;
    state.currentId = id;
    if (changed && !keepProgress) state.progress = 0;
    if (changed) { lyricIndex = -1; state.follow = true; lyricBack.hidden = true; }
    state.playing = true;
    renderTrack();
    renderQueue();
    renderProgress();
    renderPlayState();
    updateLyricIndex(true);
    persistState();
  }

  function stepIndex(dir) {
    var n = state.tracks.length;
    if (!n) return -1;
    var i = currentIndex();
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
      state.progress = 0;
      lyricIndex = -1;
      updateLyricIndex(true);
      persistState();
      return;
    }
    var i = stepIndex(1);
    if (i >= 0) playTrack(state.tracks[i].id);
  }

  var last = performance.now();
  setInterval(function () {
    var now = performance.now();
    var dt = (now - last) / 1000;
    last = now;
    if (!state.playing || SHOT) return;
    var t = currentTrack();
    if (!t) return;
    state.progress += dt;
    if (state.progress >= t.dur) {
      state.progress = t.dur;
      onTrackEnd();
    }
    renderProgress();
    updateLyricIndex(false);
    persistState();
  }, 250);

  /* ============================================================
     控件
     ============================================================ */
  $('playBtn').addEventListener('click', function () {
    state.playing = !state.playing;
    renderPlayState();
    persistState();
  });

  $('prevBtn').addEventListener('click', function () {
    var i = state.mode === 'shuffle' ? stepIndex(-1) : stepIndex(-1);
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
    persistState();
  });

  seek.addEventListener('input', function () {
    state.progress = parseFloat(seek.value) || 0;
    renderProgress();
    updateLyricIndex(false);
    persistState();
  });

  vol.addEventListener('input', function () {
    state.volume = (parseInt(vol.value, 10) || 0) / 100;
    state.muted = state.volume === 0;
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

  $('removeBtn').addEventListener('click', function () {
    if (!moreTargetId) return;
    var id = moreTargetId;
    var wasCurrent = id === state.currentId;
    var i = currentIndex();
    state.tracks = state.tracks.filter(function (x) { return x.id !== id; });
    state.order = state.order.filter(function (x) { return x !== id; });
    closePops();
    if (wasCurrent) {
      if (state.tracks.length) {
        var next = state.tracks[Math.min(i, state.tracks.length - 1)];
        state.currentId = next.id;
        state.progress = 0;
      } else {
        state.currentId = '';
        state.playing = false;
        state.progress = 0;
      }
      lyricIndex = -1;
      renderTrack();
      renderPlayState();
    }
    renderQueue();
    renderProgress();
    toast('已从队列移除');
    persistState();
  });

  $('importBtn').addEventListener('click', function (e) {
    e.stopPropagation();
    var open = importPop.hidden;
    closePops();
    if (open) {
      placePop(importPop, $('importBtn'));
      $('importBtn').setAttribute('aria-expanded', 'true');
    }
  });

  importPop.addEventListener('click', function (e) {
    var item = e.target.closest('[data-import]');
    if (!item) return;
    var kind = item.getAttribute('data-import');
    var demo = DEMO_ADDS[state.tracks.length % DEMO_ADDS.length];
    var track = {
      id: 'n' + (state.tracks.length + 1) + '-' + Date.now().toString(36),
      title: demo.title,
      artist: demo.artist,
      dur: demo.dur,
      source: kind === 'link' ? 'online' : 'local'
    };
    state.tracks.push(track);
    state.order.push(track.id);
    closePops();
    renderQueue();
    toast(kind === 'link' ? '演示：已解析在线链接，加入 1 首' : '演示：已加入 1 首本地曲目');
    persistState();
  });

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
     初始化
     ============================================================ */
  renderTrack();
  renderQueue();
  renderProgress();
  renderVolume();
  renderMode();
  renderPlayState();
  renderLyricToggle();
  renderLyrics();
  renderChrome();

  requestAnimationFrame(function () {
    applyLayout();
    if (params.get('queuepos') === 'bottom') {
      queueList.scrollTop = queueList.scrollHeight;
    }
    if (params.get('assert') === '1') setTimeout(runSelfCheck, 30);
    if (SELFTEST) setTimeout(runSelfTest, 30);
  });

  /* ============================================================
     DEV-TOOLBAR:BEGIN 开发工具条逻辑，生产接线时整段删除
     ============================================================ */
  (function () {
    var sizes = [
      ['465×930', 465, 930],
      ['585×1172', 585, 1172],
      ['531×451', 531, 451],
      ['560×616', 560, 616],
      ['1040×740', 1040, 740]
    ];
    var wrap = $('devSizes');
    sizes.forEach(function (s, i) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = s[0];
      b.addEventListener('click', function () {
        frame.style.width = s[1] + 'px';
        frame.style.height = s[2] + 'px';
        Array.prototype.forEach.call(wrap.children, function (c) { c.classList.remove('is-active'); });
        b.classList.add('is-active');
      });
      if (i === 0) b.classList.add('is-active');
      wrap.appendChild(b);
    });

    var twrap = $('devThemes');
    [['浅色', 'light'], ['深色', 'dark']].forEach(function (t) {
      var b = document.createElement('button');
      b.type = 'button';
      b.textContent = t[0];
      b.addEventListener('click', function () {
        document.documentElement.setAttribute('data-theme', t[1]);
        Array.prototype.forEach.call(twrap.children, function (c) { c.classList.remove('is-active'); });
        b.classList.add('is-active');
      });
      if (t[1] === theme) b.classList.add('is-active');
      twrap.appendChild(b);
    });
  })();
  /* DEV-TOOLBAR:END */

  /* ============================================================
     自检：?assert=1 时在页面里跑一遍清单并输出到 #report
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
      case: [window.innerWidth + 'x' + window.innerHeight, theme, state.lyrics ? 'lyrics-on' : 'lyrics-off', layout].join(' / '),
      passed: checks.filter(function (c) { return !c.ok; }).length === 0,
      checks: checks
    };
    $('report').textContent = JSON.stringify(payload, null, 2);
    return payload;
  }
  /* 自检入口（dev/shot.mjs 经 CDP 调用；接线时可随自检段一起删） */
  window.__playerSelfCheck = runSelfCheck;

  /* ============================================================
     交互冒烟测试：?selftest=1
     ============================================================ */
  function runSelfTest() {
    var out = [];
    function sleep(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    function t(name, fn) {
      return Promise.resolve().then(fn).then(function (detail) {
        out.push({ name: name, ok: detail === true, detail: String(detail === true ? '' : detail) });
      }, function (err) {
        out.push({ name: name, ok: false, detail: String(err) });
      });
    }

    Promise.resolve()
      .then(function () { return t('play-toggle', function () {
        var was = state.playing;
        $('playBtn').click();
        var a = state.playing === !was;
        $('playBtn').click();
        return a && state.playing === was ? true : '翻转失败';
      }); })
      .then(function () { return t('timer-advance', function () {
        if (!state.playing) $('playBtn').click();
        var p0 = state.progress;
        return sleep(700).then(function () {
          return state.progress > p0 ? true : '进度未推进 ' + p0 + '->' + state.progress;
        });
      }); })
      .then(function () { return t('next-prev', function () {
        var id0 = state.currentId;
        $('nextBtn').click();
        var id1 = state.currentId;
        $('prevBtn').click();
        return (id1 !== id0 && state.currentId === id0) ? true : id0 + '/' + id1 + '/' + state.currentId;
      }); })
      .then(function () { return t('mode-cycle', function () {
        var m0 = state.mode;
        for (var i = 0; i < 3; i++) $('modeBtn').click();
        return state.mode === m0 ? true : m0 + '->' + state.mode;
      }); })
      .then(function () { return t('seek', function () {
        seek.value = '120';
        seek.dispatchEvent(new Event('input', { bubbles: true }));
        return Math.abs(state.progress - 120) < 0.01 ? true : 'seek=' + state.progress;
      }); })
      .then(function () { return t('volume-mute', function () {
        vol.value = '30';
        vol.dispatchEvent(new Event('input', { bubbles: true }));
        var ok = Math.abs(state.volume - 0.3) < 0.001;
        $('muteBtn').click();
        return ok && state.muted ? true : 'vol=' + state.volume + ' muted=' + state.muted;
      }); })
      .then(function () { return t('row-click', function () {
        var rows = queueList.querySelectorAll('.q-row');
        var id = rows[2].getAttribute('data-id');
        rows[2].querySelector('.q-hit').click();
        return state.currentId === id ? true : '期望 ' + id + ' 实际 ' + state.currentId;
      }); })
      .then(function () { return t('lyric-toggle', function () {
        var was = state.lyrics;
        $('lyricToggle').click();
        var ok = state.lyrics === !was;
        var scrimGone = getComputedStyle(lyricScrim).display === 'none' || state.lyrics;
        $('lyricToggle').click();
        return ok && scrimGone ? true : 'lyrics=' + state.lyrics;
      }); })
      .then(function () { return t('lyric-follow-and-manual', function () {
        state.follow = true;
        seek.value = '230';
        seek.dispatchEvent(new Event('input', { bubbles: true }));
        var cur = lyrics.querySelector('.lyric-line.is-current');
        var idxOk = !!cur && cur.textContent.indexOf('金色草坡') >= 0;
        var ev = new WheelEvent('wheel', { bubbles: true });
        lyricWrap.dispatchEvent(ev);
        var paused = state.follow === false && lyricBack.hidden === false;
        lyricBack.click();
        var resumed = state.follow === true && lyricBack.hidden === true;
        return idxOk && paused && resumed ? true : 'cur=' + (cur ? cur.textContent : 'none') + ' paused=' + paused + ' resumed=' + resumed;
      }); })
      .then(function () { return t('row-more-remove', function () {
        var n0 = state.tracks.length;
        var rows = queueList.querySelectorAll('.q-row');
        var lastRow = rows[rows.length - 1];
        var id = lastRow.getAttribute('data-id');
        lastRow.querySelector('.q-more').click();
        $('removeBtn').click();
        var gone = !state.tracks.some(function (x) { return x.id === id; });
        return (state.tracks.length === n0 - 1 && gone) ? true : n0 + '->' + state.tracks.length;
      }); })
      .then(function () { return t('import-adds', function () {
        var n0 = state.tracks.length;
        $('importBtn').click();
        importPop.querySelector('[data-import="file"]').click();
        return state.tracks.length === n0 + 1 ? true : n0 + '->' + state.tracks.length;
      }); })
      .then(function () { return t('queue-toggle-' + layout, function () {
        if (layout === 'long') {
          return $('queueBtn').disabled ? true : '长卡下队列按钮应为常驻指示';
        }
        if (layout === 'wide') {
          var d0 = player.getAttribute('data-drawer');
          $('queueBtn').click();
          var d1 = player.getAttribute('data-drawer');
          $('queueBtn').click();
          return d1 !== d0 && player.getAttribute('data-drawer') === d0 ? true : d0 + '/' + d1;
        }
        var p0 = player.getAttribute('data-page');
        $('queueBtn').click();
        var p1 = player.getAttribute('data-page');
        $('backBtn').click();
        return (p1 !== p0 && player.getAttribute('data-page') === p0) ? true : p0 + '/' + p1;
      }); })
      .then(function () { return t('esc-closes', function () {
        if (layout === 'wide') {
          $('queueBtn').click();
          document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
          return player.getAttribute('data-drawer') === '0' ? true : '抽屉未关';
        }
        $('importBtn').click();
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return importPop.hidden ? true : '浮层未关';
      }); })
      .then(function () {
        $('report').textContent = JSON.stringify({
          type: 'self-test',
          case: [window.innerWidth + 'x' + window.innerHeight, theme, layout].join(' / '),
          passed: out.filter(function (r) { return !r.ok; }).length === 0,
          tests: out
        }, null, 2);
      });
  }
})();
