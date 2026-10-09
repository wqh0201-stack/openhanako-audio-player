# 来源重做 · 歌单真名 · 歌手补齐 · 歌单可删（已完成）

> 承接 `BRIEF-SOURCES-AND-LISTS.md`（2026-10-09 罐头拍板）。
> 工作区 `hanako-audio-player-simple`，分支 `hana-simple`，build `1003131549 → 1003131550`。
> **未部署**（不动 `~/.hanako/apps/`、不 reload、不动 `app-data/`），等主 Agent 审完再部署。

---

## 一、四件事怎么落的

### ① 歌单真名：导入时取、压缩显示

- **在哪取**：扩进现有 `GET /widget/api/music/playlist`（省一次往返，简报推荐）。
  后端新增 `fetchNeteasePlaylistMeta(id)`：`server === "netease"` 且 id 是纯数字时，
  走 `ctx.network.fetch` 调 `https://music.163.com/api/v6/playlist/detail?id=<id>&n=1`
  拿 `playlist.name`（`music.163.com` 已在 allowedHosts）。返回体附带
  `meta: { name, creator, cover, trackCount }`。
- **取不到就静默省略**：非 netease、网络失败、无 name → 不返回 `meta`，不报错、不阻塞导入。
- **存哪**：前端 `importLink()` 拿到 `meta.name` 后写进列表元数据 `player-lists` 的 `name`
  （顺带存 `creator`，暂不展示）。取不到时列表保持自动名「歌单 N」。
- **压缩规则**（`compressListName`，可预期）：
  1. 自动名 `歌单 N / 单曲 N / 本地文件 N` → 归一成编号 `N`；
  2. 去掉后缀 `喜欢的音乐 / 喜欢的歌曲 / 喜欢的歌 / 喜欢的单曲 / 的歌单 / 歌单`；
  3. 标点归一（全角 `，、。：` → 半角），连续空白压成一个空格；
  4. 仍 > 8 字 → 截断 + `…`。
  - 「Can_0201喜欢的音乐」→「Can_0201」。
- **显示**：切换条显示压缩名（`listDisplayName`），**完整名放 `title` 悬停**。
  拿不到名字（或只有自动名）→ 退回编号。
- 例：罐头的数据里 `imp:1..4` 名为「鸣潮 / 在线音乐 / 电台流 / 本地音乐」，
  切换条现在显示这些名字（此前是 1/2/3/4）。

### ② 来源重做：砍掉 group 展示语义

- 元信息行改为 **`来源·<歌单名>`**（间隔点），由 `metaLine()` 输出。
  - 曲目所属列表名 = `state.lists` 里那条的 `name`；本地列表 → **`来源·本地`**。
  - 列表被删后的孤儿曲目退回 `defaultListName`（`歌单 N`）。
  - 不再吃 `group`；专辑字段（后端从来没有）整段去掉，不再留空标签。
- 队列第二行 `.q-artist` 改为 **有 `author` 显 author，没有就留空**。
  `normalizeTrack()` 的 `artist` 也去掉了「group 冒充歌手」的兜底，只留真 `author`。
  `#ciArtist`（控制条）同口径。
- **`group` 字段保留在数据里**（向后兼容、不炸去重），UI 一律不再读它。
  唯一的例外是 `normalizeTrack` 里「老数据没有 `mode` 时用 group 推断 mode」的数据归一，
  那是解析、不是展示。

### ③ 歌手补齐：一次性全量，按钮触发

- 入口：导入面板新增 **「补全歌手」** 按钮（`#backfillBtn`，`data-import="backfill"`，SVG 人形线描图标）。
  **不开机自动跑**（不会一启动就打 203 次）。
- 逻辑（`backfillArtists`）：收集「有 `searchKey`、无 `author`」的曲目 →
  逐首走 `music/search?keyword=<searchKey>&server=<searchServer>` 取首条命中的 `author` 写回。
- 并发 **3**、每项之间 `sleep(80)` 节流；**单项失败不中断整体**（失败留空、计数）；
  每 25 首中途落盘一次；完成后全量 `savePlaylist()`。
- **幂等**：已有 `author` 的曲目直接跳过；重复点按钮不再发起搜索。
- 进度：面板注释行实时显示「补全歌手 x/y…」，结束 toast「歌手补全完成：ok/总数」。
- 播放路径也顺带补：`ensurePlayable()` 命中搜索结果时本就会写回 `author`（锦上添花）。

### ④ 歌单可删：切换条长按 / 右键

- 手势：切换条上 **右键**（`contextmenu`）或 **长按 520ms**（`pointerdown` + 计时器，
  移动/抬起即取消）导入列表 → 弹出轻量确认浮层 `#listPop`（**不用模态**）：
  「删除「<名>」？」+「删除歌单 / 取消」。
- **本地列表不可删**：手势直接不弹（`local` 是固定文件夹的投影）。
- 删除语义（`deleteList`）：删列表元数据 + 删该列表下所有曲目条目（`state.tracks` 里 `list === id` 的），
  然后全量 `POST /widget/api/playlist` 落盘（**前端做法，未加后端路由**，去重键仍是 `list|id`）。
  删完若当前激活列表正是它 → 切回「本地」。
- **正在播的那首被删时**（拍板 3）：**继续播完，只把列表从切换条拿掉**。干净做法：
  - 给当前曲目的运行时条目打 `detached` 标记并**豁免**它（不把它从 `state.tracks` 删掉）——
    否则 `currentTrack()` 找不到它，标题/进度/歌词会崩。
  - `detached` 条目**不回写盘**（`savePlaylist` 过滤）：否则下次启动会按它的 `list`
    把已删列表重建出来。
  - 播放不受影响：不切歌、不暂停、标题不变。
- 已知取舍：删列表只删条目，**不物理删除** app-data/media 下该列表导入的本地文件
  （单曲的 `DELETE /api/track` 才会清文件）。当前只有「本地文件」导入会落盘到 media，
  量小，暂不处理；要清可在删除时对每条调一次 `DELETE /api/track`。

---

## 二、改了哪些文件 / 加了什么路由

| 文件 | 改动 |
|---|---|
| `lib/register-routes.js` | 扩 `GET /widget/api/music/playlist`：netease 时附带官方 `meta`（新增 `fetchNeteasePlaylistMeta`）。**无新增路由。** |
| `ui/app.js` | `normalizeTrack`（artist 只留 author）；新增 `compressListName / listDisplayName / sourceName`；`metaLine` 改 `来源·`；`renderListTabs` 显示压缩名；`renderQueue` 第二行只留 author；`savePlaylist` 过滤 detached；`importLink` 写真名；新增 `backfillArtists`（含 `sleep`）+ 按钮接线；新增 `deleteList` + 长按/右键 + `#listPop` 接线；`closePops` 收纳 listPop。 |
| `ui/index.html` / `ui/standalone.html` | 导入面板加「补全歌手」按钮；加 `#listPop` 删除确认浮层；加 `#i-user` 线描图标。两个文件仍**只差 `<body data-shell>` 一行**。 |
| `ui/_build.json` + 两个 html | build `1003131549 → 1003131550`（`tools/bump-build.mjs`）。 |
| `ui/style.css` | 未改（复用现有 `.pop` / `.pop-item`）。 |
| `tools/verify-ui.mjs` | 假后端 playlist 返回 `meta`；加 `searchHits` 计数；新增 §2b 四项断言；迁移标签期望随之更新。 |
| `tools/verify-backend.mjs` | 加 `ctx.network.fetch` 假实现；新增 playlist-meta 两条断言。 |

后端路由总数不变，只扩了一个现有端点的返回体。

---

## 三、验收结果

```
node tools/verify-ui.mjs      → 12/12 布局自检 + 4/4 窄卡 + 32/32 断言
                                + wiringOk / migrationOk / lifecycleOk 全 true
                                + runtimeErrors 0
node tools/verify-backend.mjs → 10/10（原 7 条 + playlist-meta 3 条）
```

新增断言（`verify-ui.mjs` §2b）覆盖简报要求的全部五点：

- `meta-source-local`：本地曲目元信息行 = `来源·本地`。
- `meta-source-format`：在线曲目元信息行以 `来源·` 开头。
- `queue-artist-empty-when-none`：无歌手的队列行第二行为空（不再出现「来自 …」）。
- `backfill-fills-artist`：3 首 searchKey 曲目补齐 `author`，且恰好发起 3 次搜索。
- `backfill-idempotent`：再跑一次，搜索次数增量为 0。
- `list-realname-compressed`：导入歌单后切换条显示 `Can_0201`、`title` 为完整名 `Can_0201喜欢的音乐`。
- `list-longpress-opens-pop` / `list-longpress-cancel`：长按弹删除浮层、不误切列表、取消无变化。
- `list-delete-while-playing`：**正在播的那首所在列表被删** → `data-playing` 仍 `1`、`audio` 不 paused、
  标题不变、该列表从切换条消失、激活列表切回「本地」（夹具：删前 20 行、`currentUid=imp:1|netease:900000`）。
- `list-delete-others-intact`：其余列表不受影响（`imp:2` 仍 6 行）。
- `list-local-not-deletable`：本地列表右键不弹删除浮层。

后端新增：

- `playlist-meta-netease`：netease 导入返回 `meta.name`，且确实打了 `music.163.com` 详情接口。
- `playlist-meta-skip-non-netease`：非 netease 不返回 `meta`、也不打网易云。

截图：`docs/player-ui/screenshots/sources-lists-20261009/`
（`list-realname` 压缩名 / `list-delete-confirm` 删除入口 / `source-local`·`source-online` 元信息行 / `backfill` 补齐后 / `migrated`）。

> 注：迁移夹具的切换条标签期望从 `本地,1,2,3,4` 改为
> `本地,本地音乐,鸣潮,在线音乐,未分类` —— 因为遗留列表名现在真的显示出来了（此前只显示编号）。
> 曲目归属与条数断言不变（local 0 / imp:1 3 / imp:2 4 / imp:3 3 / imp:4 2）。

---

## 四、旧数据 `imp:3`（195 首「电台流」）现在的状态

**没有擅自改名，也没有删除。** 它仍然是 `player-lists` 里一条普通导入列表：

- 名字还是「电台流」（`state.lists` 里原样保留），切换条现在显示「电台流」（此前显示「3」）。
- 那 195 首的元信息行显示「来源·电台流」；它们的 `group:"电台流"` 字段原样留在
  `playlist.json` 里，只是 UI 不再读。
- 它可以被罐头**重命名**（切换条双击当前项 → 内联输入）或**删除**（长按/右键 → 删除歌单），
  也能在它上面点「补全歌手」把 195 首的 `author` 一次性补齐。
- `imp:4`（5 首「本地音乐」）同理：名字保留、可改名可删。

即：遗留名不再被当成「来源」硬编码，但作为**用户可编辑的列表名**保留下来。

---

## 五、真机待确认点

1. **长按 vs 右键手感**：桌面右键没问题；移动/触控板长按 520ms 的阈值是否顺手、
   会不会误触（滑动切换条时已用 `pointermove` 取消）。
2. **歌手补齐耗时**：203 首、3 并发 + 80ms 节流，实测量级约 10–20 秒（取决于节点响应）；
   面板注释行进度的可读性请看一眼。中途关掉面板/切列表不影响（后台继续）。
3. **压缩名是否符合预期**：罐头自己的歌单名压缩结果（如「Can_0201」）在切换条上是否够用；
   8 字截断阈值可调。
4. **删除正在播的列表**：真机上拖一下进度、看标题/进度/歌词是否全程正常（无头已验证逻辑，
   真机复核一次更稳）。
5. **`music.163.com` 详情接口的稳定性**：实测不用 cookie、n=1 约 161KB；若某天返回变化，
   会静默退回编号，不影响导入。
