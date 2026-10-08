# hanako-audio-player 前端重构 · 交接简报（给 Codex）

> 读这份之前请先通读全文。它不是功能清单，是**一份踩坑记录 + 硬边界 + 两步走流程**。
> 目的：把 `ui/index.html`（约 1.8 万行、单文件、v1 整页 UI + 层层补丁）重构成一个**能适配任意容器尺寸的干净前端**。
> 流程要求：**先出方案图，我选一个，再落地。** 别一上来就重写实现。
>
> **基线**：当前线上版本（build `1003131534`）已修好一批布局/主题问题，**视觉基调已定**
> （跟随宿主 Hana 主题）。重构是**结构重做，不是换风格**。开工前先读 `docs/BASELINE.md`。

---

## ▶ 给 Codex 的提示词（第一步：把下面这段连同本文件一起发过去）

> 我要彻底重构 `hanako-audio-player` 的前端（`ui/index.html`，约 1.8 万行单文件）。完整背景见随附 `REFACTOR-BRIEF.md`，**请先读完它**。
>
> **这一轮只做第一步：出方案，不写实现。**
> 给我 **2–4 个结构上不同**的版式方向（不是换色，是结构不同），每个用**独立 HTML 原型**呈现（能直接渲染、可截图成图），覆盖简报 §6 列出的尺寸与状态。
> 每个原型都要能当场证明：**顶栏在、长列表能滚、歌词不溢出、没有多余空白**。浅色用 Hana house-style。
>
> 出完我选一个，你再进第二步落地。

---

## 1. 这是什么

- **Hana v2 App「音频播放器」**。宿主是 Hana（Chromium webview）。本地代码在 `~/.hanako/apps/hanako-audio-player/`。
- **两种承载**，尺寸都由宿主给、且会变：
  - 聊天里的卡片：宿主定尺寸（实测约 **465×930**，`envelope` 是 fixed）。
  - 点开的独立窗口：`manifest.json` 里 `detachedDefaultSize` = **1040×780**，可自由缩放。
- 前端是**一个单文件** `ui/index.html`（+ 孪生 `ui/standalone.html`），**无构建步骤**（没有打包器，改完直接跑）。这是历史包袱，**重构也必须保持单文件**。
- 后端在 `index.js` + `lib/`，前端通过 `/api/apps/hanako-audio-player/routes/...` 和一批旧的 `/widget/api/...` 路径调它。**后端契约不要动。**

## 2. 硬约束（踩了必炸）

1. **孪生文件**：`ui/index.html` 与 `ui/standalone.html` 内容必须一致，**只差那 5 行 AudioContext 调试块**（`window.__reactiveState`）。改一个必须同步另一个。
2. **构建号**：改完跑 `node tools/bump-build.mjs`，它同步 `ui/_build.json` + 两个 html 里的 `window.__HANA_BUILD`。
3. **PV 块是生成物**：`ui/index.html` 里 `PV:BEGIN` 与 `PV:END` 之间由 `node pv/build.mjs` 生成，**别手改**（下次构建会冲掉）。PV 引擎的源在 `pv/`（`pv/src` + `pv/css`）。
4. **宿主会快照 UI**：宿主在 app 加载时把 `ui/` 拷进 `~/.hanako/.cache/app-ui-snapshots/`，之后只认快照。**改了文件不会自动生效**，需要重载 app。所以别指望"保存即见"。
5. **宿主/沙箱约束**：
   - 不用 `position:fixed`（宿主 iframe 会塌）。
   - 聊天卡片里**右上角 100×40 CSS px 是宿主控件安全区**，别在那儿放文字/控件（背景/装饰可溢出）。
   - 最外层容器保持**直角**，不加外圆角/外描边/外阴影（宿主会裁）。
   - **禁 emoji**（现在封面占位符那个 `♫` 就是，要换 SVG 线描）。
   - 字号**不低于 11px**；颜色走 CSS 变量、不硬编码。

## 3. 现在有什么（重构时别丢的功能）

- **播放**：本地文件/文件夹导入（Range 流式播放）、在线搜索与直链（网易云/QQ/酷狗，meting 多节点降级）、粘贴歌单/单曲链接导入、播放列表分组（来源分组 + 自建分组，持久化）。
- **歌词**：自动匹配（五源回退）、逐字歌词（TTML 优先 / LRC 兜底）、离线歌词库（落盘）、歌词横幅（把当前行推到会话输入框上方）。
- **视觉舞台**：顶栏三模式胶囊 —— 标准（黑胶唱盘 + 队列）/ PV（文字 PV 舞台，JIZURA 式随机排版）/ 歌词（AMLL 式滚动窗）。
- **主题**：配色面板（金夜 / 暗夜 / 暖褐 / 深夜 / 霓虹 / 纸感 / 原色 + 自定义入口）、音频反应、背景层、明暗方向。
- **其它**：进度条、音量、播放模式、收藏、弹出窗口、字号切换（小/标准/大）。

## 4. 要解决的真正问题（根因，不是症状）

### 4.1 布局：容器尺寸可变，但 UI 是按「一个整视口」写死的

现状：大量 `vh`/`vmax` 单位 + 固定 px 高度；`html,body{height:100vh;overflow:hidden}`；响应式只写了一半（`body.bp-narrow/bp-wide` 有 JS 在写，**CSS 全文 0 次使用**）。

已实测的症状（都要在新版里消失）：

| 症状 | 根因 |
|---|---|
| 窄卡片里歌词被切、冒**双层滚动条** | `.lyric-body` 上限 220px > 父级 `.lyrics-section` 上限（now-playing 的 22% ≈ 121px），内容溢出父级，两层各滚一条 |
| 正在播放区下方**一大块空白** | `.np-info{flex:1}` 把列里的余量全吃光 |
| 高度一小，底部 tab 区**高度算成 0**，列表整块消失且滚不到 | 固定区之和（header+播放区+控制条+tabs）超过容器，`flex:1` 的剩余区被压到 0 |
| 大字号时内容比容器高 15%，**顶栏/底栏被挤出可视区** | 「字号」被实现成 `document.body.style.zoom`，放大的是整个版面；容器还是 `100vh`，必然溢出 |
| **播放列表很长时，打开后顶部消失、没有滚动条**（用户最新反馈） | 同一类：固定高度链 + 没有正确的滚动归属 |
| 独立窗口（≥660）顶栏标题被挤成 0 宽 | 左栏 300px，图标+标题+胶囊+4 按钮塞不下，标题先被牺牲 |

### 4.2 主题：换了一半的皮

- `applyTheme()` 定义在**主 IIFE 内部、没挂 `window`** → 「配色主题」预设的**明暗方向从来没生效过**：背景铺了、界面还是深色 → 纸底配浅字，看不见。
- 主脚本 1.5 秒后有一次 `clearInlineTheme()`，会把预设刚写上去的配色一起清掉（金夜的 `#D4AF37` 被清回默认 `#d49a6a`）。
- **目标（已定）：主题跟随宿主 Hana，自动同步，含夜间主题**——不要自己另起一套明暗。
  - 机制：`hana.theme`（快照 + 订阅，`{ theme, cssUrl }`）；SDK **默认已**把宿主主题
    样式表注入页面（`ui/sdk.js` 的 `followHostTheme` → `applyHostThemeStylesheet`）。
    **别定义同名 `--bg/--text/--accent` 去盖宿主。**
  - **两套皮别混**：`house-style.md`（纸 / 墨 / 远山蓝）是**卡片与文档**的审美；
    Hana **App 界面**是**深板岩 + 藕荷粉**（底 `#34424B` / 面 `#414D56` /
    强调 `#C99AAF` / 文字 `#E1EAF0`·`#9FB1BC`；小截图取色，权威以 `hana.theme` 为准）。
    播放器活在界面里，**穿后者**。
  - 强调色**只用在「当前 / 激活 / 强调」**（“选中变粉色”），不是到处刷。
  - 预设必须「模式 + 配色 + 背景」一起生效；**任何明暗 × 任何预设组合下文字都可读**。
  - 权威：`~/.hanako/recipes/hana-folio/references/house-style.md`（卡片面）
    + 宿主 `hana.theme`（运行时主题）；组件实现参考 `hana-card-style`。

## 5. 目标形态（重构后的验收标准）

1. 一条**真正的 flex 高度链**：`header`(固定) / `now-playing`(可收缩) / `controls`(固定) / `nav-tabs`(固定) / `content`(吃剩余，有下限)。每个可滚区 `min-height:0`。
2. **每个区域只有一个滚动容器**（杜绝双层滚动条）。
3. **列表永远可达**，在自己的 pane 里滚，绝不塌成 0。
4. **歌词绝不溢出**其容器。
5. **字号只放大文字**（不动布局），或放大布局但外层高度做补偿；任何字号都不把内容挤出可视区。
6. 响应式真正接线：窄 / 宽 / 矮三套（或容器查询），断点按**容器宽度**而非视口。
7. 主题**跟随宿主**（`hana.theme`）自动同步，含夜间主题；变量驱动，任何明暗下文字都可读。
8. 保持 §2 的宿主约束与 §3 的功能。

## 6. 第一步要交的东西（方案图）

给 **2–4 个结构不同**的版式方向。每个方向用**独立 HTML 原型**（能直接渲染、可截图）呈现，必须覆盖：

**尺寸**
| 名称 | 尺寸 | 说明 |
|---|---|---|
| 卡片 | 465×930 | 聊天里的窄卡片 |
| 高窄 | 585×1172 | 竖长窗 |
| 窗口 | 1040×740 | 独立窗口（宽版分栏） |
| 矮窗 | 531×451 | 极短，考验高度链 |

**状态**
- 有歌词 / 无歌词
- **很长的播放列表**（≥40 首，必须证明能滚、顶部不消失）
- 浅色（Hana 纸感）/ 深色

**每个原型都要当场证明**：顶栏在、长列表能滚、歌词不溢出、没有多余空白。

> 关于「生图」：UI 重构**首选能渲染的 HTML 原型**（我可以自己截图看），比静态效果图有用得多。如果你那边有图像生成能力，可以额外出几张风格/氛围效果图，但不能替代原型。

## 7. 第二步要交的东西（落地）

- 按选定方向重写前端，保持**单文件、无构建步骤**。
- 同步两个 html，跑 `node tools/bump-build.mjs`。
- 保持后端契约、PV 块、主题预设系统（localStorage 键：`hana_audio_theme_preset`、`hana_audio_theme_custom`、`hanako_audio_theme`、`hanako_audio_font_scale`）不变。

## 8. 怎么本地验证

```bash
# 静态服务（宿主浏览器不吃 file://）
cd ~/.hanako/apps/hanako-audio-player/ui && python3 -m http.server 8777

# 无头 Chrome 截图（本机已装）
"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless --disable-gpu \
  --window-size=465,930 --screenshot=/tmp/a.png http://127.0.0.1:8777/standalone.html
```
> 更省事的办法：本机有 `puppeteer-core`（`/Volumes/SSD/hanadesk/鹈鹕/motion-reel/node_modules/puppeteer-core`）+ 系统 Chrome，可以脚本化在多个尺寸下截图 + 量尺寸。

**注意**：改完在真机上要**重载 app** 才生效（见 §2.4 宿主快照）。

## 9. 文件地图

```
~/.hanako/apps/hanako-audio-player/
├── manifest.json                 # v2 清单：cards.player，route /index.html，detached /standalone.html，1040×780
├── index.js                      # v2 App 入口（apply(ctx)）
├── lib/
│   ├── state.js                  # 播放状态
│   ├── register-routes.js        # 后端路由（含 /widget/api/... 旧路径，别改）
│   ├── register-tools.js         # 暴露给模型的工具
│   ├── meting.js                 # 在线音源（多节点降级）
│   └── cookies.js                # 读取 app-data/cookies.env
├── ui/
│   ├── index.html                # ★ 主 UI（约 18335 行，单文件）
│   ├── standalone.html           # ★ 孪生（约 18330 行，只差 5 行调试块）
│   ├── _build.json               # {"build":"..."}
│   ├── sdk.js                    # 宿主 SDK
│   └── face-portrait.png
├── pv/                           # 文字 PV 引擎源（src + css），build.mjs 生成 PV 块
├── themes/                       # default / spectrum / waveform 三个可视化主题
├── tools/                        # bump-build.mjs 等
└── app-data（在 ~/.hanako/app-data/hanako-audio-player/）  # playlist.json / cookies.env / lyrics/，安装不碰
```

## 10. 已知坑（我这一路踩的，直接给 Codex 避雷）

1. 宿主**快照 UI**，改了不生效；`reload` 只对"从本地目录装"的 app 开放。
2. `applyTheme` 没挂 `window` → 预设明暗方向失效。
3. `clearInlineTheme()` 1.5s 后清掉预设配色。
4. `body{zoom}` 当字号 → 整个版面跟着放大 → 溢出。
5. `bp-narrow/bp-wide` 是**死类**（有 JS 写、没 CSS 用）。
6. `vh`/`vmax` 是按"整页"设计的，塞进可变容器必然错。
7. `.lyric-body`(220px) 与 `.lyrics-section`(22%) 两套上限打架 → 双层滚动条。
8. `.np-info{flex:1}` → 虚空。
9. 固定区之和常超过容器 → `flex:1` 的剩余区被压到 0。
10. 孪生文件必须同步；PV 块是生成物别手改。

---

## 附：Hana house-style 速查（配色）

| 维度 | 值 |
|---|---|
| 纸底 / 卡面 | `#F8F4ED` / `#FFFDF7` |
| 纸色分层 | sheet `#FFFDF7` → 卡白 `#FCFAF5` → 纸 `#F8F4ED` → 沙 `#E8E6DC` |
| 墨色 | `#2A2622` / `#4A433C` / `#6B6158` |
| 强调色（唯一） | 远山蓝 `#537D96`，深变体墨蓝 `#1B365D` |
| 暖点缀 | 印章赭 `#9D5F4D`（极少用，不做大面积填充） |
| 几何 | 小圆角约 5px（图 8px + 白边），不用大泡泡 |
| 图标 | 只 SVG 线描，禁 emoji |
| 禁用 | 左竖线当区块装饰；硬编码色；字号 < 11px |
