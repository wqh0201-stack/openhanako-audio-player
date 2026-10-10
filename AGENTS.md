# AGENTS.md · hanako-audio-player

这是 **Hana v2 App「音频播放器」** 的源码仓库。
**这不是宿主安装目录**——安装目录是 `~/.hanako/apps/hanako-audio-player/`，那是部署目标
（宿主会把它快照进 `.cache/app-ui-snapshots/`），别把它当工作区。

**许可证是 AGPL-3.0，不是 MIT。** 本仓是 [openhanako-labs/openhanako-audio-player](https://github.com/openhanako-labs/openhanako-audio-player)
（AGPL-3.0）的**衍生作品**，必须同证分发：别改回 MIT，也别把它当可以闭源/商用的东西
（要闭源得上游的商业授权）。README 与 `LICENSE` 已按 AGPL-3.0 写好。

**远端与分支**：本地 `fork` remote 指 `wqh0201-stack/openhanako-audio-player`（2026-10-09 起常驻）。
`hana-simple` 是**本仓这版**、也是 fork 的默认分支；`master` 是上游原样；
`fix/same-origin-audio-proxy` 是给上游的 PR 分支（基于上游 master，与本版历史不相连）。
推送：`git push fork hana-simple`。

---

## 0. 动手前先读技能：Hana App 的官方做法都在 `hana-app-creator` 里

本仓库的代码是**一个 Hana v2 App**。凡是涉及 App 本体的东西——manifest、SDK、
卡片（card）、窗口（window）、surface、权限与审批、安装/重载生命周期——
**先读技能，别凭记忆、也别从旧代码反推**：

| 要什么 | 在哪 |
|---|---|
| 技能入口 | `~/.hanako/skills/hana-app-creator/SKILL.md` |
| 打包的 Builder 工作流（隔离开发 / 卡片交互 / reload 检查） | `~/.hanako/skills/hana-app-creator/references/builder.md` |
| 完整契约（宿主权威，最新） | `~/.hanako/artifacts/server/<ver>/APPS.md`（英文 `APPS_EN.md`） |
| 环境自检 | `node ~/.hanako/skills/hana-app-creator/scripts/check_env.mjs` |
| 静态校验 | `node ~/.hanako/skills/hana-app-creator/scripts/validate_app.mjs --dir <app> --json` |
| 打包 | `node ~/.hanako/skills/hana-app-creator/scripts/pack_app.mjs` |
| SDK 类型包 | `~/.hanako/skills/hana-app-creator/assets/sdk/*.tgz` |

技能里跟本 App **直接相关**的几条（要点，细节回技能原文）：

- 聊天里的 v2 App iframe/webview 卡片要**按可用的聊天列宽设计**。
  `hana.ui.resize({ width })` 会被宿主分配的上限卡住；`hana.envelope`
  报告当前分配、随布局变化——**不要假设固定像素上限**。
- App 自有窗口：`await hana.ready()` 之后用公开的 `hana.window` API。
  自定义标题栏 = `chrome: "custom"` + `control("toggle-fullscreen")`；
  普通 iframe 没有原生窗口桥。
- `runTool` 只是窄口径直测（空会话/消息上下文），**不代表真实会话**，别拿它当验收。
- 安装生命周期：声明了哪些受保护能力，`defineApp` 第一次回调前就生效，
  别加定时器/重试去等授权。reload 立即应用普通本地编辑；只有 manifest 扩权
  才需要重新审批（取消则旧实例继续跑）。
- 沙箱禁用清单（`position:fixed`、直接 `localStorage`、`window.open`、表单提交、
  重复文档外壳、字号 < 11px …）以技能为准。

---

## 1. 这个 App 是什么

- 音频播放器：本地/在线播放、歌词（自动匹配 + 逐字 + 离线库 + 会话横幅）、
  黑胶唱盘 / 文字 PV / 歌词三模式、配色主题与音频反应。
- 前端是**单文件** `ui/index.html`（+ 孪生 `ui/standalone.html`），**无构建步骤**
  （没有打包器，改完直接跑）。这是历史包袱，**重构也要保持单文件**。
- 后端 `index.js` + `lib/`（routes / meting / cookies / state），前端通过
  `/api/apps/hanako-audio-player/routes/...` 与一批旧的 `/widget/api/...` 调它。
- 两种承载，尺寸都由宿主给、且会变：聊天卡片（实测约 465×930）、
  独立窗口（`manifest.json` 里 `detachedDefaultSize` = 1040×780，可缩放）。

## 2. 硬约束（踩了必炸）

1. **孪生文件**：`ui/index.html` 与 `ui/standalone.html` 内容必须一致，
   **只差那 5 行 AudioContext 调试块**（`window.__reactiveState`）。改一个必须同步另一个。
2. **构建号**：改完跑 `node tools/bump-build.mjs`，它同步 `ui/_build.json` +
   两个 html 里的 `window.__HANA_BUILD`。
3. **PV 块是生成物**：`ui/index.html` 里 `PV:BEGIN` 与 `PV:END` 之间由
   `node pv/build.mjs` 生成，**别手改**（下次构建会冲掉）。PV 源在 `pv/`。
4. **宿主快照 UI**：宿主在 app 加载时把 `ui/` 拷进
   `~/.hanako/.cache/app-ui-snapshots/`，之后只认快照——**改了文件不会自动生效**，
   要重载 app。
5. **宿主/沙箱**：不用 `position:fixed`；聊天卡片里右上角 **100×40 CSS px**
   是宿主控件安全区（别放文字/控件）；**顶部两角要圆**——宿主只在独立窗里把 App 面
   裁圆（iframe 吃 `--radius-lg`），卡片里不裁，所以卡片壳自己补（见 §6）；无外描边/
   外阴影；**禁 emoji**（用 SVG 线描）；字号**不低于 11px**；颜色走 CSS 变量、不硬编码。

## 3. 目录

```
hanako-audio-player/
├── manifest.json          # v2 清单：cards.player，route /index.html，
│                          #   detached /standalone.html，1040×780
├── index.js               # v2 App 入口（apply(ctx)）
├── lib/
│   ├── state.js           # 播放状态
│   ├── register-routes.js # 后端路由（含 /widget/api/... 旧路径，别改）
│   ├── register-tools.js  # 暴露给模型的工具
│   ├── meting.js          # 在线音源（多节点降级）
│   └── cookies.js         # 读取 app-data/cookies.env
├── ui/
│   ├── index.html         # ★ 主 UI（单文件，约 1.8 万行）
│   ├── standalone.html    # ★ 孪生（只差 5 行调试块）
│   ├── _build.json        # {"build":"..."}
│   ├── sdk.js             # 宿主 SDK
│   └── face-portrait.png
├── pv/                    # 文字 PV 引擎源（src + css）；build.mjs 生成 PV 块
├── themes/                # default / spectrum / waveform 三个可视化主题
├── tools/                 # bump-build.mjs 等
└── docs/REFACTOR-BRIEF.md # ★ 前端重构交接简报（开工前先读）
```

app-data（`~/.hanako/app-data/hanako-audio-player/`：`playlist.json` /
`cookies.env` / `lyrics/`）**不在本仓库**，安装/重装不碰它。

## 4. 部署回路

1. 在本仓库改。
2. 同步 `ui/` 进 `~/.hanako/apps/hanako-audio-player/`；
   **或**更省事：把本仓库装成本地来源
   （`extension_manager install`，source `local`），以后能直接 `reload`。
3. `node tools/bump-build.mjs`。
4. **重载 app（必须，别省）**：`extension_manager reload app:hanako-audio-player`。
   页面**不会**自己刷新 —— `index.html` 里只写了 `window.__HANA_BUILD` 标记，**没有** _build.json
   轮询块，光同步文件不生效。忘了这步 = 罐头看到的还是旧版。（2026-10-10 踩过：只推了文件没 reload，
   罐头以为没生效；更早一次还漏同步 CSS → `.cell` 退化成块级、元素竖堆。）

> 一句话：**改完 → 同步 `ui/` 整包（index/standalone/style/_build）→ `reload` app**。三步缺一不可。

## 5. 当前任务

**前端重构 + 极简版接线**。原型（`docs/player-ui/`）已落进生产 `ui/`，接线完成并部署。

- 交接与结论：`docs/player-ui/WIRING-DONE.md`（宿主主题变量、旧列表 searchKey 形状、部署回路）
- 多歌单改造（列表精简 + 顶部切换 + 本地固定文件夹 + 夜间兜底）：`docs/player-ui/REFINE-DONE-LISTS.md`
- 第二轮（四项拍板 + 拖进/拖出生命周期修复）：`docs/player-ui/REFINE-DONE-LISTS-2.md`
- 第三轮（来源重做 + 歌单真名 + 歌手补齐 + 歌单可删）：`docs/player-ui/REFINE-DONE-SOURCES.md`（**未部署**，等审）
- 第四轮（封面环境色：读封面右缘像素 → 竖向渐变铺满 + 歌词两态薄纱 + 封面右缘 mask）：
  `docs/player-ui/REFINE-DONE-AMBIENT.md`；深色封面夹具由
  `node tools/make-fixture-covers.mjs` 生成
- 第五轮（动效复审修复 + 频谱真律动）：`docs/player-ui/REFINE-DONE-MOTION-2.md`（**已部署**，构建号 1003131565）。
  要点：歌词/频谱交叉淡入淡出、队列退场（含矮卡整页交叉）、指针悬停不再重置自动回归；
  频谱接真音频需**同源媒体** → `music/go` 改分片流式代理（原理见知识库
  `20-资料/Web Audio 频谱反应-同源媒体与CORS陷阱.md`）
- 歌单改名不持久化修复：`docs/player-ui/REFINE-DONE-RENAME-PERSIST.md`（**已部署**，构建号 1003131567）。
  根因：`boot()` 早于 `sdk.js` 执行，`window.hana` 未就绪 → 读存储永远 null，
  回写默认名把真名冲掉（详见知识库 `20-资料/Hana App 卡片UI-主题变量与存储接线.md`）
- 系统「正在播放」接线（macOS 控制中心 / 媒体键）：`ui/app.js` 的 `syncMediaSession()`
  （挂在 `renderTrack()`）+ `syncPositionState()`（`timeupdate` / `seeked`）+ 一次性
  `bindMediaSessionActions()`（play/pause/上下曲/seek/stop）。**封面必须同源**：
  跨源图会被 Chromium 静默丢弃（面板退回占位图），所以加了 `lib/register-routes.js`
  的 `/widget/api/music/cover` 代理路由，artwork 只吃它。**已部署**，构建号 1003131572
  （封面 2026-10-09 真机确认）。
  原理与坑：知识库 `20-资料/macOS 正在播放-Web App 接线（mediaSession）.md`。
  2026-10-09 真机验收：面板标题/歌手/封面 + 上一曲/下一曲 + 媒体键（F7/F8/⏯）全部可用。
  仅剩边界：宿主自己出声时的面板归属（音频焦点之争）。
- 随机播放的「上一曲」修好了（原来也随机到另一首）：随机模式里留一条「听过的路」
  （uid 栈，`shuffleTrail`），上一曲先弹当前再取末尾，走空则退回顺序上一首；
  下一曲仍随机（罐头要的手感）。栈随 playback-state 快照落盘。**已部署**（随红心那轮带上），
  交接见 `docs/player-ui/SHUFFLE-PREV.md`（只有 `ui/app.js` 一个文件）。
- 红心挪常驻位 / 歌词开关删除 / 自动居中（2026-10-09，**已部署**，构建号 1003131578）：
  ① 控制条最左那颗「歌词」文字按钮删掉，原位换成红心「喜欢」（`#favBtn`，`.fav-text`）——
     三种布局常驻，永远够得着（之前只有队列行 + 播放页 meta 两处，队列滚走就点不到）。
     队列行 / 播放页两处保留。**修了一个真 bug：播放页 `#stageFavBtn` 一直是空标签**
     （只有外壳没 `icon()`），肉眼看不见 —— 现在 `renderTrack()` 里补 `icon('i-heart')`。
  ② 未点亮的空心线条改用**撞色 `--hl-accent`**（与歌词当前句高亮同一套），
     否则在封面上太淡看不见。三处入口共用。
  ③ **歌词显隐开关整个删除**（`state.lyrics` / `lyricsVisible` / `renderLyricToggle` / 自检里的
     `lyricToggle` 引用全清）。新逻辑：**有词就显歌词、没词才出频谱**（频谱降为兜底）。
     `data-lyrics` 保留为常量 `'1'` —— CSS 换层动画以它做命名空间，**别删**。
  ④ 切列表 / 切歌时用 `centerCurrentInQueue()` 把正在播的那首滚进队列可视区中部。
     点心/移出等重渲染**不触发**，不抢用户滚动位置。
  断言：`control-bar-fav-toggles` / `queue-center-on-list-switch` / `stage-fav-toggles-and-syncs-row`
  （含图标存在性）—— 验收计数升到 **68/68**。
- 跨源安全 + 歌词兜底（2026-10-09，**已部署**，构建号 1003131580）：
  ① **拆一颗真雷：跨源音频接 `createMediaElementSource` 会输出全零（真·静音）**。
     它是单程票（不可逆），而全曲共用一个 `<audio>`，一次建链后所有跨源歌一起哑。
     改成 `audio.captureStream()` → `MediaStreamSource` → `Analyser`（副本增益 0，不叠音）：
     同源能读数据；跨源直接抛 `SecurityError`，被捕获后**元素照常出声**、退 `is-reactive`
     回 CSS `specPulse`。`loadAudio` 换源时调 `resetReactive()`，允许同源/跨源交替。
     （实测：同源 `fmax=255`；跨源 `createMediaElementSource` 下 `fmax=0/dev=0` 无报错，
     `captureStream` 下抛错但播不断。）断言 `reactive-uses-captureStream-not-mediaElementSource`。
  ② 歌词降级链尾部新增**跨源兜底**：本平台/本 id 没词时，拿「标题+歌手」去其余 4 个平台
     搜一次，`pickLyricHit` 按「标题完全相等 / 部分包含+作者对得上」接受（宁缺毋滥，
     只在 `mode==='在线'` 与当前无词时触发）。断言 `lyric-crosssource-match-rules`。
     ⚠️ 别改回 `createMediaElementSource`：跨源会静音且不可逆（原理与实测见
     知识库 `20-资料/Web Audio 频谱反应-同源媒体与CORS陷阱.md`）。
- 搜索页（罐头最初需求，2026-10-09，**已部署**，构建号 1003131584）：
  ① 左下角控制条那块（`.controls-info`，原本显示歌名/歌手 `ciTitle`/`ciArtist`）换成**搜索入口**，
     仅独立窗口（`data-layout="wide"`）显示（窄卡/长卡控制条本来就没这格）。`ciTitle`/`ciArtist` 已删。
  ② 新增**搜索页**（`#searchPage`，整页浮层盖住 stage+controls）：输入框 + 5 平台选择 +
     **搜歌曲 / 搜歌手**范围切换 + 结果列表（每行「加入」）。结果归入**当前激活列表**，
     本地/我的喜欢时新建/复用名为「搜索」的导入列表（与 `resolveImportTarget` 同口径）。
  ③ **热门推荐**：搜索页空白时预置，后端新路由 `/widget/api/music/hot` 走网易云官方
     `/api/personalized/newsong`（`music.163.com` 已在白名单），拉不到静默回空。
  ④ 竞态：`loadHot` 与 `doSearch` 共用代次 `searchSeq`，热门回填不覆盖用户已发起/已输入的搜索结果。
  断言：`search-entry-visible-in-window` / `search-entry-hidden-in-card` / `search-page-lists-results` /
  `search-add-into-active-list` / `search-page-esc-closes` / `search-scope-song-and-artist` / `search-hot-recommendations`。
  动效/视觉沿用现有语言（同一条 cubic-bezier、轻位移不抢镜、统一按压反馈、reduced-motion 退为纯淡入）。
  后端 `verify-backend.mjs` 仍 10/10（新增路由不改既有单测）。⚠️ **搜索结果会引入非网易云曲目**，
  即前面那颗「跨源静音雷」的真实验证场景。
  **后续修正（2026-10-10，罐头真机反馈，构建号 1003131588）**：
  ① 搜索页从「盖整卡」改为**只盖舞台**（移到 `.stage` 内）—— 底部控制条全程可见可用（断言
     `search-page-not-cover-controls`）。
  ② 「加入」改为**直落「我的喜欢」**（不再落当前歌单 / 新建隐形「搜索」歌单）—— 搜索心智 = 收藏，
     与红心一致（断言 `search-add-goes-to-fav`）。
  ③ 推荐区：热门歌曲限 **6 条**（多了会把下面顶出屏）、榜单/歌单/电台改**横滑一行**——三块一屏可见。
- 搜索页交互定稿（2026-10-10，**已部署**，构建号 1003131590）：
  ① **抽屉式探出/收回**：左下角搜索入口点一下从**左侧**滑入、再点一下滑出（与队列抽屉同一套
     `cubic-bezier(0.22,0.61,0.36,1)` + `is-s-leaving` 延迟卸载，可打断）。
  ② **层级**（罐头拍板）：**队列抽屉(30) > 遮罩(28) > 搜索页(22) > 歌词/封面**。搜索页开时队列仍能呼出、
     且压在其上。
  ③ **分层返回**：搜索页内「返回」/ Esc 按层级退 —— 详情层（搜索结果/榜单/电台）→ 推荐区根层 →
     再按才退出搜索（标签随层级变「返回 / 收起」）；左下角入口按钮**直接** toggle 退出。
  ④ **占位词当无词**：歌词源回的「这似乎是一首纯音乐呢」「纯音乐，请欣赏」等占位句
     （`lyricIsPlaceholder`，只看前 3 句）视作无词 —— 不再占歌词层，回到封面 + 涟漪；
     且不落盘（避免下次读离线库又当它有词）。
  断言：`search-entry-toggles` / `search-back-layered` / `lyric-placeholder-treated-as-empty`。
- 「最近播放」（2026-10-10，**已部署**，构建号 1003131592）：新增固定列表 `recent`（罐头拍板）。
  ① 排序：我的喜欢 → **最近播放** → 本地 → 导入歌单；命名/不可删/不可重命名同 fav。
  ② `recordRecent()`：**任何来源**播过的歌自动记进去（不只是搜索），按稳定 id 去重，
     最近的在最前（重播则移到末尾），上限 100 条（超出丢最旧，不丢正在播的）。
     在 `playTrack()` 里换曲时调，`detached` 临时条目不记。
  ③ 搜索结果/热门行主体（`.search-hit`）**点一下直接播**（不必先加入）——
     播完自动进最近播放，所以不建永久列表也能在队列看到它。不切激活列表（不打断搜索上下文）。
     （行尾那颗按钮的最终形态见下条：由「加入」改为红心。）
  断言：`search-hit-plays-directly` / `recent-list-records-played`；迁移断言加入 recent 空列表。
- 搜索行尾「加入」→ 红心 + 涟漪改版（2026-10-10，**已部署**，构建号 1003131594）：
  ① **加入 = 心**（罐头拍板）：搜索结果 / 热门推荐行尾按钮由「＋加入」文字改为**红心**，
     与队列行红心同一套视觉（未点亮撞色描线、点亮实心）。加入 = 收藏到「我的喜欢」，
     与红心本就是同一件事（之前错把它和「点行播放」并成一个动作，已纠正）。
     顺带移除 `_inList` / `markSearchInList` / `hotSongInList` 这套「已在列表」旧机制——
     红心状态直接由 `isFav()` 现算。
  ② **播放 ≠ 喜欢**（罐头拍板）：点行主体**只播放**，不落喜欢；播过的仍自动进「最近播放」。
  ③ **涟漪改版为「等高线波场」**：指针涟漪整层重写为双缓冲高度场 + 等高线 + 压扁圆环，
     照 `docs/player-ui/ripple-lab.html` 移植；仍**不读音频**。层序 z-index 2 → 3
     （薄纱之上、文字之下），强度两档（有词收 1.0 / 无词放 1.9，由 `data-haslyrics` 决定）。
  断言：`search-fav-toggles-fav`（原 `search-add-goes-to-fav`）/ `play-does-not-fav`。
- 控制条重排：搜索/队列对称 + 歌名回控制条（2026-10-10，**已部署**，构建号 1003131597）：
  ① **搜索与队列两端对称**（罐头拍板）：搜索入口从左侧竖列（原 `.controls-info`）挪进按钮行
     最左端，收成**纯图标**；最右的队列也收成**纯图标**（宽窗隐藏 `.qb-label`，数字/「正在播放」
     提示不再占位）。两端同高、左右呼应。
  ② **歌名回到控制条**（罐头拍板）：把 `f2c7269` 那步删掉的歌名加回来 —— 新元素 `#ctlTitle`
     （在 `renderTrack()` 里跟当前曲同步），**固定宽度**（`flex: 0 0 240px`，长短歌名不影响右侧，
     超出省略号）；只显示歌名一行。
  ③ **大卡片专属**：搜索图标与歌名都只在 `data-layout="wide"`（独立窗口）显示；窄卡/长条不显示
     （那里本来就没搜索这格）。`.controls-info` / `.ci-title` / `.ci-artist` 旧规则已删。
  ④ **三段式网格 = 播放键钉在底栏正中**（罐头拍板，2026-10-10，**已部署**，构建号 1003131606）：
     `.btn-row` 改回 `display:grid; grid-template-columns:minmax(0,1fr) auto minmax(0,1fr)`（`a7fa4ad` 原版写法），
     三格 `.cell-left/.cell-center/.cell-right`：左格 `[🔍 歌名 ♡ ⟳]` 贴左、中格 `[⏮ ▶ ⏭]`、右格 `[🔊 | ☰]` 贴右。
     两翼 1fr 等宽 → 中格恒居中，**播放键固定落在底栏正中**，不受左右内容宽窄影响（`ctl-play-centered-wide` 断言 <2px）。
     踩过的坑：中间曾改扁平 `flex + space-between`，播放键会漂到 ~60%；且**部署只同步了 HTML、漏了 CSS** →
     `.cell` 无样式退化成块级、元素竖着堆（罐头看到的「左右各挤成一坨」）。**部署必须整包同步 index/standalone/style/_build**。
  断言：`search-entry-visible-in-window`（改判自身 display + 位置）/ `ctl-endpoints-symmetric-wide` /
  `ctl-play-centered-wide`（新，播放键居中）/ `search-entry-hidden-in-card` / `ctl-title-hidden-in-card`。
- 推荐区（2026-10-10，**已部署**，构建号 1003131585）：搜索页空白时开**三个推荐区**
  （罐头要「两种都要」）——
  ① 热门推荐（歌曲，可逐首加入）；② 榜单 · 歌单（点开拉前 30 首）；③ 热门电台（点开拉节目）。
  后端四个新路由（均走 `music.163.com` 官方接口，已在白名单；拿不到静默回空）：
  `/widget/api/music/hot`（已有）、`/charts`（toplist + personalized/playlist）、
  `/chart-tracks`（v6 详情取曲目）、`/radios`（djradio/recommend/v1）、
  `/radio-programs`（dj/program/byradio，**必须带 Referer** 否则 code:-462）。
  电台节目音轨（`mainSong.id`）走 Meting `type=url` 跳板即可播（302 → `*.music.126.net`，与普通歌同路）。
  ⚠️ 电台是**播客长音频**（约 50 分钟/期），时长/歌词/频谱按歌设计，真机播放手感需单独验。
  接口实测矩阵（含哪些端点走不通）见知识库 `20-资料/网易云热门榜单与电台接口实测.md`。
  断言：`search-discover-three-blocks` / `search-chart-opens-tracks` / `search-radio-opens-programs`。
- 无头验收：`node tools/verify-ui.mjs`（12/12 布局自检 + 4/4 窄卡 + **101/101** 断言 + 接线冒烟 + 迁移 + 跨文档生命周期 + 来源/真名/补齐/删除 + 红心/我的喜欢 + 环境色两态/兜底 + 动效五项 + 跨源安全/歌词兜底 + 搜索页/推荐区 + 涟漪 + 控制条对称/歌名 + 切换条溢出/跟随 + 音量浮层）
- 指针涟漪（2026-10-10，**已部署**，构建号 1003131586）：**旧「频谱」整层替换为 Canvas 2D 指针涟漪**。
  方案与行为约定：`docs/player-ui/RIPPLE-CANVAS-2D.md`（罐头拿提示词请教前端高手后的作品，已落地）。
  层序改为：封面(z1) → 涟漪(z2) → 蒙层(z3) → 歌词/标题(z4)；涟漪落在文字与蒙层下方，
  所以**常驻**，不再跟歌词互斥（无词时画面 = 封面 + 涟漪）。
  行为：指针移动累计距离才落波、按下更大一圈、播放且空闲时低频自起（呼吸波）；
  暂停约 350ms 收敛后停 rAF；截图/ reduced-motion / 隐藏 / 离屏全停调度；DPR 封顶 2。
  ⚠️ 当时**不读音频**（`captureStream` / `AnalyserNode` 整条链删掉），从根上避开跨源静音雷；
  2026-10-10 罐头改拍板**把音频接回来驱动涟漪**，见下方「涟漪接真音频」一条。
  断言：`ripple-layer-when-no-lyrics` / `motion-lyric-crossfade` /
  `motion-ripple-when-no-lyrics` / `motion-ripple-poke-adds-wave`。
  真机待验：浅深主题观感、三种布局下涟漪密度、歌词可读性是否受扰。
- 涟漪接真音频 + 流光（2026-10-10，构建号 1003131601）：
  ① 画法从「等高线」换「**流光**」：照 `docs/player-ui/ripple-lab.html` 的 light 模式移植——
    高度场当水面法线化成明暗、低分辨率放大成柔光（`paintField`）+ 压扁圆环。
    强度两档对齐 lab 的「波澜」滑杆：**无词 0.50 / 有词 0.32**。
  ② 音频反应：`<audio>.captureStream()` 另拷一路 → `AnalyserNode`（**fftSize 4096**、smoothing 0.65）
    → 40~180Hz 低频能量；超滑动均值 1.28 倍且够响 → 落一个波，力度由低频定。
    **只走 captureStream，绝不 `createMediaElementSource`**（跨源输出全零且不可逆）；
    跨源抛错则退回纯指针，绝不静音。同源靠 `music/go` 的分片代理。
  ⚠️ fftSize 是坑：沿用旧频谱柱的 128 时每 bin 有 344Hz 宽，40~180Hz 全挤进 bin 0，
    bass 恒 0、鼓点永不触发（看着「接上了」其实没反应）；4096（10.8Hz/bin）才通。
    详见知识库 `20-资料/Web Audio 频谱反应-同源媒体与CORS陷阱.md` §五。
  断言：`reactive-uses-captureStream-not-mediaElementSource`（源码级守卫）/ `motion-ripple-reactive-to-audio`。
  真机待验：真实网易曲目下的鼓点灵敏度（阈值 0.014 是 lab 的经验值）。
- 第六轮（舞台底部渐隐 + 顶部圆角，2026-10-09 罐头拍板）：
  ① `.scene::after` 的舞台底部渐隐**已整个撤掉**：先是从「固定 72px 刷主题面色」改成「按舞台高比例
     `clamp(36px, 9%, 72px)`、化进 `--ambient-color`」，真机看过之后罐头拍板**连这道也去掉** ——
     舞台底边直接硬切到控制条，全屏只留歌词那侧往左的淡入（`.lyric-scrim`）。
  ② `.player` 顶部两角自己补圆角（`14px 14px 0 0`，只上两角）—— 宿主只裁独立窗，
     卡片不裁；`.frame` 底色改 `--hk-surface`，让角上露出卡面色而不是页面色。
  断言 `bottom-fade-removed`（反断言，防回归）/ `top-corners-rounded` / `corner-reveals-card-surface`。
  详情 `docs/player-ui/REFINE-DONE-AMBIENT.md` §五-3
- 红心 / 我的喜欢（2026-10-09，**已部署**，构建号 1003131576）：
  新增固定列表 `fav`「我的喜欢」——排切换条**最前**、当默认首页（`state.activeList` 初值 `fav`）、
  **不可删**（长按不出浮层，`deleteList`/`openListPop` 都挡）、**不可重命名**（`startRename` 挡）。
  判定红心按**稳定 id**（`t.id`）而非 uid —— 同一首歌在不同列表 uid 不同，用 uid 会「原歌单点过、
  我的喜欢里灭」。加入 = 在 fav 放一份副本（`addFav` 借 `toStoredTrack` 保 pic/author/lrcUrl/raw）；
  取消 = 只摘 fav 那份（`removeFav`），原歌单纹丝不动；若正播 fav 那份，有其他副本则转指针，
  否则打 `detached`（播完不落盘）。入口两处：队列行右侧 `.q-fav` + 播放页 `.fav-btn`（meta 行内）。
  图标 `i-heart` 线描，点亮 `fill:currentColor` + 强调色。
  ⚠️ **fav 是「无归属」的额外列表**，会出现在切换条最前；与 `local` 一样不吃 `imp:N` 编号。
  断言 `fav-row-toggles-on` / `fav-list-collects-and-labels` / `fav-state-by-stable-id-cross-list` /
  `fav-unfav-keeps-original-list` / `fav-not-deletable` / `stage-fav-toggles-and-syncs-row`。
- 音源改造（2026-10-10，罐头拍板「按你说的」，构建号 1003131604）：**删酷我/百度，接 B站**。探活结论见知识库《音乐音源探活与层级》。改动：
  ① `ui/app.js` 的 `SEARCH_SERVERS` 改为 网易云 / B站 / QQ / 酷狗（删酷我、百度；两处跨源回退列表同步）；`lib/meting.js` 的 `ALLOWED_SERVERS` 删 kuwo/baidu。
  ② 新增 `lib/bilibili.js`：搜视频抽音轨（search → view → playurl，选最高带宽 dash.audio）；`lib/register-routes.js` 的 `/music/search` 对 `server=bilibili` 走它，`resolveAudioUrl` 加 bilibili 分支（id=bvid，走 go 跳板同源分片代理），go 的 fetch 与 cover 路由对 B站带 Referer。
  ③ `manifest.json` allowedHosts 加 `api.bilibili.com`、`*.hdslb.com`、`*.bilivideo.cn`、`*.bilivideo.com` —— **属扩权，reload 需重新审批**。
  验收：verify-backend 10/10、verify-ui 89/89（布局 12/12、窄卡 4/4、wiring/migration/lifecycle 全绿、零运行时错误）。
  未做：QQ/酷狗仍「搜得到播不了」（公共节点无直链，要救需 cookie）；B站无 LRC 歌词源（退回无词）。
- 歌单切换条溢出（2026-10-10，**已部署**，构建号 1003131607）：歌单攒多了右端被硬切，看不出「后面还有」。
  ① **不加滚动条**（罐头拍板）：滚动条继续隐藏（`scrollbar-width:none` + `::-webkit-scrollbar{height:0}`），
     改在 `.list-tabs` 上**按需两侧渐隐**（`mask-image`，变量 `--tab-fade-l/r`，JS 依 scrollLeft 切
     `is-scroll-l` / `is-scroll-r`）—— 给的是「后面还有」的提示，不是滚动条。
  ② **切列表时当前项自动跟进来**：`ensureTabVisible()`（nearest 语义，只在激活项不可见时才滚），
     且**只在激活 id 真的变了时才滚**（`lastActiveTabId` 比对）—— 点心/移出等重渲染不抢用户手动滚的位置。
  ③ 鼠标竖滚轮映射为横滚（触控板/触摸本来就能横滑）；`ResizeObserver` 跟宿主改宽重算渐隐。
  断言：`list-tabs-overflow-fade` / `list-tabs-active-scrolls-into-view`（夹具 playlist 改成按 id 返回不同名，
  好造多个歌单撑溢）。
- 底栏左右翼均匀分布（2026-10-10，**已部署**，构建号 1003131608）：宽窗「两端各挤一坨」→
  左格 `space-between`（🔍·歌名·♡·⟳ 四项等距，歌名固定 160px）、右格 `flex-end` 成组（🔊—☰）；
  中格仍**只放**「⏮ ▶ ⏭」→ 播放键恒落正中。窄卡（`.cell{display:contents}` +
  `repeat(7,1fr)` + `justify-items:center`）按钮行展平 7 等分、队列收纯图标，play 也正中。
  ⚠️ 2026-10-10 起 **`.vol-group` 不再展平**（里面挂了音量浮层），见下方「音量：单按钮」一条。
  只动 `ui/style.css`（DOM 早就是三段式）；`ctl-play-centered-wide` / `ctl-endpoints-symmetric-wide` 未破。
  交接：`docs/player-ui/CONTROL-BAR-BRIEF.md`（给前端大师的底栏上下文）。
- 音量：单按钮 + 悬停向上弹竖条（2026-10-10，**已部署**，构建号 1003131609，罐头拍板）：
  旧「静音键 + 横滑条」（且滑条只在宽窗显示）→ **一颗按钮**：点 = 切静音，
  鼠标悬停（或键盘聚焦）**向上弹出竖向滑条**，移开即收。三种布局通用（窄卡/长卡同样弹）。
  ① 结构：`#vol` 从横条搬进 `.vol-pop`（`.vol-group` 的绝对定位子元素，父级加 `position:relative`）。
     `.vol-group::before` 是一道 12px 透明「连通悬停区」，补上按钮与浮层之间那 8px 空隙 ——
     否则指针上行时会 `pointerleave`、浮层中途收起。拖动滑条期间（`volDragging`）也不收。
  ② 竖条画法：**横向 `<input type=range>` 旋转 -90°**（`rotate(-90deg)`），轨道渐变
     「左→右 = 小→大」随之变成「下→上」，轨道/滑块样式直接复用 `.range` 那套，不另写。
     实测拖动映射正确（拖到 22% → `audio.volume` 0.22）。这条没碰音频链，与 `captureStream` 那套无关。
  ③ 皮跟现有浮层走（`--hk-surface` + `--hk-hairline` + `--hk-pop-shadow`，与 `.pop` 同款），
     动画：淡入 + 上浮 10px + `scale(.94)`，`cubic-bezier(.22,.61,.36,1)` 0.2s；
     reduced-motion 退为纯淡入。`z-index:25`（盖搜索页 22，压在队列 30/遮罩 28 之下）。
  ④ 窄卡 7 等分不受影响：`.vol-group` 仍算**一格**（只含按钮），只是不再 `display:contents`。
  ⑤ Esc 先收浮层（在搜索页/弹层之前）；`aria-expanded` 随开关同步。
  ⑥ **静音时滑条归零**、取消静音回原音量（构建号 1003131610，罐头反馈）：`renderVolume()` 里
     `shown = state.muted ? 0 : v` 只改**显示值**，`state.volume` 始终保留 → 取消静音原样回来，
     不必另存「上次音量」；拖动滑条仍走 `state.muted = state.volume === 0`。
  ⑦ **浮层 z-index 25 → 40**（构建号 1003131610，罐头反馈）：呼出歌单抽屉(30)时原会被盖住，
     现在压过抽屉(30)/遮罩(28)/搜索页(22)。（遮罩与抽屉只铺在 `.stage` 内，控制条在外，按钮一直够得着。）
  断言：`vol-pop-closed-by-default` / `vol-pop-opens-on-hover` / `vol-pop-above-queue` /
  `vol-vertical-drag-sets-volume` / `vol-click-mutes`（含滑条归零）/ `vol-unmute-restores-volume` /
  `vol-pop-closes-on-leave` / `vol-pop-opens-long` / `vol-pop-opens-compact`；
  自检新增 `vol-pop-hover-slider`（替换原 `control-visible:vol`）。
  交接：`docs/player-ui/REFINE-DONE-VOLUME.md`。
- 原始背景/根因/边界：`docs/REFACTOR-BRIEF.md`、`docs/player-ui/CONTRACT.md`、`docs/player-ui/WIRING.md`
- 待办：独立窗/小卡音频不中断（已加 pagehide/beacon 落盘 + 续播，**需真机拖拽复核**）；本地文件夹选择需真机点一次确认；环境色纱的厚度/深底字色/封面右缘淡出宽度**需真机看一眼**（见 REFINE-DONE-AMBIENT.md §五）。
  §五-3（底部渐隐）已改（第六轮）：**底部渐隐整个撤掉**（底边硬切，只留歌词那侧往左的淡入）；
  顶部圆角一并补上（14px），均待真机复核。

> 注：早期 `docs/REFACTOR-BRIEF.md` 里的「PV / 唱盘 / 主题面板」等要求已被 2026-10-08 的
> `CONTRACT.md` 取代，以极简版为准。

## 6. 视觉规范

**主题跟随宿主 Hana（`hana.theme`，快照 + 订阅），含夜间主题——别自己另起一套明暗。**
SDK 默认已把宿主主题样式表注入页面（`ui/sdk.js` 的 `followHostTheme`），
所以**别定义同名 `--bg/--text/--accent` 去盖宿主**。强调色只用在「当前 / 激活 / 强调」上。

两套皮别混：
- **卡片 / 文档**：Hana house-style —— 纸 `#F8F4ED` / 卡面 `#FFFDF7` / 墨 `#2A2622` /
  唯一强调色远山蓝 `#537D96`（`~/.hanako/recipes/hana-folio/references/house-style.md`）。
- **Hana App 界面（本 App 活在这里）**：深板岩 `#34424B` / 面 `#414D56` /
  强调藕荷粉 `#C99AAF` / 文字 `#E1EAF0`·`#9FB1BC`（小截图取色，权威以 `hana.theme` 为准）。

通用：小圆角约 5px；只 SVG 线描图标（禁 emoji）；字号 ≥ 11px；禁左竖线当区块装饰。

**顶部圆角自己补**（2026-10-09 定）：宿主**只在独立窗/浏览器视图**里把 App 面裁圆
（iframe 吃 `--radius-lg`），**聊天卡片里不裁** —— 所以 `.player` 自己补上两角：
`border-radius: 14px 14px 0 0`（只上两角，下两角交给宿主窗口/控制条）。
**14px 是罐头定的**：宿主转发给 App 的圆角 token 只有 `--radius-chat-card` /
`--radius-chat-card-inner`（8/6px），比卡片容器那道弧小一半，两道叠着看小那道像素步进外露，
真机上就是「粗糙」；14px 跟容器弧（约 16px）同量级又收一点。
宿主自己裁得更紧时它的 clip 会盖住我们，不打架。
（宿主另有 `--corner-radius-scale`，圆角偏好倍数、默认 1；想跟随就写 `calc(14px * var(--corner-radius-scale, 1))`。）
角上露出的颜色由 `.frame` 的背景给（必须是卡面色 `--hk-surface`；用页面色 `--hk-bg` 会露出一块深一号的补丁）。

**决策（已定）**：自带配色面板已砍，主题**只跟随宿主**（决策 A，删改清单见
`docs/REFACTOR-BRIEF.md` §4.2）。
