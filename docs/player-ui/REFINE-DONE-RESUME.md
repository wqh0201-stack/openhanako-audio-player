# 拖进/拖出「播放不割裂」修复（REFINE-DONE-RESUME）

2026-10-10。构建号 1003131613。改动只落在 `ui/app.js`（+ `tools/verify-ui.mjs` 一条新断言）。

## 罐头报的 bug

> 作为独立窗口时播放 B站歌曲，再把它作为卡片贴进 HANA 主界面，切换会让播放停止，
> 且播放别的歌，且不会出现在最近播放里；切网易云音源会从头开始播放，歌还在。

两个症状，两条不同的根因。

## 机制前提：拖进/拖出 = 整份文档被换掉

宿主对一张卡声明 `detached.route` 后，**每个窗口文档都是全新 iframe**（SKILL/APPS 原文：
"each window document creates a fresh iframe"）。停靠（卡片 `/index.html`）与拆出
（独立窗 `/standalone.html`）互切时，旧文档整个销毁、新文档从零 boot。

所以「维持播放」唯一可行的做法是：**旧文档在 `pagehide` 把完整快照交给宿主
（sendBeacon / keepalive，跨文档可靠），新文档 boot 时读回来续播**。现有实现已走这条路
（快照落 `app-data/playback.json`），但快照只带了 `currentId`（`list|id`），**歌本身还得靠
`playlist.json` 去认领**。bug 就出在这条"认领"上。

## 根因一：B站歌"丢歌 + 不进最近播放"

**`playTrack` 换曲时不落盘 playlist，只落 playback-state。**

链路：
- 搜索页点行 → `playSearchHit()` 把曲目 push 进 `state.tracks`（list=`recent`）→ `playTrack()`。
- `playTrack()` 只调 `persistNow()`（写 playback.json），**不调 `savePlaylist()`**；
  `recordRecent()` 也只改内存、不落盘。
- 那 playlist.json 什么时候才写？过去只有一条**偶然**路径：`loadedmetadata` 里
  「`t.dur` 还是 0 → 记时长 → 1.5s 后 `savePlaylist()`」。
- **网易云（Meting）搜索结果的 `dur` 字段被 `normalizeTrack` 丢掉了 → dur=0 → 触发那次落盘 → 歌被持久化。**
- **B站的 `dur` 在搜索结果里就有（视频时长，见 `lib/bilibili.js` 的 `parseDuration`）→ dur>0 → 不触发 → 歌永远不落盘。**

于是拖走瞬间：playback.json 里 `currentId = recent|bilibili:BV…`，但 playlist.json 里
根本没有这条 → 新文档 `trackByUid` 找不到、裸 id 回退也找不到 → 落到
`visibleTracks()[0]`（当时 `activeList='fav'`）→ **播放了另一首（我的喜欢第一首）**，
且"最近播放"里没有它。B站与网易云的分野正是这里。

### 修法
1. **快照带上整条曲目**：`snapshot()` 新增 `currentTrack: toStoredTrack(currentTrack())`。
   新文档 `restorePlayback()` 在 uid/裸 id 都找不到时，用快照里这条**直接重建**并塞回原列表
   （缺失退回 recent/local），顺手 `savePlaylist()`。歌不再依赖盘上的 playlist 够不够新。
2. **换曲即落盘**：`playTrack()` 里 `changed` 时补 `savePlaylist()`，最近播放/当前曲目当场持久化。

## 根因二：网易云"歌还在，但从头开始"

两条小问题叠加：

1. **续播落点被自己冲掉**：新文档起播后第一个 `timeupdate`（`currentTime≈0`）会把
   `state.progress` 记成 0 并 `persistState()`，把刚落盘的位置覆盖掉。
2. **落点窗口太短**：`scheduleSeekRetry` 只重试 20×150ms=3s；分片代理的媒体在
   `loadedmetadata` 时往往还不可 seek，3s 内没等到就放弃了。

### 修法
- `timeupdate` 里加护栏：`pendingSeek > 0` 时**不更新 `state.progress`**（落点到位或放弃后自动恢复）。
- 重试窗口 3s → 9s（60×150ms）；放弃时清 `pendingSeek` 并重渲进度，避免进度条永久冻死。
- 快照的 `playing` 加了兜底：卸载时若"刚还在播"（`lastPlayingAt` < 1.2s），即便 audio 已被迫
  `pause` 也仍算在播 —— 防 `pause` 抢在 `pagehide` 前把 `playing=false` 写回、导致新文档永不续播。

## 验收

- `node tools/verify-ui.mjs` → **106/106 断言**、12/12 布局、4/4 窄卡、零运行时错误。
- 新增断言 `lifecycle.snapshotTrackOk`：播种一个"当前曲目不在 playlist.json 里"的快照
  （`currentId=recent|netease:777777` + 快照自带 `currentTrack`），新文档必须
  **恢复成同一首**（标题=孤儿曲目、activeList=recent、队列里有它、进度 ≥4.5s），
  而不是回退到列表第一首。改前必红、改后必绿。
- 既有 `lifecycle.crossOk`（在列表里的曲目 pagehide→reload 续播）不回归。

## 边界 / 待真机复核

- 宿主如果**不派发 `pagehide`/`visibilitychange`** 就销毁 iframe（各宿主实现细节不同），
  快照可能漏落。本轮没动这条通路，真机拖拽仍需复核一次。
- 反向（卡片 → 独立窗）走同一套代码，一并受益。
- `currentTrack` 进快照会让 playback.json 稍大（一条曲目量级），无碍。
