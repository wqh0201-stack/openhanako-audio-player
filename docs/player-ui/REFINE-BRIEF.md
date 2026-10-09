# 精修简报 · 播放器舞台重构 + 主题色/滚动条收尾

> 2026-10-09 罐头连续反馈汇总。**先读本文，再看参考图，再动手。**
> 目标：把舞台改成参考图的形态（封面贴左、右侧渐变承载信息与歌词/频谱），并收掉配色与滚动条的尾巴。
> 视觉参考：`docs/player-ui/refs/ref-layout-target.jpg`（网易云播放器，**宽窗目标态**）。
> 反面参考（要修掉的丑样子）：`docs/player-ui/refs/bad-scrollbar*.png`、`bad-controlbar-narrow.png`。

---

## 一、需求清单（罐头原话归纳）

### R1 滚动条（全局）
- **所有滚动条**（歌词区、队列、任何可滚区）**轨道一律透明**，**只有滑块带色**。
- 现在宿主 Chromium 默认给轨道刷白底 → 就是那个丑白条。必须清掉。
- 歌词区：滑块平时隐藏、鼠标移入淡入，**不能挤压歌词**（宽度常驻占位）。
- 【已修，需真机复核】已在 `ui/style.css` 加全局 `::-webkit-scrollbar` 透明轨道规则。

### R2 封面承载（核心改动）
- 封面**贴着左边**放。
- **封面按高度完整显示，不裁切**（现在 `background-size: cover` 会砍头砍脚）。
- 封面区域高度 = **播放器舞台高度**（不是固定小方块）。
- 右侧留白区域 → 用**封面右侧颜色的渐变/模糊过渡**，做出参考图那种「封面晕开到右侧」的融合感。
  - ⚠️ 跨源封面**不能**用 canvas 取像素（`p2.music.126.net` 无 CORS，会 taint）。
    正确做法：在右侧再铺一层**同一张封面的模糊放大副本**（`filter: blur()` + `background-size: cover`），
    上面再叠主题纸色半透明蒙层压平——纯 CSS，不碰像素。
- 【已修，需真机复核】顶部/歌词遮罩已从「黑压暗」改成「主题纸色」（`--hk-surface`）。

### R3 歌曲信息（位置变了）
- 歌名**常驻上方**，**不再压在封面左上角**，改放**右侧内容列**。
- 参考图排布：大标题 → 副标题 → 元信息行（**专辑 / 歌手 / 来源**）。
- 能拿到就显示**歌手**，**最好也显示专辑**。
  - 数据现状：后端 `music/search|song|playlist` 只回 `title/author/url/pic/lrc`，**没有 album**。
    如果要专辑，需要后端补字段（另开单，别在本单里硬编）；拿不到就优雅省略，别显示空标签。
- 队列里「歌手」那行现在是 group（如「鸣潮」「在线音乐」）——顺手把它当来源更合适。

### R4 歌词区 / 频谱替代
- 歌词在**右侧**，当前句用**主题强调色**高亮。
- **歌词关闭时**：右侧用**频谱图/可视化**替代歌词，**保持那层遮罩/渐变在线**，别整块消失。
- **歌词按钮功能不变**：点一下切换 歌词 ⇄ 频谱，状态要能在重启后恢复（已有 `lyricsVisible` 记忆字段）。
- ⚠️ 频谱**不要动真音频链**：老 UI 用 `createMediaElementSource` 接过 `<audio>`，那是**不可逆**动作，
  AudioContext 一旦 suspended 就会**把声音变哑**（老 UI 为此写过一大段血泪注释）。
  本单要求：**做装饰性频谱**（CSS/JS 动画，由 `state.playing` 驱动），**不接 Web Audio**，零静音风险。
  真 FFT 本期不做。

### R5 主题配色
- 高亮/激活态（当前歌词、播放键、当前队列行、歌词按钮激活）统一用**主题强调色**。
- 【已修，需真机复核】已引入主题桥 `--hk-*`：
  ```css
  --hk-accent: var(--accent, #537D96);   /* 宿主给就用宿主，缺省落暖纸默认 */
  --hk-bg: var(--bg, #F8F4ED);
  --hk-surface: var(--bg-card, #FCFAF5);
  --hk-text: var(--text, #3B3D3F);
  --hk-muted: var(--text-muted, #6B6158);
  --hk-faint: var(--text-light, #8E9196);
  --hk-border: var(--border, rgba(122,96,88,.18));
  ```
  **组件层一律只吃 `--hk-*`**，不再直接写宿主变量名（缺省时按钮底色会变透明、白图标浮空，就是这个坑）。
- ⚠️ **待核实**：宿主主题样式表到底有没有注入到卡片 iframe（`?hana-css=`）。
  线上日志里**从未见到 `theme.css` 被请求**。若确实没注入，`--hk-accent` 会一直是暖纸蓝，
  罐头的主题色（他截图里是紫色）就永远吃不到。
  核实方法：卡片里 `getComputedStyle(document.documentElement).getPropertyValue('--accent')`；
  空 = 没注入。**若没注入**：app 侧自己 `fetch('/api/apps/theme.css?theme=' + (hana.theme 快照里的 theme))`
  并把返回的 CSS 注入 `<style>`（SDK 的 `followHostTheme` 已在做，但依赖 URL 参数，可能没带上）。

### R6 控制条窄宽排布
- 参考 `refs/bad-controlbar-narrow.png`：真机聊天卡实测宽仅 **~312px**，
  控制条（歌词 ⟳ ⏮ ⏸ ⏭ 🔊 | ☰ 队列）需要 ~365px → **右侧溢出被切**，且左侧「歌词」占位过多。
- 要求：窄容器下**不溢出、不挤没**，左右对齐、间距均衡。
  - 可考虑：窄时把「队列」收成纯图标、或把「歌词」并进第二行、或压缩 vol 组。
  - 自检里有 `control-visible:*` 断言（要求控件在容器内），改完必须仍全绿。

---

## 二、当前进度（先看，别重复劳动）

- 分支 `hana-simple`，HEAD `aa4c274`。工作区 `/Volumes/SSD/hanadesk/hanako-audio-player-simple`。
- 构建号 `1003131545`，**已部署到 `~/.hanako/apps/hanako-audio-player/` 并 reload 过**。
- **已完成**：
  - 接线全通（真 `<audio>`、后端列表、歌词四级降级链、导入、`hana.storage` 记忆）。
  - 卡片鉴权（`appSurfaceSession`）已补，歌单导入不再 403。
  - 视觉对齐设计稿（顶栏去盒、控制条摊平、队列行、抽屉宽度）。
  - 歌词区：滚动条常驻占位 + 悬停淡入；遮罩改「左透明→右厚」；歌词右移。
  - **本轮已改（待真机复核）**：`--hk-*` 主题桥；全局透明滚动条；当前歌词/播放键用强调色。
- **未做**：R2 封面贴左不裁切 + 右侧模糊渐变；R3 信息上移右侧 + 专辑；R4 频谱替代；R6 窄宽排布。

## 三、硬约束（踩了必炸）

- **只动 `ui/style.css`（主体）、`ui/index.html` + `ui/standalone.html`（同步改，只允许 `<body data-shell>` 一行差异）、
  `ui/app.js`（仅呈现层，别动业务逻辑）。**
- **必须保留 app.js 依赖的所有 `id` 与 `data-*` 钩子**（`frame player sceneTop queue queueHead queueList lyrics lyricWrap
  lyricScrim lyricBack drawerScrim seek vol toast audio`、`playBtn prevBtn nextBtn modeBtn muteBtn lyricToggle queueBtn
  backBtn drawerCloseBtn importBtn removeBtn morePop importPop importNote linkInput linkAddBtn report`、
  `data-layout data-page data-drawer data-lyrics data-shell data-theme data-id data-import`）。要加元素可以，别删别改名。
- 单文件、无构建、无框架、无 CDN；只用 SVG 线描图标（禁 emoji）；字号 ≥ 11px；不用 `position:fixed`；
  聊天卡片右上 **100×40 CSS px** 是宿主安全区，别放东西；根容器直角、无外圆角/外描边/外阴影。
- **别加回** PV / 切主题齿轮 / 标准唱盘 / 队列页 列表·搜索·场景·编排 tabs / 全部·本地·在线·收藏 筛选 / 收藏 ♡。
- 不碰 `lib/`、`manifest.json`、`app-data/`。**不要部署、不要 reload 安装目录**（主代理做）。

## 四、自检（必须真跑，没跑过不许说通过）

```sh
node tools/verify-ui.mjs     # 假后端 + 无头 Chrome：12 组布局自检 + 接线冒烟 + 截图
```
- 必须仍 **12/12 布局自检通过 + 接线冒烟全绿**（列表/播放/上下首/模式/歌词/导入/删除/抽屉/searchKey 解析）。
- 脚本已带**鉴权闸门**（无票 403）和**滚动条断言**（悬停前后歌词宽度必须相等），别绕过。
- 截图落 `/tmp/hap-verify/`（`OUT_DIR` 可改）。**至少出**：312 / 465 / 1040 三档宽 × 浅深 × 歌词开/关。
- 想单独复现某个状态，脚本里能改 `CASES`，或浏览器打开带 `?assert=1&shot=1&appSurfaceSession=x`。

## 五、交回

1. **逐条对照** R1–R6：改了什么、哪条没做到、为什么。
2. 改了哪些文件；纯 CSS vs 动了 DOM（附钩子核对）。
3. 截图：312 / 465 / 1040 三档 × 浅深 × 歌词开/关，最好带「改前|改后」。
4. `tools/verify-ui.mjs` 结果（自检数 + 冒烟 + 运行时报错）。
5. **没把握 / 需要罐头拍板的点**，明确列出，别自己硬定（比如：窄卡到底要不要也走「封面贴左」）。
