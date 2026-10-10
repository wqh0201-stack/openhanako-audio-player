# 底栏（播放控制条）· 改造交接说明

> 给接手的前端：这是「Hana 音频播放器」App 底部那条播放控制条的完整上下文。想改结构/样式，看完这份就够。**改动入口只有三个文件**：`ui/style.css`（样式）、`ui/index.html` + `ui/standalone.html`（结构，两份除 `data-shell` 外完全一致）、`ui/app.js`（逻辑，通常不用动）。

---

## 1. 这是个什么项目

- Hana 平台上的本地音频播放器 App（本地/在线播放 + 歌词 + 队列 + 歌单）。
- 前端是**单文件** `ui/index.html`，孪生 `ui/standalone.html`。**无构建步骤**（没有打包器、没有框架，原生 JS + 一个 CSS 文件，改完直接跑）。**重构也要保持单文件。**
- 逻辑全在 `ui/app.js`（原生 JS，约 4400 行）。样式全在 `ui/style.css`。
- 视觉走 CSS 变量（`--hk-*`），深浅主题自动跟随，见 §6。

---

## 2. 底栏在哪

`ui/index.html` 第 ~159 行起：

```html
<footer class="controls" id="controls"> … </footer>
```

对应样式在 `ui/style.css`，搜 `.controls` / `.btn-row` / `.cell`。

---

## 3. 结构（一套 DOM，三种布局共用）

底栏分两行：

**第一行 `.progress-row`**：当前时间 `#curTime` · 进度滑杆 `#seek` · 总时长 `#durTime`

**第二行 `.btn-row`**：三段式网格，三个 `.cell`：

```html
<div class="btn-row">
  <div class="cell cell-left">
    <button class="search-entry" id="searchEntryBtn">🔍 搜索</button>
    <div class="ctl-title" id="ctlTitle"></div>          <!-- 歌名，JS 填 -->
    <button class="fav-btn fav-btn-bar" id="favBtn">♡ 红心</button>
    <button class="icon-btn" id="modeBtn"></button>       <!-- 循环模式，JS 填图标 -->
  </div>

  <div class="cell cell-center">
    <button class="icon-btn" id="prevBtn">⏮</button>
    <button class="play-btn" id="playBtn"></button>       <!-- 播放/暂停，JS 填图标 -->
    <button class="icon-btn" id="nextBtn">⏭</button>
  </div>

  <div class="cell cell-right">
    <div class="vol-group">
      <button class="icon-btn" id="muteBtn"></button>   <!-- 静音，JS 填图标 -->
      <div class="vol-pop" id="volPop">                 <!-- 悬停向上弹的竖向滑条 -->
        <input class="range range-vol" id="vol" type="range">
      </div>
    </div>
    <span class="ctl-divider"></span>
    <button class="queue-btn" id="queueBtn">☰ <span class="qb-label">队列 12</span></button>
  </div>
</div>
```

> `#ctlTitle`、`#modeBtn`、`#muteBtn`、`#playBtn` 是空标签，图标/文字由 `app.js` 的 `renderTrack()` / `icon()` 注入。图标全是内联 SVG `<symbol>`（定义在 `ui/index.html` 末尾的 `<svg class="svg-defs">` 里），用 `<use href="#i-xxx">` 引用。

---

## 4. 三种布局（同一个 DOM，靠 `data-*` 属性切）

`app.js` 的 `applyLayout()` 按容器尺寸写属性：

```js
var next = w >= 720 ? 'wide' : (h < 560 ? 'compact' : 'long');
player.setAttribute('data-layout', next);           // wide | long | compact
player.setAttribute('data-bar', w < 420 ? 'tight' : 'loose');
```

| 形态 | 条件 | 底栏表现 |
|---|---|---|
| **wide** 独立窗 | 宽 ≥ 720 | 显示搜索 + 歌名；三段式（左格四项 · 中格传输 · 右格音量+队列） |
| **long** 长条卡 | 宽 < 720 且高 ≥ 560 | 不显示搜索/歌名 |
| **compact** 聊天卡 | 宽 < 720 且高 < 560 | 不显示搜索/歌名；按钮行展平为 **7 等分** |
| 附加 **tight** | 宽 < 420（真机卡 ~312px） | 在 compact 基础上再收紧内边距/间距 |

---

## 5. 关键规则（别破坏）

1. **播放键恒在正中。** 靠 `.btn-row` 的三列网格 `minmax(0,1fr) auto minmax(0,1fr)`：中格恒居中。**中格只放「⏮ ▶ ⏭」**，左右对称 → 播放键永远落在整行正中。**别把别的元素塞进中格，否则播放键会漂。**
2. **红心 ≠ 播放。** `#favBtn` 只 toggle「我的喜欢」；点歌曲行是播放，不落喜欢。两件事分开。
3. **搜索、歌名只在宽窗**（`.player[data-layout="wide"]` 才显示）。
4. **宽窗左格 `space-between`**（四项等距，🔍 与歌名不贴脸）、**右格 `flex-end` 成组**（音量+队列收在右端）。
5. **窄卡 7 等分**：`.cell` 设 `display:contents` 把按钮展平，`.btn-row` 用 `grid-template-columns:repeat(7,1fr)` + `justify-items:center` → 7 颗中心等距、播放键落正中。⚠️ **`.vol-group` 不展平**（2026-10-10 起）：它里面挂着音量浮层，展平会把浮层也变成网格子项；整组只算**一格**（里面只有静音键），7 的格数不变。
6. **颜色只吃 `--hk-*` 变量**，别写死色值（要兼容深浅两套 + 宿主主题）。

---

## 6. 设计 token（`ui/style.css` 顶部）

```
--hk-surface  底栏/卡片面    --hk-text   主字色     --hk-muted  次要字色
--hk-faint    更弱的字        --hk-accent 强调色     --hk-on-accent 强调色上的字
--hk-border / --hk-hairline  描边 / 分隔线           --hk-hover / --hk-track  悬停 / 轨道
--hl-accent   「当前高亮」强调色（红心未点亮、歌词当前句共用）
--radius-s:5px  --radius-m:8px  --radius-l:10px
```

浅色兜底值：面 `#FCFAF5`、字 `#3B3D3F`、次字 `#6B6158`、强调 `#537D96`、描边 `rgba(122,96,88,.18)`。深色自动切深板岩一套。

---

## 7. 底栏相关 CSS（现状，可直接改）

```css
.controls { flex:0 0 auto; display:flex; align-items:center; gap:20px;
            padding:12px 18px 14px; background:var(--hk-surface);
            border-top:1px solid var(--hk-hairline); }
.controls-main { flex:1 1 auto; min-width:0; }
.progress-row { display:flex; align-items:center; gap:12px; }
.time { flex:0 0 auto; font-size:11px; color:var(--hk-muted); font-variant-numeric:tabular-nums; }

.ctl-title { display:none; flex:0 0 160px; min-width:0; text-align:center;
             font-size:13px; color:var(--hk-text);
             white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }

.btn-row { display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr);
           align-items:center; column-gap:24px; margin-top:10px; }
.cell { display:flex; align-items:center; min-width:0; }
.cell-left { justify-content:space-between; }
.cell-center { justify-content:center; gap:18px; }
.cell-right { justify-content:flex-end; gap:20px; }

/* 宽窗专属 */
.player[data-layout="wide"] .ctl-title { display:block; }
.player[data-layout="wide"] .search-entry { display:inline-flex; }
.player[data-layout="wide"] .qb-label { display:none; }          /* 队列收纯图标 */
.player[data-layout="wide"] .range-vol { display:block; width:96px; }
.player[data-layout="wide"] .queue-btn { width:30px; height:30px; justify-content:center; padding:0; }

/* 窄卡：展平 7 等分（.vol-group 不展平，它里面挂着音量浮层） */
.player[data-layout="compact"] .cell { display:contents; }
.player[data-layout="compact"] .ctl-divider,
.player[data-layout="compact"] .qb-label { display:none; }
.player[data-layout="compact"] .queue-btn { width:30px; height:30px; justify-content:center; padding:0; }
.player[data-layout="compact"] .btn-row { grid-template-columns:repeat(7,1fr); column-gap:0; justify-items:center; }

/* tight（真机卡 <420） */
.player[data-bar="tight"] .controls { gap:10px; padding:10px 12px 12px; }
.player[data-bar="tight"] .btn-row { column-gap:4px; margin-top:8px; }
.player[data-bar="tight"] .play-btn { width:42px; height:42px; }
.player[data-bar="tight"] .play-btn .icon { width:20px; height:20px; }
.player[data-bar="tight"] .ctl-divider { display:none; }

/* 控件尺寸 */
.icon { width:19px; height:19px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }
.icon-sm { width:15px; height:15px; }
.icon-btn { width:30px; height:30px; border-radius:var(--radius-s); color:var(--hk-muted); }
.search-entry { width:30px; height:30px; color:var(--hk-muted); }
.fav-btn-bar { width:30px; height:30px; color:var(--hl-accent); opacity:.55; }   /* 点亮时 opacity:1 + 实心 */
.play-btn { width:48px; height:48px; border-radius:50%; background:var(--hk-accent); color:var(--hk-on-accent); }
.play-btn .icon { width:22px; height:22px; }
.range-vol { display:block; }                       /* 现在活在 .vol-pop 里，靠 .is-open 显隐 */
.range-seek { flex:1 1 auto; min-width:0; }
.range::-webkit-slider-runnable-track { height:4px; border-radius:2px;
  background:linear-gradient(to right, var(--hk-accent) 0 var(--fill,0%), var(--hk-track) var(--fill,0%) 100%); }
.range::-webkit-slider-thumb { width:11px; height:11px; margin-top:-3.5px; border-radius:50%; background:var(--hk-accent); }

/* 音量浮层（悬停向上弹的竖条）—— 完整写法见 docs/player-ui/REFINE-DONE-VOLUME.md */
.vol-group { position:relative; display:flex; align-items:center; gap:6px; min-width:0; }
.vol-group::before { content:""; position:absolute; left:50%; bottom:100%; width:44px; height:12px; transform:translateX(-50%); }  /* 连通悬停区，别删 */
.vol-pop { position:absolute; left:50%; bottom:calc(100% + 8px); z-index:40; width:42px; height:136px;
  border-radius:var(--radius-m); background:var(--hk-surface); border:1px solid var(--hk-hairline);
  box-shadow:var(--hk-pop-shadow); opacity:0; visibility:hidden; pointer-events:none;
  transform:translate(-50%, 10px) scale(.94); transform-origin:50% 100%;
  transition:opacity .16s ease, transform .2s cubic-bezier(.22,.61,.36,1), visibility 0s linear .2s; }
.vol-group.is-open .vol-pop { opacity:1; visibility:visible; pointer-events:auto; transform:translate(-50%, 0) scale(1); }
.vol-pop .range-vol { position:absolute; top:50%; left:50%; width:108px; height:20px;
  transform:translate(-50%,-50%) rotate(-90deg); }   /* 旋转 → 轨道渐变自然变竖向 */
```

---

## 8. 怎么验收 / 上线

- **无头验收**：`node tools/verify-ui.mjs`（puppeteer 驱动系统 Chrome，出截图到 `/tmp/hap-verify/`）。里面有针对底栏的断言：`ctl-play-centered-wide`（播放键中心 vs 行中心 < 2px）、`ctl-endpoints-symmetric-wide`、`search-entry-hidden-in-card`、`ctl-title-hidden-in-card` 等。**改布局要同步这些断言。**
- **上线三步，缺一不可**：改完 → **整包同步 `ui/`**（index / standalone / style / app / _build）到 App 安装目录 → `extension_manager reload app:hanako-audio-player`。页面**不会**自动刷新，光同步文件不 reload 等于没改。

---

## 9. 当前形态 & 想让你看的地方

现状（2026-10-10）：宽窗左格四项 `space-between` 等距、中格传输恒居中、右格成组；窄卡 7 等分。播放键在三种布局下都精确落正中。

可能的打磨方向（不限于此，欢迎提出更好的）：
- 宽窗左翼 `🔍 · 歌名 · ♡ · ⟳` 的**疏密**是否舒服（现在四项等距，歌名固定 160px）；要不要让 🔍 与歌名成一组、`♡ ⟳` 单独靠中？
- 歌名的**对齐/宽度**：现在 160px 居中省略，长歌名截断观感如何。
- 右翼「🔊 — 音量条 — ☰」的间距与音量条长度（现 96px）。
- 窄卡 7 等分在 465 / 312 两档下的**触区**是否够（图标 30px、播放 48/42px）。
- `long`（长条卡）这一档底栏的排布是否也要对齐同样规则。

---

*源仓库：`hanako-audio-player-simple`（分支 `hana-simple`）；App id：`hanako-audio-player`。*
