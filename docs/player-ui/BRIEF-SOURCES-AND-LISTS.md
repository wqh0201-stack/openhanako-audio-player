# 来源重做 · 歌单真名 · 歌手补齐 · 歌单可删

> 2026-10-09 罐头拍板后的执行简报。承接 `REFINE-BRIEF-LISTS-2.md`。
> 工作区：`/Volumes/SSD/hanadesk/hanako-audio-player-simple`，分支 `hana-simple`（已合并舞台重构 + 歌单重构，HEAD `8477c8d`，build `1003131549`，已部署）。

> ⚠️ **部署归主 Agent**：你只改代码 + 跑 `tools/verify-ui.mjs` / `tools/verify-backend.mjs` 到全绿、commit 到 `hana-simple`。
> **不要** rsync 到 `~/.hanako/apps/`、不要 `extension_manager reload`、不要动 `app-data/`。主 Agent 审完再部署。

---

## 一、背景：为什么现在是这样

现在每首歌的元信息行显示「**来源 鸣潮 / 在线音乐 / 电台流 / 未分类**」，这套 `group` 字段是 **v1 遗留**（旧数据里 195 首都是 `group:"电台流"`）。罐头要砍掉它。

新的「来源」语义（罐头原话）：**来源 = 这首歌来自哪个歌单**（就是导入时那个分享链接对应的歌单）。

## 二、实测事实（已核实，直接用）

### 1. 歌单名：Meting 不给，网易云官方接口给

- Meting 三个节点（`met.liiiu.cn` 等）`type=playlist` **只回曲目数组**，无歌单名 —— 所以现在只能叫「歌单 1」。
- **官方接口给真名**（实测 2026-10-09）：
  ```
  GET https://music.163.com/api/v6/playlist/detail?id=12881021&n=1
  → { code:200, playlist:{ name:"Can_0201喜欢的音乐", creator:{nickname:"Can_0201"}, coverImgUrl, trackCount:905 } }
  ```
  - **不需要 cookie**，不带任何头也通；`n=1` 时响应 161KB（< manifest 的 5MB 上限）。
  - 域名 `music.163.com` **已在** `manifest.network.allowedHosts`。
  - 用 `ctx.network.fetch` 调（遵守 manifest 白名单），别用裸 fetch。

### 2. 歌手：Meting 歌单/单曲/搜索接口本来就回 `author`

- 实测 `type=playlist` 每首歌自带 `author`（如「高橋李依」「蔡明希（不才） / 三体宇宙」）。
- **不需要去歌词里提取**（罐头一开始以为要从歌词抠，实测发现接口直接有）。
- 现有 203 首旧数据 **0 条**存了歌手（旧 searchKey 数据只存了 `searchKey`/`searchServer`）。

### 3. 现有数据形状

- `app-data/hanako-audio-player/playlist.json`：203 首。
  - `imp:1` = 2 首（group 鸣潮）、`imp:2` = 1 首（在线音乐）、`imp:3` = 195 首（**电台流**，就是要砍的遗留）、`imp:4` = 5 首（本地音乐）。
  - 每条：`{name,url:"",mode:"在线",dur:0,group,searchKey,searchServer,id:"search:<kw>",list}`。
- `hana.storage.global` 的 `player-lists`：`[{id:"local",name:"本地"},{id:"imp:1",name:"鸣潮"},{id:"imp:2",name:"在线音乐"},{id:"imp:3",name:"电台流"},{id:"imp:4",name:"本地音乐"}]`。

---

## 三、要做的四件事

### ① 歌单名：导入时取真名，压缩显示

- 导入歌单时，除了调 Meting 拿曲目，**再调一次官方歌单详情接口**拿 `name`（+ 可选 `creator.nickname`）。
  - 建议放后端：新增 `GET /widget/api/music/playlist-meta?id=<id>&server=netease`（或扩进现有 `music/playlist` 路由的返回：`{ ok, tracks, host, meta:{ name, creator, cover, trackCount } }`）。**后者更省一次往返，优先。**
  - 只有 `server === "netease"` 时取；其它 server 或取失败就静默省略（不报错、不阻塞导入）。
- 该名字存进列表元数据 `player-lists` 的 `name`。
- **切换条显示压缩名**（罐头的歌单叫「Can_0201喜欢的音乐」→ 显示「Can_0201」）：
  - 压缩规则给出一个可预期的：去掉「喜欢的音乐 / 的歌单 / 的歌单名」这类后缀，标点归一；仍超过 ~8 字就截断加省略号。**完整名放 `title` 悬停**。
  - 拿不到真名时退回数字（`歌单 N`）。

### ② 来源重做

- **砍掉 `group` 语义**。新「来源」= 这首歌所属歌单的显示名。
- 元信息行格式（罐头指定）：**`来源·<歌单名>`**（用间隔点，如「来源·鸣潮」「来源·本地」）。
  - 具体：曲目在其列表内，来源就是该列表名；本地列表 → 「来源·本地」。
- 队列第二行（`.q-artist`）现在是「有 artist 显 artist，否则『来自 group』」→ 改为：**有 artist 显 artist，没有就留空**（不要让 group 再冒充）。
- 旧的 `group` 字段：**不再用于展示**。数据里可以保留（向后兼容、不炸去重），但 UI 一律不吃它。
- 数据迁移：现有 `player-lists` 里 `imp:3` 名「电台流」、`imp:4` 名「本地音乐」这类**遗留名**建议给一个中性默认名（或保留原名但让它可被重命名/删掉，罐头自己整理）。**不做激进改名** —— 保留用户可改可删的能力即可。

### ③ 歌手补齐（拍板：一次性全量补全）

- 给旧数据（有 `searchKey`、无 `artist`/`author` 的曲目）**一次性补歌手**。
- 方法：对每首走 `music/search`（`searchKey` 作关键词），取首条命中的 `author`，写回曲目的 `author` 字段并保存。
- **注意量**：203 首，逐个搜会有 203 次请求。要求：
  - 串行或小并发（≤3），带节流，别把节点打挂。
  - **单项失败不中断整体**，失败的留空、记数。
  - 有进度反馈（toast / 轻量进度条皆可），别让用户以为卡死。
  - **幂等**：已有 `author` 的曲目跳过；重复跑不重复搜。
  - 触发入口：给一个明确按钮（如导入面板里的「补全歌手」），**不要**开机自动跑 203 次。
- 也可在播放到某首时顺带补（锦上添花，可选）。

### ④ 歌单能加能删（拍板：切换条上长按/右键删）

- 加：导入即新建（已有，不用动）。
- 删：**切换条上长按 / 右键某个导入列表** → 删除该列表。
  - 删除语义：删列表元数据 + **删掉该列表下的所有曲目条目**（`state.tracks` 里 `list === 该 id` 的）。
  - **正在播的那首若被删**（拍板 3）：**继续播完，只把列表从切换条拿掉** —— 不打断播放、不切歌。
    - ⚠️ 这有个坑：若把当前曲目从 `state.tracks` 里删了，`currentTrack()` 会找不到它 → 标题/进度/歌词都会崩。**要么保留那条运行时曲目直到播完，要么把「正在播的那首」从删除里豁免。** 你选一个干净的做法并说明。
  - 本地列表（`local`）**不可删**（它是固定文件夹的投影）。
  - 删除要二次确认？**不要弹模态**（设计纪律）。可用内联确认或长按后的轻量浮层。
  - 删完若当前激活列表正是它 → 切到「本地」或第一个可用列表。
  - 后端：已有 `DELETE /api/track?id=&list=`（单曲）。列表级删除可以在**前端**做（删元数据 + 过滤 tracks 再 POST playlist 全量），或加 `DELETE /api/list?id=`。你选更干净的，注意去重键 `list|id` 语义。

---

## 四、硬约束（不变）

- 保留 app.js 依赖的所有 `id`/`data-*`；`ui/index.html` 与 `ui/standalone.html` 同步（只差 `<body data-shell>` 一行）。
- 单文件、无构建、无框架、无 CDN；只用 SVG 线描图标（禁 emoji）；字号 ≥ 11px；不用 `position:fixed`；
  右上 100×40 留空；根容器直角；ES5 风格。
- **别动 `appSurfaceSession` 鉴权层**；所有后端调用继续带票。
- 后端新增网络调用必须走 `ctx.network.fetch` 且域名在 `manifest.network.allowedHosts`（`music.163.com` 已在）。
- 展示层不要硬编中文来源名（别再把 `group` 当来源）。

## 五、验收

```sh
node tools/verify-ui.mjs      # 布局自检 + 接线 + 迁移 + 生命周期 + 精修矩阵 + 主题
node tools/verify-backend.mjs # 去重/删除/播放态单测
```
- 必须全绿（当前基线：12/12 + 4/4 窄卡 + 20/20 断言 + 后端 7/7 + 零运行时报错）。
- **扩充夹具与断言**：
  - 导入歌单时假后端返回 `meta.name` → 断言切换条显示压缩名、`title` 是完整名。
  - 删除一个导入列表（走你选的入口）→ 断言该列表从切换条消失、其曲目不再出现、其余列表不受影响。
  - **删除时正在播那首** → 断言播放不中断（`data-playing` 仍 1、标题不变、audio 不 paused）。
  - 歌手补齐：断言有 `searchKey` 的夹具曲目补齐后 `author` 有值、且幂等（再跑不重复搜）。
  - 元信息行：断言格式含「来源·」、本地曲目显示「来源·本地」。
- 截图：切换条带压缩名的状态、删除入口（长按/右键态）、元信息行新格式。

## 六、交回

1. 四件事各自怎么落的（尤其：歌单名在哪取、压缩规则、删除入口与「正在播」的处理）。
2. 改了哪些文件、后端加了什么路由。
3. `verify-ui.mjs` / `verify-backend.mjs` 结果 + 关键截图。
4. 旧数据里 `imp:3`（195 首「电台流」）这类遗留列表你**没有**擅自改名/删除 —— 说清楚它现在是什么状态。
5. 真机上需要罐头确认的点（如长按 vs 右键的手感、歌手补齐耗时）。
