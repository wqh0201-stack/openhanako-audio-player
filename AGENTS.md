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
4. 重载 app。

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
  下一曲仍随机（罐头要的手感）。栈随 playback-state 快照落盘。**未部署**，
  交接见 `docs/player-ui/SHUFFLE-PREV.md`（只有 `ui/app.js` 一个文件）。
- 原始背景/根因/边界：`docs/REFACTOR-BRIEF.md`、`docs/player-ui/CONTRACT.md`、`docs/player-ui/WIRING.md`
- 第六轮（舞台底部渐隐重做 + 顶部圆角，2026-10-09 罐头拍板）：
  ① `.scene::after` 从「固定 72px 刷主题面色」改成「按舞台高比例 `clamp(36px, 9%, 72px)`、化进 `--ambient-color`」，
     `z-index:1` 只化封面不盖歌词；底边到控制条**硬切**（试过最底补 18px 羽化，真机判为不行，已撤）。
  ② `.player` 顶部两角自己补圆角（`14px 14px 0 0`，只上两角）—— 宿主只裁独立窗，
     卡片不裁；`.frame` 底色改 `--hk-surface`，让角上露出卡面色而不是页面色。
  断言 `bottom-blend-dissolves-into-ambient` / `top-corners-rounded` / `corner-reveals-card-surface`（59/59）。
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
- 无头验收：`node tools/verify-ui.mjs`（12/12 布局自检 + 4/4 窄卡 + 65/65 断言 + 接线冒烟 + 迁移 + 跨文档生命周期 + 来源/真名/补齐/删除 + 红心/我的喜欢 + 环境色两态/兜底 + 动效五项）；`node tools/verify-backend.mjs`（去重键 / DELETE / playback-state / playlist-meta，10/10）
- 待办：独立窗/小卡音频不中断（已加 pagehide/beacon 落盘 + 续播，**需真机拖拽复核**）；本地文件夹选择需真机点一次确认；环境色纱的厚度/深底字色/封面右缘淡出宽度**需真机看一眼**（见 REFINE-DONE-AMBIENT.md §五）。
  §五-3（底部 72px 渐隐）已改（第六轮）：化进环境色 + 硬切底边；顶部圆角一并补上，均待真机复核。

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
