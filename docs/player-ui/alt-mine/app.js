/* =========================================================
   极简播放器 · UI 原型逻辑（纯原生 JS，无框架 / 无构建 / 无 CDN）
   播放用定时器模拟；数据写死在本文件；不接音频、宿主、持久存储。
   「预览专用」段落在接线时整段删除。
   ========================================================= */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

  const frame = $('#frame');
  const player = $('#player');
  const controls = $('#controls');
  const queueList = $('#queueList');
  const lyricScroll = $('#lyricScroll');
  const lyricInner = $('#lyricInner');
  const lyricWrap = $('#lyricWrap');
  const lyricScrim = $('#lyricScrim');

  /* =========================================================
     演示数据（写死；封面统一用 assets/demo-cover.png）
     ========================================================= */
  const DEMO_TRACKS = [
    { id: 't01', title: '风经过的地方', artist: '林间来信', dur: 284, source: 'local' },
    { id: 't02', title: '雨停以前', artist: '夏野', dur: 232, source: 'local' },
    { id: 't03', title: '无人经过的站台', artist: '陈牧云', dur: 317, source: 'online' },
    { id: 't04', title: '山间来信', artist: '鹿与白', dur: 260, source: 'local' },
    { id: 't05', title: '晚风的旧唱片', artist: '林间来信', dur: 216, source: 'local' },
    { id: 't06', title: '清晨六点的海', artist: '苏眠', dur: 248, source: 'online' },
    { id: 't07', title: '纸飞机与旧地图', artist: '陈牧云', dur: 201, source: 'local' },
    { id: 't08', title: '渡口的雾', artist: '夏野', dur: 273, source: 'local' },
    { id: 't09', title: '把日子折成小船', artist: '苏眠', dur: 238, source: 'online' },
    { id: 't10', title: '云层以上', artist: '周暮川', dur: 255, source: 'local' },
    { id: 't11', title: '在黄昏与夜色交界的路口，我们谈起旧事与新雪', artist: '沈屿', dur: 324, source: 'local' },
    { id: 't12', title: '回声里的小镇', artist: '沈屿', dur: 302, source: 'online' }
  ];

  const DEMO_LYRICS = [
    { t: 4, text: '黄昏落在旧屋檐' },
    { t: 16, text: '当最后一班车驶过长街' },
    { t: 28, text: '云把影子铺满了台阶' },
    { t: 42, text: '风从很远的山间寄来信' },
    { t: 58, text: '把夜色轻轻折进唱片里' },
    { t: 70, text: '说山谷的雾还没有散' },
    { t: 82, text: '说你窗前的灯还亮着' },
    { t: 94, text: '我沿着来时的路往回走' },
    { t: 106, text: '把脚步声留给长长的巷口' },
    { t: 118, text: '风经过的地方 都有你的回响' },
    { t: 128, text: '云停的屋顶上 晒着旧时光' },
    { t: 138, text: '我们把名字写进风里' },
    { t: 148, text: '任它吹向很远的地方' },
    { t: 162, text: '晚风翻动书页的声响' },
    { t: 174, text: '像谁在门外轻轻哼唱' },
    { t: 186, text: '如果夜色懂得收藏' },
    { t: 198, text: '就把这一秒好好安放' },
    { t: 210, text: '风经过的地方 都有你的回响' },
    { t: 220, text: '云停的屋顶上 晒着旧时光' },
    { t: 230, text: '我们把名字写进风里' },
    { t: 240, text: '任它吹向很远的地方' },
    { t: 252, text: '风经过的地方 都有你的回响' },
    { t: 262, text: '云停的屋顶上 晒着旧时光' },
    { t: 272, text: '我们把名字写进风里' },
    { t: 282, text: '任它吹向很远的地方' }
  ];

  const MODE_LABEL = { list: '列表循环', one: '单曲循环', shuffle: '随机播放' };
  const MODE_ICON = { list: '#i-loop', one: '#i-loop-one', shuffle: '#i-shuffle' };

  /* =========================================================
     状态（只存内存；刷新即失，符合原型要求，不写 localStorage）
     ========================================================= */
  const state = {
    tracks: DEMO_TRACKS.map((t) => Object.assign({}, t)),
    currentId: 't01',
    position: 0,
    playing: false,
    volume: 0.72,
    muted: false,
    mode: 'list',
    lyrics: true,
    page: 'play',      // 矮卡两页互切：play / queue
    drawer: false,     // 宽窗队列抽屉
    following: true    // 歌词自动跟随
  };

  const currentTrack = () => state.tracks.find((t) => t.id === state.currentId) || state.tracks[0];
  const currentIndex = () => state.tracks.findIndex((t) => t.id === state.currentId);
  const lyricsFor = (track) => (track && track.id === 't01' ? DEMO_LYRICS : null);

  function fmt(sec) {
    sec = Math.max(0, Math.floor(sec));
    return Math.floor(sec / 60) + ':' + String(sec % 60).padStart(2, '0');
  }

  /* =========================================================
     渲染
     ========================================================= */
  const EQ_SVG = '<svg class="eq" viewBox="0 0 14 14" aria-hidden="true">' +
    '<rect x="1.5" y="4.4" width="2.3" height="9.6" rx="1.15"/>' +
    '<rect x="5.85" y="1.6" width="2.3" height="12.4" rx="1.15"/>' +
    '<rect x="10.2" y="5.8" width="2.3" height="8.2" rx="1.15"/></svg>';

  function renderQueue() {
    const keepScroll = queueList.scrollTop;
    queueList.innerHTML = state.tracks.map((t) => {
      const isCurrent = t.id === state.currentId;
      return '<li class="queue-row' + (isCurrent ? ' is-current' : '') + '" data-id="' + t.id + '">' +
        '<button type="button" class="row-hit" data-play="' + t.id + '" aria-label="播放 ' + esc(t.title) + '"' +
        (isCurrent ? ' aria-current="true"' : '') + '>' +
        '<span class="row-cover"><img src="assets/demo-cover.png" alt=""></span>' +
        '<span class="row-main">' +
        '<span class="row-title-line"><span class="row-title">' + esc(t.title) + '</span>' +
        (isCurrent ? EQ_SVG : '') + '</span>' +
        '<span class="row-artist">' + esc(t.artist) + '</span>' +
        '</span>' +
        '<span class="row-dur">' + fmt(t.dur) + '</span>' +
        '</button>' +
        '<button type="button" class="icon-btn row-more" data-more="' + t.id + '" title="更多" ' +
        'aria-label="' + esc(t.title) + ' 更多操作" aria-haspopup="menu"><svg class="ic"><use href="#i-more"/></svg></button>' +
        '</li>';
    }).join('');
    queueList.scrollTop = keepScroll;
    const n = state.tracks.length;
    $('#queueCount').textContent = n + ' 首';
    $('#queueBtnLabel').textContent = '队列 ' + n;
  }

  function renderNow() {
    const t = currentTrack();
    $('#trackTitle').textContent = t.title;
    $('#trackArtist').textContent = t.artist;
    $('#ciTitle').textContent = t.title;
    $('#ciArtist').textContent = t.artist;
    $('#durTime').textContent = fmt(t.dur);
    $('#progressBar').setAttribute('aria-valuemax', String(t.dur));
  }

  function renderProgress() {
    const t = currentTrack();
    const ratio = t.dur ? clamp(state.position / t.dur, 0, 1) : 0;
    $('#progressFill').style.width = (ratio * 100) + '%';
    $('#progressKnob').style.left = (ratio * 100) + '%';
    $('#posTime').textContent = fmt(state.position);
    const bar = $('#progressBar');
    bar.setAttribute('aria-valuenow', String(Math.floor(state.position)));
    bar.setAttribute('aria-valuetext', fmt(state.position) + ' / ' + fmt(t.dur));
  }

  function renderVolume() {
    const level = state.muted ? 0 : state.volume;
    $('#volFill').style.width = (level * 100) + '%';
    $('#volKnob').style.left = (level * 100) + '%';
    const bar = $('#volBar');
    bar.setAttribute('aria-valuenow', String(Math.round(level * 100)));
    bar.setAttribute('aria-valuetext', state.muted ? '已静音' : Math.round(level * 100) + '%');
    const mute = $('#muteBtn');
    mute.title = state.muted ? '取消静音' : '静音';
    mute.setAttribute('aria-label', state.muted ? '取消静音' : '静音');
    $('#volIcon').setAttribute('href', state.muted ? '#i-vol-mute' : '#i-vol');
  }

  function renderMode() {
    const btn = $('#modeBtn');
    const label = '播放模式：' + MODE_LABEL[state.mode] + '（点击切换）';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    btn.querySelector('use').setAttribute('href', MODE_ICON[state.mode]);
  }

  function renderPlayState() {
    player.dataset.playing = state.playing ? 'on' : 'off';
    const btn = $('#playBtn');
    btn.title = state.playing ? '暂停' : '播放';
    btn.setAttribute('aria-label', state.playing ? '暂停' : '播放');
    $('#playIcon').setAttribute('href', state.playing ? '#i-pause-solid' : '#i-play-solid');
  }

  function renderLyrics() {
    const t = currentTrack();
    const lines = lyricsFor(t);
    if (!lines) {
      lyricInner.innerHTML = '<div class="lyric-empty">暂无歌词 · 原型只内置了当前曲目的演示歌词</div>';
      return;
    }
    lyricInner.innerHTML = lines.map((l, i) =>
      '<p class="lyric-line" data-i="' + i + '">' + esc(l.text) + '</p>').join('');
    sizeLyricPadding();
    updateLyricActive(true);
  }

  function sizeLyricPadding() {
    const h = lyricScroll.clientHeight || 0;
    lyricInner.style.paddingTop = Math.round(h * 0.42) + 'px';
    lyricInner.style.paddingBottom = Math.round(h * 0.42) + 'px';
  }

  let lastLyricIndex = -2;
  function updateLyricActive(force) {
    const lines = lyricsFor(currentTrack());
    if (!lines) return;
    let idx = -1;
    for (let i = 0; i < lines.length; i++) if (lines[i].t <= state.position + 0.01) idx = i;
    if (idx === lastLyricIndex && !force) return;
    lastLyricIndex = idx;
    $$('.lyric-line', lyricInner).forEach((el) => {
      const i = Number(el.dataset.i);
      el.classList.toggle('is-current', i === idx);
      el.classList.toggle('is-near', Math.abs(i - idx) === 1);
    });
    if (state.following) centerCurrent(true);
  }

  /* =========================================================
     歌词跟随：只滚自己的容器；手动滚动立即暂停跟随
     ========================================================= */
  let fixTimer = 0;
  function centerCurrent(smooth) {
    const el = $('.lyric-line.is-current', lyricInner);
    if (!el || !lyricScroll.clientHeight) return;
    const target = Math.max(0, el.offsetTop + el.offsetHeight / 2 - lyricScroll.clientHeight / 2);
    if (smooth && lyricScroll.scrollTo) {
      try {
        lyricScroll.scrollTo({ top: target, behavior: 'smooth' });
      } catch (err) {
        lyricScroll.scrollTop = target;
      }
      /* 平滑滚动在某些环境不生效（无头/后台标签），到点没到就直接补位 */
      clearTimeout(fixTimer);
      fixTimer = setTimeout(() => {
        if (state.following && Math.abs(lyricScroll.scrollTop - target) > 2) lyricScroll.scrollTop = target;
      }, 420);
    } else {
      lyricScroll.scrollTop = target;
    }
  }

  function setFollowing(on) {
    state.following = on;
    $('#backToLyric').hidden = on;
    if (on) centerCurrent(true);
  }

  /* 手动浏览只看用户意图（滚轮/触摸/拖滚动条/键盘），不看 scroll 事件，
     否则自动跟随的平滑滚动会被误判成手动滚动 */
  const markUserScroll = () => { if (state.following) setFollowing(false); };
  ['wheel', 'touchmove'].forEach((ev) => {
    lyricScroll.addEventListener(ev, markUserScroll, { passive: true });
  });
  lyricScroll.addEventListener('pointerdown', (e) => {
    const r = lyricScroll.getBoundingClientRect();
    if (e.clientX - r.left > r.width - 18) markUserScroll();
  });
  lyricScroll.addEventListener('keydown', (e) => {
    if (['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', ' '].indexOf(e.key) >= 0) markUserScroll();
  });

  /* =========================================================
     播放（定时器模拟）
     ========================================================= */
  function play() { state.playing = true; renderPlayState(); }
  function pause() { state.playing = false; renderPlayState(); }
  function togglePlay() { state.playing ? pause() : play(); }

  function setCurrent(id, opts) {
    const t = state.tracks.find((x) => x.id === id);
    if (!t) return;
    state.currentId = id;
    state.position = 0;
    lastLyricIndex = -2;
    renderNow();
    renderProgress();
    renderQueue();
    renderLyrics();
    if (state.following) centerCurrent(false);
    if (opts && opts.play) play();
  }

  function step(dir) {
    const n = state.tracks.length;
    if (!n) return;
    let i = currentIndex();
    if (state.mode === 'shuffle' && n > 1) {
      let j = i;
      while (j === i) j = Math.floor(Math.random() * n);
      i = j;
    } else {
      i = (i + dir + n) % n;
    }
    setCurrent(state.tracks[i].id, { play: state.playing || dir > 0 });
  }

  function onTrackEnd() {
    if (state.mode === 'one') {
      state.position = 0;
      lastLyricIndex = -2;
      updateLyricActive(true);
      return;
    }
    step(1); // 列表循环：末首回到第一首；随机：随机挑一首
  }

  setInterval(() => {
    if (!state.playing) return;
    const t = currentTrack();
    if (!t) return;
    state.position += 0.2;
    if (state.position >= t.dur) {
      state.position = t.dur;
      renderProgress();
      onTrackEnd();
      return;
    }
    renderProgress();
    updateLyricActive(false);
  }, 200);

  /* =========================================================
     布局：按容器尺寸切三种布局（ResizeObserver）
     ========================================================= */
  function updateLayout() {
    const r = frame.getBoundingClientRect();
    const layout = r.width >= 720 ? 'wide' : (r.height < 560 ? 'compact' : 'tall');
    const changed = player.dataset.layout !== layout;
    player.dataset.layout = layout;
    if (layout !== 'wide' && state.drawer) setDrawer(false);
    if (changed) {
      requestAnimationFrame(() => {
        sizeLyricPadding();
        if (state.following) centerCurrent(false);
      });
    }
    syncControlsHeight();
  }

  function syncControlsHeight() {
    player.style.setProperty('--controls-h', controls.offsetHeight + 'px');
  }

  if (window.ResizeObserver) {
    new ResizeObserver(updateLayout).observe(frame);
    new ResizeObserver(syncControlsHeight).observe(controls);
  }
  window.addEventListener('resize', updateLayout);

  /* =========================================================
     交互
     ========================================================= */
  $('#playBtn').addEventListener('click', togglePlay);
  $('#prevBtn').addEventListener('click', () => {
    if (state.position > 3) {
      state.position = 0;
      lastLyricIndex = -2;
      renderProgress();
      updateLyricActive(true);
      return;
    }
    step(-1);
  });
  $('#nextBtn').addEventListener('click', () => step(1));

  $('#modeBtn').addEventListener('click', () => {
    state.mode = state.mode === 'list' ? 'one' : (state.mode === 'one' ? 'shuffle' : 'list');
    renderMode();
  });

  $('#muteBtn').addEventListener('click', () => {
    state.muted = !state.muted;
    renderVolume();
    toast(state.muted ? '已静音' : '已取消静音');
  });

  $('#lyricsBtn').addEventListener('click', () => {
    state.lyrics = !state.lyrics;
    player.dataset.lyrics = state.lyrics ? 'on' : 'off';
    const btn = $('#lyricsBtn');
    btn.setAttribute('aria-pressed', String(state.lyrics));
    btn.title = state.lyrics ? '隐藏歌词' : '显示歌词';
    btn.setAttribute('aria-label', state.lyrics ? '隐藏歌词' : '显示歌词');
    if (state.lyrics) {
      requestAnimationFrame(() => {
        sizeLyricPadding();
        if (state.following) centerCurrent(false);
      });
    }
  });

  $('#backToLyric').addEventListener('click', () => setFollowing(true));

  $('#backBtn').addEventListener('click', () => setPage('play'));

  $('#queueBtn').addEventListener('click', () => {
    const layout = player.dataset.layout;
    if (layout === 'wide') setDrawer(!state.drawer);
    else setPage(state.page === 'queue' ? 'play' : 'queue');
  });

  $('#drawerCloseBtn').addEventListener('click', () => setDrawer(false));
  $('#stageMask').addEventListener('click', () => setDrawer(false));

  function setPage(page) {
    state.page = page;
    player.dataset.page = page;
    const label = $('#queueBtnLabel');
    const btn = $('#queueBtn');
    if (page === 'queue') {
      label.textContent = '正在播放';
      btn.title = '返回播放';
      btn.setAttribute('aria-label', '返回播放');
      btn.setAttribute('aria-pressed', 'true');
    } else {
      label.textContent = '队列 ' + state.tracks.length;
      btn.title = '打开播放队列';
      btn.setAttribute('aria-label', '打开播放队列');
      btn.setAttribute('aria-pressed', 'false');
      requestAnimationFrame(() => {
        sizeLyricPadding();
        if (state.following) centerCurrent(false);
      });
    }
  }

  function setDrawer(open) {
    state.drawer = open;
    player.dataset.drawer = open ? 'open' : 'closed';
    $('#stageMask').hidden = !open;
    const btn = $('#queueBtn');
    btn.setAttribute('aria-expanded', String(open));
    btn.setAttribute('aria-pressed', String(open));
    requestAnimationFrame(() => {
      sizeLyricPadding();
      if (state.following) centerCurrent(false);
    });
  }

  /* 队列行 */
  queueList.addEventListener('click', (e) => {
    const moreBtn = e.target.closest('[data-more]');
    if (moreBtn) {
      openRowMenu(moreBtn, moreBtn.dataset.more);
      return;
    }
    const hit = e.target.closest('[data-play]');
    if (!hit) return;
    const id = hit.dataset.play;
    if (id === state.currentId) {
      if (!state.playing) play();
    } else {
      setCurrent(id, { play: true });
    }
    if (player.dataset.layout === 'compact') setPage('play');
  });

  /* 进度 / 音量拖动 */
  function bindBar(barEl, onSeek) {
    const ratioFromEvent = (e) => {
      const track = barEl.querySelector('.bar-track');
      const r = track.getBoundingClientRect();
      return clamp((e.clientX - r.left) / r.width, 0, 1);
    };
    let dragging = false;
    barEl.addEventListener('pointerdown', (e) => {
      dragging = true;
      barEl.setPointerCapture(e.pointerId);
      onSeek(ratioFromEvent(e));
    });
    barEl.addEventListener('pointermove', (e) => { if (dragging) onSeek(ratioFromEvent(e)); });
    const end = (e) => {
      if (!dragging) return;
      dragging = false;
      if (e.pointerId !== undefined && barEl.hasPointerCapture && barEl.hasPointerCapture(e.pointerId)) {
        barEl.releasePointerCapture(e.pointerId);
      }
    };
    barEl.addEventListener('pointerup', end);
    barEl.addEventListener('pointercancel', end);
    barEl.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        e.preventDefault();
        onSeek(null, e.key === 'ArrowRight' ? 1 : -1);
      }
    });
  }

  bindBar($('#progressBar'), (ratio, dir) => {
    const t = currentTrack();
    if (ratio === null) {
      state.position = clamp(state.position + dir * 5, 0, t.dur);
    } else {
      state.position = ratio * t.dur;
    }
    renderProgress();
    updateLyricActive(true);
  });

  bindBar($('#volBar'), (ratio, dir) => {
    if (ratio === null) ratio = clamp(state.volume + dir * 0.05, 0, 1);
    state.volume = ratio;
    state.muted = ratio === 0;
    renderVolume();
  });

  /* =========================================================
     浮层：导入面板 / 行内更多菜单 / 提示
     ========================================================= */
  const importPop = $('#importPop');
  const rowMenu = $('#rowMenu');
  let rowMenuId = null;

  function placePop(pop, anchor, align) {
    pop.hidden = false;
    const fr = frame.getBoundingClientRect();
    const ar = anchor.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    let left = align === 'left' ? ar.left - fr.left : ar.right - fr.left - pr.width;
    let top = ar.bottom - fr.top + 6;
    if (top + pr.height > fr.height - 8) top = Math.max(8, ar.top - fr.top - pr.height - 6);
    left = clamp(left, 8, Math.max(8, fr.width - pr.width - 8));
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
  }

  function closePops() {
    importPop.hidden = true;
    rowMenu.hidden = true;
    $('#importBtn').setAttribute('aria-expanded', 'false');
    rowMenuId = null;
  }

  function openRowMenu(anchor, id) {
    closePops();
    rowMenuId = id;
    placePop(rowMenu, anchor, 'right');
  }

  $('#importBtn').addEventListener('click', (e) => {
    e.stopPropagation();
    const open = importPop.hidden;
    closePops();
    if (open) {
      placePop(importPop, $('#importBtn'), 'right');
      $('#importBtn').setAttribute('aria-expanded', 'true');
    }
  });

  const FAKE = {
    file: [
      { title: '潮汐备忘录', artist: '沈屿', dur: 246 },
      { title: '雾里的灯塔', artist: '苏眠', dur: 228 }
    ],
    folder: [
      { title: '旧夏天的回信', artist: '夏野', dur: 264 },
      { title: '站台与晚风', artist: '陈牧云', dur: 219 },
      { title: '海鸥停在窗台', artist: '周暮川', dur: 251 }
    ],
    link: [{ title: '远山有信（在线）', artist: '鹿与白', dur: 275 }]
  };

  importPop.addEventListener('click', (e) => {
    const item = e.target.closest('[data-import]');
    if (!item) return;
    const kind = item.dataset.import;
    const added = (FAKE[kind] || []).map((t, i) => ({
      id: 'x' + Date.now() + '-' + i,
      title: t.title,
      artist: t.artist,
      dur: t.dur,
      source: kind === 'link' ? 'online' : 'local'
    }));
    state.tracks = state.tracks.concat(added);
    closePops();
    renderQueue();
    toast('演示：' + (kind === 'link' ? '已按在线链接加入 ' : kind === 'folder' ? '已按文件夹加入 ' : '已加入 ') +
      added.length + ' 条曲目（原型未接线）');
  });

  rowMenu.addEventListener('click', (e) => {
    if (!e.target.closest('[data-row-action="remove"]')) return;
    const id = rowMenuId;
    closePops();
    if (!id) return;
    const idx = state.tracks.findIndex((t) => t.id === id);
    if (idx < 0) return;
    const wasCurrent = id === state.currentId;
    state.tracks.splice(idx, 1);
    if (wasCurrent) {
      const next = state.tracks[Math.min(idx, state.tracks.length - 1)];
      if (next) setCurrent(next.id, { play: state.playing });
      else {
        state.currentId = state.tracks[0] ? state.tracks[0].id : null;
        renderNow();
        renderProgress();
        renderLyrics();
      }
    }
    renderQueue();
    toast('已从队列移除 1 条曲目');
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.pop') && !e.target.closest('#importBtn') && !e.target.closest('[data-more]')) closePops();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!importPop.hidden || !rowMenu.hidden) { closePops(); return; }
    if (state.drawer) setDrawer(false);
    else if (player.dataset.layout === 'compact' && state.page === 'queue') setPage('play');
  });

  let toastTimer = 0;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
  }

  /* =========================================================
     预览专用：开发工具条 + URL 状态 + 自检（接线时整段删除）
     ========================================================= */
  const params = new URLSearchParams(location.search);
  const harness = params.has('w') || params.has('h');

  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    player.dataset.theme = theme;
    $$('#devbar [data-theme]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.theme === theme)));
  }

  function applySize(size) {
    $$('#devbar [data-size]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.size === size)));
  }

  $$('#devbar [data-size]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const parts = btn.dataset.size.split('x');
      frame.style.width = parts[0] + 'px';
      frame.style.height = parts[1] + 'px';
      applySize(btn.dataset.size);
      requestAnimationFrame(updateLayout);
    });
  });
  $$('#devbar [data-theme]').forEach((btn) => {
    btn.addEventListener('click', () => applyTheme(btn.dataset.theme));
  });

  /* 封面兜底：加载不到不留白块 */
  $('#coverImg').addEventListener('error', () => $('#coverWrap').classList.add('is-empty'));

  function applyHarness() {
    if (params.get('w')) frame.style.width = params.get('w') + 'px';
    if (params.get('h')) frame.style.height = params.get('h') + 'px';
    if (params.get('theme')) applyTheme(params.get('theme'));
    if (params.get('lyrics') === 'off') $('#lyricsBtn').click();
    if (params.get('nocover') === '1') $('#coverWrap').classList.add('is-empty');
    if (params.get('stress')) {
      const want = Number(params.get('stress')) || 0;
      const variants = ['（现场）', '（钢琴版）', '（Demo）', '（重制）'];
      let k = 0;
      while (state.tracks.length < want) {
        const base = DEMO_TRACKS[k % DEMO_TRACKS.length];
        state.tracks.push({
          id: 's' + k,
          title: base.title + variants[k % variants.length],
          artist: base.artist,
          dur: base.dur - 8,
          source: k % 3 === 0 ? 'online' : 'local'
        });
        k++;
      }
      renderQueue();
    }
    if (params.get('play') === '1') play();
    if (params.get('pos')) {
      state.position = Number(params.get('pos')) || 0;
      renderProgress();
    }
    if (params.get('page') === 'queue') setPage('queue');
    if (params.get('drawer') === 'open') setDrawer(true);
    setTimeout(() => {
      updateLayout();
      if (params.get('qscroll') === 'max') queueList.scrollTop = queueList.scrollHeight;
      sizeLyricPadding();
      updateLyricActive(true);
    }, 0);
  }

  /* ---------- 自检：逐条核对简报 §8 的验收项 ---------- */
  const name = (el) => el.id || (typeof el.className === 'string' ? el.className : (el.getAttribute && el.getAttribute('class'))) || el.tagName;
  function runSelfCheck() {
    const out = [];
    const add = (name_, ok, detail) => out.push({ name: name_, ok: !!ok, detail: detail || '' });
    const fr = frame.getBoundingClientRect();
    const inside = (r, tol) => r.left >= fr.left - (tol || 1) && r.top >= fr.top - (tol || 1) &&
      r.right <= fr.right + (tol || 1) && r.bottom <= fr.bottom + (tol || 1);

    /* 顶栏（曲目信息）在容器内可见；矮卡队列页舞台隐藏时改认队列头 */
    const stageHidden = getComputedStyle($('#stage')).display === 'none';
    const infoEl = stageHidden ? $('.queue-title-row') : $('#trackInfo');
    const ir = infoEl.getBoundingClientRect();
    add('topbar-in-frame', ir.width > 0 && ir.height > 0 && inside(ir),
      (stageHidden ? 'queue-head ' : '') + Math.round(ir.width) + 'x' + Math.round(ir.height) + ' top=' + Math.round(ir.top - fr.top));

    /* 播放控制在容器内实际可见 */
    const cr = controls.getBoundingClientRect();
    add('controls-in-frame', cr.height > 0 && inside(cr),
      Math.round(cr.height) + 'px top=' + Math.round(cr.top - fr.top));

    /* 顶栏右侧 100×40 留给宿主：按实际像素取样，不把滚出视口的行算进来 */
    const TEXTY = 'button, [role="slider"], h1, h2, p, .time, .queue-count, .row-title, .row-artist, .row-dur, .pop-item, .toast, .back-to-lyric';
    const hits = [];
    for (let gx = 8; gx <= 98; gx += 10) {
      for (let gy = 5; gy <= 37; gy += 8) {
        const el = document.elementFromPoint(fr.right - 100 + gx, fr.top + gy);
        if (!el || !el.closest) continue;
        const hit = el.closest(TEXTY);
        if (hit && hits.indexOf(hit) < 0) hits.push(hit);
      }
    }
    add('topright-100x40-free', hits.length === 0, hits.map(name).join(','));

    /* 不出现整页双滚动 / 不横向溢出 */
    add('player-no-inner-scroll',
      player.scrollHeight <= player.clientHeight + 1 && player.scrollWidth <= player.clientWidth + 1,
      player.scrollHeight + '/' + player.clientHeight + ' , ' + player.scrollWidth + '/' + player.clientWidth);
    add('frame-no-overflow',
      frame.scrollWidth <= frame.clientWidth + 1 && frame.scrollHeight <= frame.clientHeight + 1,
      frame.scrollHeight + '/' + frame.clientHeight + ' , ' + frame.scrollWidth + '/' + frame.clientWidth);

    /* 每块区域只有一个滚动容器（只算真正会出现滚动条的） */
    const allowed = ['lyric-scroll', 'queue-list'];
    const scrollables = $$('#player *').filter((el) => {
      const s = getComputedStyle(el);
      const y = (s.overflowY === 'auto' || s.overflowY === 'scroll') && el.scrollHeight > el.clientHeight + 1;
      const x = (s.overflowX === 'auto' || s.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1;
      return y || x;
    });
    const bad = scrollables.filter((el) => !allowed.some((c) => el.classList.contains(c)));
    add('only-lyric-and-queue-scroll', bad.length === 0,
      bad.map((el) => name(el) + '(' + el.scrollHeight + '/' + el.clientHeight + ')').join(','));

    /* 队列能滚到底 */
    const beforeTop = ir.top;
    queueList.scrollTop = queueList.scrollHeight;
    const atBottom = queueList.scrollTop >= queueList.scrollHeight - queueList.clientHeight - 2;
    add('queue-scrolls-to-bottom', atBottom,
      queueList.scrollTop + ' / ' + (queueList.scrollHeight - queueList.clientHeight) + ' rows=' + state.tracks.length);

    /* 列表滚到底时顶栏不动 */
    const ir2 = infoEl.getBoundingClientRect();
    add('topbar-stable-on-scroll', Math.abs(ir2.top - beforeTop) < 1 && Math.abs(ir2.left - ir.left) < 1,
      'moved ' + (Math.round(Math.abs(ir2.top - beforeTop) * 10) / 10) + 'px');
    queueList.scrollTop = 0;

    /* 歌词层 */
    const ls = lyricScroll;
    add('lyric-no-h-overflow', ls.scrollWidth <= ls.clientWidth + 1, ls.scrollWidth + '/' + ls.clientWidth);
    const lineEls = $$('.lyric-line', lyricInner);
    if (state.lyrics) {
      add('lyric-lines-rendered', lineEls.length >= 20, 'lines=' + lineEls.length);
      const cur = $('.lyric-line.is-current', lyricInner);
      add('lyric-current-marked', !!cur, cur ? cur.textContent : 'none');
      if (player.dataset.layout === 'wide') {
        add('lyric-scrim-not-needed-in-wide', true, '宽窗是独立阅读列，不用封面蒙层');
      } else {
        add('lyric-scrim-shown', getComputedStyle(lyricScrim).display !== 'none', '');
      }
      if (cur) {
        const lr = ls.getBoundingClientRect();
        const crr = cur.getBoundingClientRect();
        add('lyric-current-in-view', crr.top >= lr.top - 1 && crr.bottom <= lr.bottom + 1,
          Math.round(crr.top - lr.top) + '..' + Math.round(crr.bottom - lr.top) + ' of ' + Math.round(lr.height));
      }
    } else {
      add('lyric-scrim-gone-when-off',
        getComputedStyle(lyricWrap).display === 'none' || getComputedStyle(lyricScrim).display === 'none' ||
        lyricScrim.getBoundingClientRect().width === 0, '');
      add('lyric-layer-gone-when-off', getComputedStyle(lyricWrap).display === 'none', '');
      const scr = $('#infoScrim').getBoundingClientRect();
      const cov = $('#coverWrap').getBoundingClientRect();
      const ratio = (scr.width * scr.height) / (cov.width * cov.height);
      add('info-scrim-local', ratio <= 0.45, 'ratio=' + Math.round(ratio * 100) + '%');
    }

    /* 字号 ≥ 11px */
    let minFs = Infinity;
    let minWho = '';
    $$('#player *').forEach((el) => {
      const hasText = Array.prototype.some.call(el.childNodes, (n) => n.nodeType === 3 && n.textContent.trim());
      if (!hasText) return;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < minFs) { minFs = fs; minWho = el.id || el.className || el.tagName; }
    });
    add('font-size-ge-11', minFs >= 11, 'min=' + minFs + 'px @' + minWho);
    /* 视觉冗余检查留给人眼：大空洞在截图里逐张看，这里只报结构占比 */

    /* 根容器直角、无外描边、无外阴影 */
    const cs = getComputedStyle(frame);
    add('frame-square-no-border-shadow',
      cs.borderRadius === '0px' && cs.boxShadow === 'none' && parseFloat(cs.borderTopWidth) === 0,
      cs.borderRadius + ' / ' + cs.boxShadow + ' / ' + cs.borderTopWidth);

    /* 禁 emoji */
    const txt = $('#player').innerText;
    const emo = txt.match(/[\u{1F300}-\u{1FAFF}\u{2190}-\u{27BF}\u{FE0F}]/u);
    add('no-emoji', !emo, emo ? emo[0] : '');

    /* 队列行字段齐全：封面 / 歌名 / 歌手 / 时长 / 更多 */
    const rows = $$('.queue-row');
    const incomplete = rows.filter((r) => !r.querySelector('.row-cover img') || !r.querySelector('.row-title') ||
      !r.querySelector('.row-artist') || !r.querySelector('.row-dur') || !r.querySelector('.row-more'));
    add('queue-row-fields', rows.length > 0 && incomplete.length === 0,
      'rows=' + rows.length + ' incomplete=' + incomplete.length);

    /* 行尾不贴边、列表不横向溢出（溢出会把更多按钮挤出容器） */
    const moreBtns = $$('.row-more');
    const minClear = moreBtns.reduce((m, b) => Math.min(m, fr.right - b.getBoundingClientRect().right), Infinity);
    add('queue-row-right-clearance', minClear >= 4, 'min=' + Math.round(minClear) + 'px');
    add('queue-list-no-h-overflow', queueList.scrollWidth <= queueList.clientWidth + 1,
      queueList.scrollWidth + '/' + queueList.clientWidth);

    /* 宽窗抽屉：只盖舞台、不压缩舞台、不遮底部控制；遮罩确实盖住舞台 */
    if (player.dataset.layout === 'wide' && player.dataset.drawer === 'open') {
      const dr = $('#queue').getBoundingClientRect();
      const sr = $('#stage').getBoundingClientRect();
      const mask = $('#stageMask');
      const mr = mask.getBoundingClientRect();
      add('drawer-covers-stage-only', dr.bottom <= cr.top + 1 && dr.right <= fr.right + 1 &&
        Math.abs(dr.left - sr.right) <= Math.min(380, fr.width * 0.46) + 2,
        'drawer=' + Math.round(dr.width) + 'x' + Math.round(dr.height) + ' bottom→controls=' + Math.round(cr.top - dr.bottom) + 'px');
      add('stage-mask-covers-stage', !mask.hidden && Math.abs(mr.width - sr.width) < 2 && Math.abs(mr.height - sr.height) < 2,
        'mask=' + Math.round(mr.width) + 'x' + Math.round(mr.height) + ' stage=' + Math.round(sr.width) + 'x' + Math.round(sr.height));
    }

    /* 封面可用或已兜底 */
    const img = $('#coverImg');
    add('cover-or-fallback',
      (img.complete && img.naturalWidth > 0) || $('#coverWrap').classList.contains('is-empty'),
      img.complete ? ('natural=' + img.naturalWidth) : 'loading');

    /* 强调色盘点（只应出现在当前曲目 / 播放键 / 已填充段 / 激活态） */
    const accHex = getComputedStyle(player).getPropertyValue('--accent').trim().replace('#', '');
    const accRgb = 'rgb(' + parseInt(accHex.slice(0, 2), 16) + ', ' + parseInt(accHex.slice(2, 4), 16) +
      ', ' + parseInt(accHex.slice(4, 6), 16) + ')';
    const users = [];
    $$('#player *').forEach((el) => {
      const s = getComputedStyle(el);
      const hit = [];
      if (s.color === accRgb) hit.push('color');
      if (s.backgroundColor === accRgb) hit.push('bg');
      if (hit.length) users.push(name(el) + '[' + hit.join('+') + ']');
    });
    add('accent-inventory', true, users.slice(0, 12).join(' | ') + (users.length > 12 ? ' …' : ''));

    /* 结构占比（排查大空洞） */
    const stg = $('#stage').getBoundingClientRect();
    const q = $('#queue').getBoundingClientRect();
    add('region-heights', true,
      'stage=' + Math.round(stg.height / fr.height * 100) + '% queue=' +
      Math.round(q.height / fr.height * 100) + '% controls=' + Math.round(cr.height / fr.height * 100) + '%');

    /* ---------- 交互自检：真的去点，不靠走查 ---------- */
    const t = (name_, fn) => {
      try {
        const r = fn();
        add(name_, r === true, typeof r === 'string' ? r : '');
      } catch (e) {
        add(name_, false, 'threw: ' + (e && e.message));
      }
    };
    const key = (el, k) => el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));

    t('it-play-pause', () => {
      const before = state.playing;
      $('#playBtn').click();
      const mid = state.playing;
      $('#playBtn').click();
      return (mid !== before && state.playing === before) ? true : before + '/' + mid + '/' + state.playing;
    });
    t('it-next-prev-track', () => {
      const id0 = state.currentId;
      $('#nextBtn').click();
      const id1 = state.currentId;
      state.position = 0;
      $('#prevBtn').click();
      return (id1 !== id0 && state.currentId === id0) ? true : id0 + '/' + id1 + '/' + state.currentId;
    });
    t('it-mode-cycle', () => {
      const seq = [];
      for (let i = 0; i < 3; i++) { $('#modeBtn').click(); seq.push(state.mode); }
      const label = $('#modeBtn').getAttribute('aria-label');
      return (seq.join(',') === 'one,shuffle,list' && label.indexOf('列表循环') > 0) ? true : seq.join(',') + ' / ' + label;
    });
    t('it-lyrics-toggle', () => {
      $('#lyricsBtn').click();
      const off = player.dataset.lyrics === 'off' && getComputedStyle(lyricWrap).display === 'none';
      $('#lyricsBtn').click();
      const on = player.dataset.lyrics === 'on' && getComputedStyle(lyricWrap).display !== 'none';
      return (off && on) ? true : 'off=' + off + ' on=' + on;
    });
    t('it-row-more-remove', () => {
      const n0 = state.tracks.length;
      const more = $('.queue-row .row-more');
      more.click();
      const menuOpen = !rowMenu.hidden;
      rowMenu.querySelector('[data-row-action="remove"]').click();
      return (menuOpen && state.tracks.length === n0 - 1) ? true : 'menu=' + menuOpen + ' ' + n0 + '->' + state.tracks.length;
    });
    t('it-import-adds', () => {
      const n0 = state.tracks.length;
      $('#importBtn').click();
      const popOpen = !importPop.hidden;
      importPop.querySelector('[data-import="file"]').click();
      return (popOpen && state.tracks.length > n0) ? true : 'pop=' + popOpen + ' ' + n0 + '->' + state.tracks.length;
    });
    t('it-esc-closes-pop', () => {
      $('#importBtn').click();
      const open = !importPop.hidden;
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      return (open && importPop.hidden) ? true : 'open=' + open + ' hidden=' + importPop.hidden;
    });
    t('it-row-click-plays', () => {
      const rows = $$('.queue-row');
      const target = rows.find((r) => !r.classList.contains('is-current'));
      if (!target) return 'no-other-row';
      const id = target.dataset.id;
      target.querySelector('.row-hit').click();
      return state.currentId === id ? true : id + ' != ' + state.currentId;
    });
    t('it-seek-keys', () => {
      const before = state.position;
      key($('#progressBar'), 'ArrowRight');
      return Math.abs(state.position - before - 5) < 0.01 ? true : before + '->' + state.position;
    });
    t('it-volume-keys', () => {
      const before = state.volume;
      key($('#volBar'), 'ArrowRight');
      return Math.abs(state.volume - before - 0.05) < 0.001 ? true : before + '->' + state.volume;
    });
    t('it-wheel-pauses-follow', () => {
      if (!state.lyrics) $('#lyricsBtn').click();
      setFollowing(true);
      lyricScroll.dispatchEvent(new WheelEvent('wheel', { deltaY: 120, bubbles: true }));
      const paused = state.following === false && $('#backToLyric').hidden === false;
      $('#backToLyric').click();
      const resumed = state.following === true && $('#backToLyric').hidden === true;
      return (paused && resumed) ? true : 'paused=' + paused + ' resumed=' + resumed;
    });
    if (player.dataset.layout === 'wide') {
      t('it-drawer-open-esc-close', () => {
        $('#queueBtn').click();
        const open = player.dataset.drawer === 'open';
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        return (open && player.dataset.drawer === 'closed') ? true : open + '/' + player.dataset.drawer;
      });
    } else if (player.dataset.layout === 'compact') {
      t('it-compact-page-switch', () => {
        $('#queueBtn').click();
        const toQueue = player.dataset.page === 'queue';
        $('#backBtn').click();
        return (toQueue && player.dataset.page === 'play') ? true : toQueue + '/' + player.dataset.page;
      });
    }

    const fails = out.filter((r) => !r.ok && r.name !== 'accent-inventory');
    const report = {
      size: Math.round(fr.width) + 'x' + Math.round(fr.height),
      theme: player.dataset.theme,
      layout: player.dataset.layout,
      lyrics: player.dataset.lyrics,
      page: player.dataset.page,
      drawer: player.dataset.drawer,
      pass: out.length - fails.length - 1,
      total: out.length - 1,
      failed: fails.map((f) => f.name),
      checks: out
    };
    const node = document.createElement('script');
    node.type = 'application/json';
    node.id = 'selfcheck-report';
    node.textContent = JSON.stringify(report);
    document.body.appendChild(node);
    document.title = 'SELFCHK ' + report.size + ' ' + report.theme + ' lyrics=' + report.lyrics +
      ' ' + report.pass + '/' + report.total + (fails.length ? ' FAIL:' + fails.map((f) => f.name).join(',') : ' ALLPASS');
  }

  /* =========================================================
     启动
     ========================================================= */
  renderQueue();
  renderNow();
  renderProgress();
  renderVolume();
  renderMode();
  renderPlayState();
  renderLyrics();
  updateLayout();
  sizeLyricPadding();
  updateLyricActive(true);

  if (harness) applyHarness();
  if (params.get('check') === '1') {
    /* 无头 dump-dom 模式没有合成帧，rAF 不回调，所以用定时器 */
    setTimeout(runSelfCheck, 700);
  }
})();
