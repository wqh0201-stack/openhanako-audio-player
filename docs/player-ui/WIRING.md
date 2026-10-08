# 极简播放器 · 后端接线表（WIRING）

> 依据：`docs/player-ui/CONTRACT.md`「记忆与音频所有权」+ `lib/register-routes.js`（全部路由）
> + `lib/state.js`、`lib/meting.js`、`lib/register-tools.js`、`tools/play.js`、`tools/list-music.js`。
> 2026-10-08 产出。**只读文档，不改任何代码。**

本表把极简播放器每一个操作映射到**已存在的后端路由**，给可复制粘贴的 URL 模板，并标出
【够用】/【缺口】。缺口一律写「需新增」，不靠改代码补。

---

## 0. 三个必须先记住的前提

### 0.1 URL 前缀

```
/api/apps/hanako-audio-player/routes
```
`hanako-audio-player` 就是 `manifest.json` 里的 `id`（不是 `hanako-audio-player-simple`；
后者只是工作目录名）。后端 `appId` 取自 `path.basename(ctx.dataDir)`，运行时也应是这个 id。
下面所有模板的前提常量：

```js
const API = "/api/apps/hanako-audio-player/routes";
```

### 0.2 两族端点，路径**故意不同名**

`register-routes.js` 顶部注释已说明：从 v1 移植的旧 UI 把接口拼成 `${API}/widget/api/...`，
所以后端必须同时提供 `/widget/api/...` 路径，否则前端二十多处调用全 404。
**`/widget/api/...` 不是笔误。** 新增端点走 `/api/...` 更清爽，已被旧 UI 引用的一批保持原路径。

- 旧 UI 复用族：`/widget/api/...`、`/widget/media/...`
- 新端点族：`/api/state`、`/api/select`、`/api/lyric-line`、`/api/lyric-hide`、
  `/api/session-status`、`/api/now-playing`、`/api/_probe/*`

### 0.3 两类「曲目对象」，字段名不同

| 来源 | 形状 |
|---|---|
| `playlist.json` / UI 列表（**本地存储形状**） | `{ name, url, mode, dur, group }`，mode 取 `"本地"`/`"在线"` |
| Meting 归一化（**search / song / playlist 返回形状**） | `{ id, title, author, url, pic, lrc }` |

`search`/`song`/`playlist` 三族**不返回** `name`/`mode`/`dur`/`group`。
UI 把在线结果入列表时必须自己映射：`name←title`、`author` 另存、`mode="在线"`、
`group="在线音乐"`、`dur=0`。**这是接线时要写的第一段适配代码，不是缺口、但容易漏。**

### 0.4 音频不走 fetch，直接给 `<audio src>`

`search`/`song`/`playlist` 返回的 `url` 是**已带完整前缀的绝对路径**：
`/api/apps/hanako-audio-player/routes/widget/api/music/go/<id>?server=...`，
本地曲目是 `/api/apps/hanako-audio-player/routes/widget/media/<文件名>`。
两者**直接喂 `<audio src>`**，后端 302/流式响应，不吃 CORS。**不要用 fetch 拉它再转 blob。**

---

## 1. 启动恢复

| 要恢复的东西 | 端点 | 状态 |
|---|---|---|
| 播放列表 | `GET /widget/api/playlist` | 【够用】 |
| 当前曲目 + 队列（工具侧状态） | `GET /api/state` | 【部分】 |
| 当前曲目 ID / 进度 / 音量 / 静音 / 模式 / 歌词开关 / 上次是否在播 | 无端点 | 【缺口】 |

```js
// 列表（含启动首屏）
GET {API}/widget/api/playlist
// → 200 { ok:true, tracks:[{name,url,mode,dur,group}], count:N }
// 空仓库时后端会扫 app-data/media 自动生成初始列表并落盘，首次调用即有内容。

// 工具侧状态（当前曲目 + 队列）
GET {API}/api/state
// → 200 { ok:true, data:{ track:{...}|null, queue:[...] } }
// 数据源是 ctx.storage.global 的 "player-state" 键，由 audio_play / 音频工具驱动，
// 与 playlist.json 是两份东西（见 §9）。
```

**缺口 1 —— 播放状态无持久化端点。**
`progress / volume / muted / mode / lyricsVisible / lastPlaying / currentTrackId`
在 `register-routes.js` 与 `state.js` 里**均无任何读写入口**（已 grep 确认：全仓无
`volume|mute|progress|playMode|currentTime|lyricsVisible|lastPlaying` 命中）。
契约要求这些全部持久化。两条路，二选一：

- **路线 A（推荐，最少新代码）**：UI 侧走 SDK 公开存储
  `hana.storage.set/get(key, value)`（`ui/sdk.js` 已暴露，`hana.storage.global` 为 App 级 scope），
  一个键 `player-playback-state` 存整块 JSON。**不写 localStorage**（契约硬要求）。
- **路线 B**：新增后端端点 `GET/POST /api/playback-state`，落 `app-data/playback.json`。

无论哪条，**恢复顺序**按契约：先读状态 → 恢复列表与当前曲目 → 等 `audio` 的
`loadedmetadata` 拿到 `duration` 后**把进度夹到有效时长**再 `currentTime`；上次是暂停就保持暂停。
`/api/state` 的 `track` 只能给「哪首」，给不了「播到第几秒」——别拿它当进度来源。

---

## 2. 播放列表 / 选曲 / 播放暂停 / 上下一首

| 操作 | 端点 | 状态 |
|---|---|---|
| 加载列表 | `GET /widget/api/playlist` | 【够用】 |
| 选曲（服务端记账） | `POST /api/select` | 【够用】 |
| 上报当前曲目（横幅同步） | `POST /api/now-playing` | 【够用】 |
| 播放/暂停 | —（纯前端 `audio.play()/pause()`） | 【不需后端】 |
| 上一首 / 下一首 | —（纯前端算 index） | 【不需后端】 |
| 列表顺序变更持久化 | `POST /widget/api/playlist` | 【够用】 |

```js
// 选曲：后端只把 state.track 指到第 index 首（1-based？不，0-based）
POST {API}/api/select
Content-Type: application/json
{ "index": 3 }
// → 200 { ok:true, data:{...track} } | 400 invalid index | 404 out of range

// 上报当前曲目（让歌词横幅歌名不落后一拍）
POST {API}/api/now-playing
{ "title": "歌名", "source": "本地" }
// → 200 { ok:true }

// 顺序变更 / 增删后整体覆盖写
POST {API}/widget/api/playlist
{ "tracks": [ {name,url,mode,dur,group}, ... ] }
// → 200 { ok:true, count:N } | 400 invalid tracks
```

播放/暂停、上一首/下一首**没有也不需要后端端点**——进度条由 `timeupdate` 驱动。
但切歌/暂停是契约里的「边界」，**必须立即持久化**（见 §9），所以每次切歌要顺手写一次
playback-state（§1 路线 A/B），并对在线曲目可选调 `POST /api/now-playing` 同步横幅。

---

## 3. 进度 seek / 音量 / 静音

纯前端 `audio.currentTime` / `audio.volume` / `audio.muted`。**无后端端点，也不需要。**

要点：
- seek 到后端没有任何对应写口；完成后把新进度写入 §1 的 playback-state。
- 音量/静音同理，变化后**节流**写 playback-state（契约：写入节流并串行）。
- 【缺口】若走路线 B（后端 playback-state），需新增 `POST /api/playback-state`；
  走路线 A 则本项无缺口。

---

## 4. 播放模式（列表循环 / 单曲循环 / 随机）

纯前端状态机（一个按钮循环切）。**无端点。**

- 持久化同一个 playback-state（字段建议 `mode: "list" | "one" | "shuffle"`）。
- 旧 UI 用 `localStorage['hanako_audio_mode']` 存了个 0–3 数字；**新实现不要沿用**
  （契约禁止视图写 localStorage，且旧值 3 种模式以上，与本契约 3 种不对齐）。
- 【缺口】同 §1：模式要跨重启，就得有 playback-state 的读写口。

---

## 5. 歌词：显隐 + 获取

| 操作 | 端点 | 状态 |
|---|---|---|
| 显隐开关 | —（纯前端类切换） | 【不需后端】 |
| 在线歌词（行级 LRC，`text/plain`） | `GET /widget/api/music/lrc` | 【够用】 |
| 歌词文件 URL 代理（`text/plain`） | `GET /widget/api/music/lrc-proxy` | 【够用】 |
| 离线歌词库读 | `GET /widget/api/lrc/load` | 【够用】 |
| 离线歌词库写（缓存） | `POST /widget/api/lrc/save` | 【够用】 |
| 逐字歌词 TTML | `GET /widget/api/music/ttml` | 【够用】 |

```js
// 行级 LRC：注意必须用 r.text()，不是 r.json()
GET {API}/widget/api/music/lrc?id=<歌曲id>&server=netease
// → 200 text/plain;charset=utf-8  （LRC 原文）
// → 502 text/plain  lyric fetch failed: ...

// 歌词文件 URL 代理（拿到的是 lrc 文件地址而非 id 时）
GET {API}/widget/api/music/lrc-proxy?url=<encodeURIComponent(lrcUrl)>
// → 200 text/plain 原文 | 400 | 502

// 离线歌词库：读（按曲名，安全化后存 app-data/lyrics/<曲名>.lrc）
GET {API}/widget/api/lrc/load?name=<encodeURIComponent(曲名)>
// → 200 { ok:true, lrc, filename } | 400 | 404 { ok:false, error:"not found" }

// 离线歌词库：写（在线歌词拿到后顺手缓存）
POST {API}/widget/api/lrc/save
{ "name": "曲名", "lrc": "[00:00.00]..." }
// → 200 { ok:true, filename } | 400 name & lrc required

// 逐字歌词（AMLL TTML DB）
GET {API}/widget/api/music/ttml?id=<歌曲id>&platform=ncm|qq
// → 200 application/ttml+xml | 404 "not in amll-db"（库里没有→前端退回行级 LRC）| 400 | 502
```

接线顺序（照抄旧 UI 已验证的降级链）：
1. 先 `lrc/load`（离线库命中就零网络）；
2. 未命中 → `music/lrc?id=...`（拿到原文后 `lrc/save` 缓存）；
3. 拿到的是 URL 不是 id → `music/lrc-proxy?url=...`；
4. 想要逐字 → `music/ttml?id=...&platform=ncm`，404 就退回行级 LRC。

歌词显隐**只是壳的类切换**：隐藏时关掉正文与文字用渐变蒙层（契约），不调后端。
「自动跟随 / 回到当前歌词」也是纯前端。

---

## 6. 导入

| 导入类型 | 端点 | 状态 |
|---|---|---|
| 本地单文件 | `GET /widget/api/import-file` | 【够用】 |
| 本地文件夹 | `GET /widget/api/scan-folder` | 【够用】 |
| 在线单曲链接 | `GET /widget/api/music/song` | 【够用】 |
| 在线歌单链接 | `GET /widget/api/music/playlist` | 【够用】 |
| 在线搜索（按关键词挑歌） | `GET /widget/api/music/search` | 【够用】 |
| 去重（按稳定标识） | 无 | 【缺口】 |

```js
// 本地单文件（path 为磁盘绝对路径，后端经 ctx.resources 复制进 app-data/media）
GET {API}/widget/api/import-file?path=<encodeURIComponent(absPath)>
// → 200 { ok:true, name:"歌名", url:"/api/apps/hanako-audio-player/routes/widget/media/xx.mp3", mode:"本地" }
// → 400 不支持格式 / 不是文件

// 本地文件夹（含子目录，限深 3，单次上限 200 个）
GET {API}/widget/api/scan-folder?path=<encodeURIComponent(dirPath)>
// → 200 { ok:true, files:[{name,url,mode}], count:N } | 400 不是目录

// 在线单曲（直接贴链接会自动抠 id：…/song?id=347230 → 347230）
GET {API}/widget/api/music/song?id=<id 或 完整链接>&server=netease
// → 200 { ok:true, track:{id,title,author,url,pic,lrc}, host }
//   注意 url 已被换成 go 跳板地址；track 是 Meting 形状（title/author），需映射成 name/mode

// 在线歌单（Meting type=playlist）
GET {API}/widget/api/music/playlist?id=<歌单id>&server=netease
// → 200 { ok:true, tracks:[{id,title,author,url,pic,lrc}], host }

// 在线搜索
GET {API}/widget/api/music/search?keyword=<kw>&server=netease&limit=30
// → 200 { ok:true, results:[{id,title,author,url,pic,lrc}], host, total }
```

`server` 取值限 `netease|tencent|kugou|baidu|kuwo`（`meting.js` 的 `ALLOWED_SERVERS`），
非法值返回 400。

**缺口 2 —— 去重与稳定 ID。**
契约要求「导入项按**稳定标识**去重，不仅按 URL 去 query 后的值去重」，且要持久化
「曲目**稳定 ID**与本地/在线类别」。现状：

- `playlist.json` 的曲目对象**没有 `id` 字段**（只有 `name/url/mode/dur/group`）。
- 旧 UI 的去重就是 `url.split('?')[0]`——正是契约点名要修掉的坑（后端已用
  `music/go/:id` 跳板把 id 放进 path 缓解，但那是**缓解**，不是稳定 ID 字段）。
- 后端 `POST /widget/api/playlist` 是**整体覆盖**，不做服务端去重。

需新增：**导入端点返回并入列表时落一个稳定 `id`**（在线 = Meting `id`；本地 = 文件名/内容哈希），
并提供一个「按稳定 id 去重后追加」的服务端入口（或由 UI 统一去重后覆盖 POST）。
当前 `search/song/playlist` 的 `id` 字段是可用的稳定标识来源，**前端映射时要保留它**。

另外：`copyIntoMedia` 已存在即直接返回（同文件名视为同一文件），但**不比对内容**——
换内容同名文件会被当已存在跳过，这是个已存在的坑，接线时知道即可。

---

## 7. 删除曲目

| 操作 | 端点 | 状态 |
|---|---|---|
| 从列表移除 | `POST /widget/api/playlist`（覆盖式） | 【部分】 |
| 删除 media 里的音频文件 | 无 | 【缺口】 |
| 删除该曲的离线歌词 | 无 | 【缺口】 |

现状只有整体覆盖写：UI 从数组里删掉那首，再把新数组 POST 上去。

```js
// 删除 = 本地数组过滤后整体覆盖
POST {API}/widget/api/playlist
{ "tracks": [ ...剩余曲目 ] }
```

**缺口 3 —— 没有 DELETE 路由。**
`register-routes.js` 里只有 `app.get` / `app.post`，**无 `app.delete`**（已 grep 确认）。
可选新增 `DELETE /api/track?id=...`：既改 `playlist.json`，又清理
`app-data/media/<file>` 与对应 `app-data/lyrics/<曲名>.lrc`，避免孤儿文件。
不做清理也能跑（覆盖写即满足契约「从列表移除」），但 `media/` 会越堆越大。
契约要求删除放在「曲目更多菜单」里，是 UI 细节，不影响端点选择。

---

## 8. 封面图 / 本地音频流

| 用途 | 端点 | 状态 |
|---|---|---|
| 在线封面 | `GET /widget/api/music/pic` | 【够用】 |
| 本地/在线音频流（含 Range） | `GET /widget/media/:filename` | 【够用】 |
| 任意直链跳转（带 auth 的完整音频地址） | `GET /widget/api/music/url` | 【够用】 |
| 无封面兜底 | —（UI 用渐变，见 BUILD-BRIEF） | 【不需后端】 |

```js
// 封面：Meting 的 pic 是完整地址，本端点 302 过去
GET {API}/widget/api/music/pic?url=<encodeURIComponent(picUrl)>
// → 302 → 图片 | 400 url required

// 本地音频流（<audio src> 直接用它）
GET {API}/widget/media/<encodeURIComponent(文件名)>
// 无 Range → 200 + Content-Type(audio/mpeg|wav|ogg|flac|mp4) + Content-Length + Accept-Ranges:bytes
// 有 Range: bytes=a-b  → 206 + Content-Range + Content-Length
//   → 416 Range Not Satisfiable | 404 not found | 400 invalid filename

// 任意直链 302（一般用不到，go 跳板已覆盖在线播放）
GET {API}/widget/api/music/url?url=<encodeURIComponent(httpUrl)>
// → 302 | 400
```

注意：`music/pic` 与 `music/url` **只做 302，不代理内容**，目标主机是否在
`manifest.network.allowedHosts` 里对它俩不构成限制（浏览器直连）。MIME 表只认
`mp3/wav/ogg/flac/m4a`，其他扩展名 fallback `audio/mpeg`。

---

## 9. 持久化：存哪、存什么、何时写

### 9.1 两份存储，别混

| 存储 | 物理位置 | 内容 | 读 | 写 |
|---|---|---|---|---|
| **播放列表** | `{HANA_HOME}/app-data/hanako-audio-player/playlist.json` | 曲目数组 | `GET /widget/api/playlist` | `POST /widget/api/playlist` |
| **工具侧状态** | 宿主 App 存储键 `player-state`（`ctx.storage.global`） | `{track, queue}` | `GET /api/state` | 仅由音频工具写（`POST /api/select` 间接改 `track`） |
| **播放状态**（新） | §1 路线 A：`hana.storage` 键；路线 B：`app-data/playback.json` | 进度/音量/模式/… | 【缺口】 | 【缺口】 |

`playlist.json` 是 **UI 与 LLM 工具的共同真相源**：
`tools/list-music.js` 读它、`tools/play.js` 写它。**别在 UI 另起一份列表。**
`ctx.storage.global` 的 `player-state` 是 `state.js` 的队列/当前曲目，
和 playlist.json **不是同一份**（契约要求「当前曲目 ID」要持久化且不丢列表——
现状两份并存，接线时以 playlist.json 为准，`/api/state` 只当辅助）。

### 9.2 playlist.json 存什么字段

现状（后端 `collectMediaFiles` / 导入端点 / `tools/play.js` 写入）：

```json
[{ "name": "歌名", "url": "/api/apps/hanako-audio-player/routes/widget/media/x.mp3",
   "mode": "本地|在线", "dur": 0, "group": "本地音乐|在线音乐" }]
```

导入返回的响应体（不落盘，直接给 UI）：单文件 `{ok,name,url,mode}`；
文件夹 `{ok,files:[{name,url,mode}],count}`。

**契约要求但现状缺失的字段**（【缺口】：需在入列表时补写，见 §6 缺口 2）：
- `id`（稳定标识）
- `category`（本地 / 在线导入两大类；现状用 `mode`/`group` 近似，无强制执行）
- `pic`（在线曲目有 `pic`，本地无；列表每行要封面，本地需兜底）

`dur` 现状恒为 `0`（导入不解析时长）——契约要「每行显示时长」，**要么前端
`loadedmetadata` 后回写 `dur`（再 POST 覆盖），要么接受 0 时不显示**。这是已知现状，不是缺口 bug。

### 9.3 何时写（契约硬要求：节流 + 串行，边界立即）

| 时机 | 动作 |
|---|---|
| 导入 / 删除 / 排序 | **立即** `POST /widget/api/playlist`（覆盖式），节流 + 串行队列 |
| 切歌 / 播放 / 暂停 | **立即**写 playback-state（§1）；可选 `POST /api/now-playing` 同步横幅 |
| seek / 音量 / 静音 / 模式 / 歌词开关 | **节流**写 playback-state |
| 歌词取回 | `POST /widget/api/lrc/save` 缓存（fire-and-forget 即可，旧 UI 就是 `.catch(()=>{})`） |
| 旧 UI 那种 30 秒轮询合并 | **不要照搬**成主路径：它会导致「过期异步结果覆盖新状态」。改成本地为准 + 边界直写 |

**关键纪律（契约原文）**：切歌/暂停等边界立即保存；**过期异步结果不能覆盖新状态**——
每次写之前带一个版本号/时间戳，回来的响应比当前状态旧就丢弃。

### 9.4 音频所有权（无端点可解，架构问题）

契约要求「独立窗口 ↔ 小卡切换音频不中断」。**这不是端点缺口**：本文所有端点都不承载
音频会话，`<audio>` 活在视图里，视图被宿主销毁即中断。需先按契约确认宿主公开 API 是否
支持持续音频承载，再定架构；**不要用「回挂后 seek 并重播」冒充连续播放**。

---

## 10. 缺口汇总（需新增的东西）

| # | 缺口 | 建议做法 |
|---|---|---|
| 1 | 播放状态持久化（进度/音量/静音/模式/歌词开关/上次播放/当前曲目ID）无端点 | 路线 A：UI 走 `hana.storage`；路线 B：新增 `GET/POST /api/playback-state` |
| 2 | 曲目无稳定 `id` 字段；去重靠 URL 去 query | playlist 曲目加 `id` + `category`；导入后按稳定 id 去重再写 |
| 3 | 无 `DELETE` 路由；删曲不清理 `media/` 与 `lyrics/` | 新增 `DELETE /api/track?id=...`（同时清文件），或接受覆盖写 + 孤儿文件 |
| 4 | `/api/state` 的 `track/queue` 与 `playlist.json` 两份，当前曲目 ID 未落列表侧 | 以 playlist.json 为准，UI 当前曲目用 `id` 记录后写入 playback-state |
| 5 | `dur` 恒为 0；本地曲目无 `pic` | 前端 `loadedmetadata` 回写 dur；本地封面用渐变兜底 |
| 6 | 独立窗口/小卡音频连续性 | 先核实宿主音频承载能力，非端点问题 |
| 7 | （待核实）App 存储能力是否已在 manifest 声明 | 若走路线 A，确认 `hana.storage` 所需 capability；`manifest.json` 现只列了 5 项 capabilities |

---

## 11. 端点速查（全量，可直接抄）

```js
const API = "/api/apps/hanako-audio-player/routes";

// —— 新端点族（/api）——
GET  {API}/api/state                                  // {ok,data:{track,queue}}
POST {API}/api/select                 {index}         // {ok,data:track}
POST {API}/api/now-playing            {title,source}  // {ok}
POST {API}/api/lyric-line             {line}          // {ok,data:{text}}
POST {API}/api/lyric-hide                             // {ok}
GET  {API}/api/session-status                         // {ok,bound}

// —— 旧 UI 复用族（/widget）——
GET  {API}/widget/api/playlist                        // {ok,tracks,count}
POST {API}/widget/api/playlist        {tracks}        // {ok,count}
GET  {API}/widget/api/queue                           // {ok,tracks:[]}
POST {API}/widget/api/queue                           // {ok}
GET  {API}/widget/api/queue/diff                      // {added:[...],removed:[]}
GET  {API}/widget/api/import-file?path=               // {ok,name,url,mode}
GET  {API}/widget/api/scan-folder?path=               // {ok,files,count}
GET  {API}/widget/api/lrc/load?name=                  // {ok,lrc,filename} | 404
POST {API}/widget/api/lrc/save        {name,lrc}      // {ok,filename}
GET  {API}/widget/api/music/search?keyword=&server=&limit=   // {ok,results,host,total}
GET  {API}/widget/api/music/song?id=&server=          // {ok,track,host}
GET  {API}/widget/api/music/playlist?id=&server=      // {ok,tracks,host}
GET  {API}/widget/api/music/lrc?id=&server=           // text/plain
GET  {API}/widget/api/music/lrc-proxy?url=            // text/plain
GET  {API}/widget/api/music/ttml?id=&platform=ncm|qq  // application/ttml+xml | 404
GET  {API}/widget/api/music/go/:id?server=            // 302 音频直链
GET  {API}/widget/api/music/url?url=                  // 302
GET  {API}/widget/api/music/pic?url=                  // 302
GET  {API}/widget/api/music/full-url?id=&server=&fallback=  // {ok,url} | {ok:false,cookieExpired:true}
GET  {API}/widget/media/:filename                     // 200/206 音频流（Range）

// —— 探针（调试用，接线不需要）——
POST {API}/api/_probe/smtc | GET {API}/api/_probe/smtc
GET  {API}/api/_probe/tools
POST/GET {API}/api/_probe/size | POST/GET {API}/api/_probe/resize
GET  {API}/api/_probe/fs?path=
```

`full-url` 是旧 UI 的登录态探针（`CookieCheck()` 用它测 id=418608185），
新极简 UI **可以不要**：在线播放走 `music/go/:id` 跳板已能在有 cookie 时优先取完整地址、
无 cookie 回退试听，功能上不需要前端再单独探一次。
