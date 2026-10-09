# 极简播放器 · 第二轮：四项拍板 + 拖拽生命周期修复（完成记录）

> 2026-10-09 执行 `docs/player-ui/REFINE-BRIEF-LISTS-2.md`。
> 工作树 `/Volumes/SSD/hanadesk/hanako-audio-player-lists`，分支 `hana-simple-lists`。
> **未部署、未 reload、未动主工作树 / 安装目录 / app-data**。

---

## 一、四个拍板怎么落的

### 1. 单曲链接 → 归当前页

`resolveImportTarget(nameIfLocal)`：当前激活列表是导入列表（`imp:*`）就直接并进去；
当前页是**本地列表**时（本地严格等于文件夹，塞不进去）新建/复用**同名**导入列表，
并切过去。单曲用名「单曲」，本地文件用名「本地文件」（复用已存在的同名列表，避免越建越多）。

### 2. 本地列表 = 严格等于固定文件夹

- `syncLocalFolder()` 从「并入」改成**替换**：先拿掉全部 `list:"local"` 曲目，再放入本次扫描结果。
- 扫描失败时**不动**已存内容（不误删）。
- 手动导单个本地文件**不再进本地列表**（走第 1 条，归当前导入列表 / 新建「本地文件」列表）。
- 迁移也跟着改：旧数据里 `mode:"本地"` 不再进 `local`，一律按 `group` 各成一个导入列表
  （真实 203 条全是「在线」，不受影响；本地列表默认空，等用户选文件夹）。

### 3. 歌单名可自定义

- 自动命名：导入歌单 → `歌单 N`；单曲/本地文件兜底列表 → `单曲` / `本地文件`；
  迁移 → 用原 `group` 名；元数据丢失时退化为 `歌单 N`（不再显示 `imp:1`）。
- 重命名入口：队列头（`#queueTitle`）右侧的**小铅笔**（`#renameBtn`，仅导入列表可见）；
  也支持**双击当前切换项**。点开后**内联输入**（`#listNameInput`）替换标题，回车/失焦提交、
  Esc 取消。**无模态弹窗**。提交后写 `player-lists`，标题与 tab 的 `title` 同步更新。
- 本地列表名固定「本地」，不可改名。

### 4. 文件夹不做实时监听

保持现状：只在「选文件夹时 / 开机时（已设过）/ 点重新扫描」扫。没加打开即扫、没加 watcher。

## 二、生命周期修复（拖进/拖出丢播放状态）

### 存储：改用后端路由 + sendBeacon（不再依赖 hana.storage 落盘）

`hana.storage.global.set` 是异步 IPC，页面卸载时可能来不及发。所以播放状态改为：

- **新增后端路由** `GET/POST /api/playback-state`（`lib/register-routes.js`），落 `app-data/playback.json`。
- 常规写入：节流 `POST`（`persistNow` / `persistState`），切歌/暂停/导入/删除立即写。
- **卸载落盘**：`beaconPlayback()` 用 `navigator.sendBeacon`（首选，`application/json` Blob），
  失败退 `fetch(..., {keepalive:true})`。票走 query（`withSession` 口径），跨文档可靠。
- 歌单元数据与本地文件夹路径**仍走 hana.storage.global**（不涉及卸载竞速）。

### 钩子

```js
window.addEventListener('pagehide', flushOnTeardown);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushOnTeardown();
  else unloading = false;      // 只是被隐藏又回来
});
window.addEventListener('pageshow', () => { unloading = false; });  // bfcache 恢复
```

`flushOnTeardown()` 每次**都**落一份完整快照（不做「只落一次」的锁——重复落同一份无害，漏落才丢状态）。

### 防误伤：pause 守卫写在哪

`unloading` 标志。`pagehide` / 隐藏时置 `true`；audio 元素销毁补发的 `pause` 在
`audio.addEventListener('pause', ...)` 里被 `if (unloading) return;` 挡住，**不写回 `playing=false`**。
可见/`pageshow` 时复位。这样新文档读到的一定是真实的 `playing:true`。

### 新文档恢复 + 自动续播 + 被拦不归零

- 恢复：`restorePlayback` 读回快照 → 设 `currentUid / progress / playing` → 自动 `play()`。
- **进度落地**：`loadedmetadata` 时媒体往往还不可 seek（`seekable=[0,0]`），直接赋 `currentTime`
  会被忽略。改为 `applyPendingSeek()` 挂到 `loadedmetadata/loadeddata/canplay/progress` 多个事件，
  外加一个 150ms×20 的短重试定时器，等 `seekable.end(0) >= 目标` 再落。**这是续播能接上位置的关键。**
- **被拦不归零**：`onAutoplayBlocked` 保留进度与暂停态，显示轻量「继续播放」胶囊（`#resumeBtn`），
  点击即 `play()`；播放一开始自动隐藏。不再 toast 完就停死。

## 三、改了哪些文件

| 文件 | 改动 |
|---|---|
| `ui/app.js` | `resolveImportTarget`、本地替换语义、重命名、`pagehide`/`visibilitychange` 钩子、beacon 落盘、pause 守卫、`applyPendingSeek`、`#resumeBtn` |
| `ui/index.html` / `ui/standalone.html` | `#queueTitle`、`#renameBtn`（铅笔）、`#resumeBtn`、`i-pencil` 图标；两文件仍只差 `<body data-shell>` 一行 |
| `ui/style.css` | `.resume-chip`、`.list-name-input` |
| `lib/register-routes.js` | 新增 `GET/POST /api/playback-state` |
| `tools/verify-ui.mjs` | 假音频改 Range 可 seek；新增重命名、跨文档 pagehide→reload、被拦续播断言 |
| `tools/verify-backend.mjs` | 新增 playback-state 往返 + 非法拒绝 |
| `ui/_build.json` + 两 html | `bump-build`：`1003131546 → 1003131547` |

`id`/`data-*` 全保留；`appSurfaceSession` 鉴权层未动。

## 四、验收

```sh
node tools/verify-ui.mjs        # 12/12 布局自检 + 接线冒烟 + 迁移 + 生命周期，全绿，exit 0
node tools/verify-backend.mjs   # 7/7（去重键 / DELETE / playback-state）
```

新增断言（全通过）：

- **重命名**：铅笔 → 内联输入出现 → 回车提交 → 队列头与 tab title 都变成新名。
- **跨文档**：播第一首 → 派发 `pagehide` → 轮询确认快照落盘（`playing:true` + 进度）→
  `reload` → 标题/激活列表恢复、**自动续播**（`data-playing=1`）、且 `currentTime >= 落盘进度`
  （证明进度真的接上了）。
- **被拦续播**：播种 `progress:12 / playing:true`，stub `play()` 拒绝 → 进度保留（`curTime 0:12`）、
  暂停态、`#resumeBtn` 出现。
- 本地页严格等于文件夹（选文件夹后 3 首、替换语义）；单曲归当前列表；迁移 `本地,1,2,3,4`。

截图：`/tmp/hap-verify/`（`resume-chip`、`rename`、`migrated`、`list-*`、六尺寸×浅深、`darkfallback`）。

## 五、真机需要罐头确认的点

1. **拖进/拖出连续性**：从卡片拖成独立窗、再拖回来，听是否不中断、位置是否接上。
   若仍中断，说明宿主对 iframe 的销毁顺序与 `pagehide` 时机与假设不同，需要抓一次真实日志。
2. **自动播放**：真机上续播若被自动播放策略拦，「继续播放」胶囊是否出现、点一下是否恢复。
3. **本地文件夹**：真机选一次文件夹，确认路径拿取与扫描（无头环境是 stub 验的）。
4. **重命名手感**：铅笔/双击入口是否符合预期；内联输入宽度（当前 150px）够不够。

## 六、备注

- `app-data/playback.json` 是新文件（后端首次写入时创建）；旧的 `hana.storage` 里的
  `player-playback-state` 不再读，属正常弃用。
- 生命周期改动只影响播放状态；歌单与本地文件夹仍走 hana.storage，不受影响。
