# 接线简报 · UI 移植（生产 ui/）

把 `docs/player-ui/` 的原型移植成**生产 UI**，落在 `ui/` 下，接真实后端。
原型是「演示数据 + 定时器模拟」，现在换成真数据、真音频、真持久化。

## 红线（先看）
- 只动 `ui/`。**不碰 `lib/`、`index.js`、`manifest.json`、`app-data/`**（后端由另一位同事改）。
- **不要部署、不要重载安装目录**（`~/.hanako/apps/hanako-audio-player`）——那步由主代理做。
- 纯 HTML/CSS/原生 JS，无框架、无 CDN、无构建步骤。只用 SVG 线描图标，禁 emoji，字号 ≥ 11px。

## 先读
- `docs/player-ui/CONTRACT.md`（功能契约）
- `docs/player-ui/WIRING.md`（后端接线表：URL、请求/响应形状、缺口）
- `docs/player-ui/BUILD-BRIEF.md`（原型规范）
- 原型三件：`docs/player-ui/{index.html,style.css,app.js}`（955 + 742 + 209 行）
- 仓库 `AGENTS.md`

## 产出
- `ui/index.html`（卡片路由）、`ui/standalone.html`（独立窗口路由）——两个**薄壳**，引 `sdk.js`（已有）+ `style.css` + `app.js`
- `ui/style.css`、`ui/app.js`（原型两个文件搬过来 + 接线）
- 两个 html 差异只留「卡片 / 独立窗口」必要项，**DOM 与逻辑共用**；保留 `__HANA_BUILD` 占位（`tools/bump-build.mjs` 会同步）
- 删掉原型里 `DEV-TOOLBAR:BEGIN/END` 两段（整段）

## 接口约定（与后端同事对齐，别改）
**曲目对象** `{ id, name, url, mode, dur, group, pic? }`
- `id`：稳定标识。本地 = 文件名（含扩展名）；在线 = `${server}:${metingId}`
- `mode`：`"本地" | "在线"`；`group`：`"本地音乐" | "在线音乐"`
- `url`：本地 = `…/widget/media/<文件名>`；在线 = `…/widget/api/music/go/<id>?server=<server>`（**直接喂 `<audio src>`，不要 fetch 转 blob**）
- `pic`：在线封面的完整地址；本地无（用兜底渐变）
- `dur`：秒，未知为 0（拿到 metadata 后回写）

**播放状态**：`hana.storage.global` 一个键 `player-playback-state`，值为
`{ currentId, progress, volume, muted, mode, lyricsVisible, playing }`，`mode ∈ "list"|"one"|"shuffle"`。

## 要接的
1. **列表**：启动 `GET {API}/widget/api/playlist` → 渲染队列。`API = /api/apps/hanako-audio-player/routes`。
2. **音频**：真 `<audio>`；`timeupdate` 驱动进度，`ended` 下一首（按播放模式）。别用定时器。
3. **播放/暂停/上下首/模式/进度/音量/静音**：按原型交互，落到真 audio。
4. **歌词**：降级链 `lrc/load` → `music/lrc` → `lrc-proxy` → `music/ttml`（404 退行级 LRC）。在线歌词拿到后 `lrc/save` 缓存。**切歌时旧请求作废**（带曲目 id / 代次校验，迟到响应不许覆盖新歌）。
5. **导入**：`＋` 面板 → 本地文件 / 文件夹 / 在线链接
   - 在线单曲/歌单：`music/song?id=` / `music/playlist?id=`（贴完整链接会自动抠 id）；结果映射成曲目对象（**保留 `id`**，`title→name`、`author` 另存），按稳定 id 去重后 `POST {API}/widget/api/playlist` 整体覆盖
   - 本地文件/文件夹：`import-file?path=` / `scan-folder?path=` —— **`path` 是磁盘绝对路径，纯浏览器拿不到**。这步需要宿主能力；若拿不到，先保留面板入口并**明确标注「待接宿主文件选择」**，不要假装能用。
6. **删除**：行尾「更多」→ 过滤数组 + 覆盖写；若后端已提供 `DELETE {API}/api/track?id=`，优先用它（还会清 media/lyrics）。
7. **记忆**：启动读 playback-state → 恢复列表与当前曲 → `loadedmetadata` 后**把进度夹到有效时长**再 seek；上次暂停就保持暂停。切歌/暂停/导入/删除**立即**写，其余**节流串行**写。**不写 localStorage**（原型里那个 `persistState` 就是接线点）。
8. **主题**：消费宿主 `hana.theme`（SDK 默认已注入样式表）。**不要定义同名 `--bg/--text/--accent` 去盖宿主**——原型的 `:root` token 改成从宿主变量派生（宿主没有的用 `color-mix` 从 `--accent` 派生）。浅色纸/墨/远山蓝、夜间深板岩/藕荷粉由宿主给。
9. **确认别带回来**：PV、唱盘、主题面板、字号按钮、实例编号——原型已无，别加。

## 自检
- 复用 `docs/player-ui/dev/shot.mjs` 的思路（起系统 Chrome 走 CDP，零依赖），对**生产 ui/** 跑：5 尺寸 × 浅深 × 歌词开关 + 断言（顶栏可见、队列可滚到底、无整页双滚/横向溢出、字号 ≥ 11px、无 emoji、右上 100×40 无控件）。
- 联通性：至少验 `playlist` 拉取成功、`<audio>` 能播（用 `app-data/media/` 里真实文件或一个在线曲目）。
- **没验证的不许说通过。**

## 交回
文件 + 一段说明：接了哪些、哪些没接（尤其本地文件路径那步）、怎么跑的、有什么坑。
