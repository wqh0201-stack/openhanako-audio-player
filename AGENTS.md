# AGENTS.md · hanako-audio-player

这是 **Hana v2 App「音频播放器」** 的源码仓库。
**这不是宿主安装目录**——安装目录是 `~/.hanako/apps/hanako-audio-player/`，那是部署目标
（宿主会把它快照进 `.cache/app-ui-snapshots/`），别把它当工作区。

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
   是宿主控件安全区（别放文字/控件）；最外层容器保持**直角**，不加外圆角/外描边/
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
- 原始背景/根因/边界：`docs/REFACTOR-BRIEF.md`、`docs/player-ui/CONTRACT.md`、`docs/player-ui/WIRING.md`
- 无头验收：`node tools/verify-ui.mjs`（12/12 布局自检 + 4/4 窄卡 + 32/32 断言 + 接线冒烟 + 迁移 + 跨文档生命周期 + 来源/真名/补齐/删除）；`node tools/verify-backend.mjs`（去重键 / DELETE / playback-state / playlist-meta，10/10）
- 待办：独立窗/小卡音频不中断（已加 pagehide/beacon 落盘 + 续播，**需真机拖拽复核**）；本地文件夹选择需真机点一次确认。

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

**决策（已定）**：自带配色面板已砍，主题**只跟随宿主**（决策 A，删改清单见
`docs/REFACTOR-BRIEF.md` §4.2）。
