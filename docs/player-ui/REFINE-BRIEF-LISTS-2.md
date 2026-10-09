# 歌单重构 · 第二轮：罐头拍板 + 拖拽生命周期修复

> 承 `REFINE-BRIEF-LISTS.md`。罐头已对四个待定项拍板，并报了一个**真机 bug**。

## 一、四个拍板结论（改掉第一轮的暂定行为）

1. **导入单个「单曲」链接 → 归到当前页**（当前选中的那个列表）。落到 app.js 里就是：把新曲目并入
   **当前激活列表**。**注意与第 2 条冲突的边界**：本地列表现在是「严格等于固定文件夹」（见下），
   所以当**当前页是本地列表**时，单曲不能塞进本地 —— 此时退化为新建/复用一个导入列表（名「单曲」）。
2. **本地列表 = 严格等于那个固定文件夹**。去掉「固定文件夹扫描结果 ∪ 手动导入的本地文件」的并集语义，
   本地页只显示那个文件夹里的东西（选文件夹时是**替换**不是并入）。手动导单个本地文件时，不要再往本地列表里塞
   （按第 1 条同理归到当前导入列表，或明确不支持，你选一个更干净的）。
3. **导入歌单名可自定义**。列表名允许用户改（先给「导入后自动命名 歌单 N / 单曲 N」，再让用户能重命名）。
   重命名入口放哪你定（建议：列表切换条上的当前项，长按/右键/小铅笔 → 内联输入；或队列头那行）。改完持久化到
   `player-lists`。**别引入模态弹窗**，用内联编辑或轻量浮层，符合现有设计语言。
4. **文件夹不做实时监听**。保持现状：只在「选文件夹时 / 开机时 / 点重新扫描」扫。**不要**改成打开即扫。

## 二、真机 bug：拖进/拖出 Hana 会重启播放器，正在播的状态丢掉

### 现象
用户把播放器卡片**从单独窗口拖进 Hana 主窗、或从 Hana 拖出去**时，播放状态归零（停止播放）。

### 根因（已定位，你复核）
`manifest.json` 给同一张卡声明了**两个文档**：
- `route: "/index.html"` → 停靠态（Hana 里的卡片）
- `detached.route: "/standalone.html"` → 拖出去的独立窗口

**停靠 / 拖出 = 整份文档被换掉**（host 会为每个窗口文档创建一个全新 iframe，这是平台既定行为，不是 bug）。
`<audio>` 元素随旧文档销毁，新文档从零 rehydrate。而 app.js 现在：
- **没有任何 teardown 落盘钩子**（无 `pagehide` / `visibilitychange`）。进度靠 `timeupdate` 的 900ms
  节流写，最后不到 1 秒的进度和「正在播放」标志可能根本没写进去。
- 新文档 `boot()` 里 `restorePlayback(pb)` 即使读到 `playing:true`，也依赖 `audio.play()` 成功；
  若被自动播放策略拦下 → `onAutoplayBlocked` → `toast('需要点击播放')` → 用户看到「停了」。

### 要求
1. **teardown 必须落盘**：加 `pagehide`（和 `visibilitychange → hidden`）钩子，**立即**写一份完整快照
   （currentId / progress / playing / volume / muted / mode / lyrics）。
   - 关键：`hana.storage.global.set` 是**异步**的，`pagehide` 时可能来不及回 IPC。请实测；
     若不可靠，改用**后端路由 + `navigator.sendBeacon`**（或 `fetch(..., {keepalive:true})`）——
     这是专为卸载时发一次请求设计的，能跨文档存活。带 `appSurfaceSession` 走 query 参数（GET/POST 一致口径见现有 `withSession`）。
2. **新文档恢复要无缝**：
   - 恢复进度并**自动续播**（若原状态是 playing）。
   - 自动播放被拦时**不要归零**：保留进度与「暂停」态，给一个轻量的「继续播放」引导（可点一下恢复），
     而不是 toast 完就停死。
   - **防误伤**：拖拽/卸载时 audio 元素销毁可能触发 `pause` 事件 → 现有 `pause` 处理器设 `state.playing=false`。
     要保证这个「被卸载逼出来的暂停」**不会把 playing=false 写回去**（否则新文档读到 false 就永不续播）。
     用「teardown 期间加锁 / 只认用户手势触发的暂停」之类的方式区分。
3. **验证**：
   - `verify-ui.mjs` 加断言：模拟 `pagehide` → 断言快照被落盘（fake backend 收到）；再 reload → 断言
     `title/进度/播放态` 恢复、且续播被尝试。
   - 用假后端跑通「旧文档 pagehide → 新文档 boot」的**跨文档**链路。
   - 真机（罐头来验）：从卡片拖出/拖回，听是否连续；位置是否接上。

## 三、硬约束（不变）
- 只在**你的独立工作树** `/Volumes/SSD/hanadesk/hanako-audio-player-lists`（分支 `hana-simple-lists`）里改，
  **不要**碰主工作树 / 安装目录 / `app-data/` / 不部署 / 不 reload。
- `ui/index.html` 与 `ui/standalone.html` 保持同步（只差 `<body data-shell>` 一行）—— 尤其这次动了生命周期，
  两个文档都要装钩子。
- 保留 app.js 依赖的所有 `id`/`data-*`；单文件无构建；SVG 线描图标；字号 ≥11px；不用 `position:fixed`；
  右上 100×40 留空；ES5 风格；**别动 `appSurfaceSession` 鉴权层**。
- 后端若加「播放状态」路由，注意鉴权与 `lib/register-routes.js` 现有风格一致。

## 四、交回
- 四个拍板项各自怎么落的（尤其单曲→本地页的边界、重命名入口）。
- 生命周期修复：最终用 storage 还是 beacon、防误伤怎么做的、`pause` 守卫写在哪。
- `verify-ui.mjs` / `verify-backend.mjs` 结果 + 关键截图。
- 真机上需要罐头确认的点。
