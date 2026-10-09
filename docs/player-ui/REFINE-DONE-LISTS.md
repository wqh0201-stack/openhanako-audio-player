# 极简播放器 · 多歌单 + 本地固定文件夹 + 夜间兜底（完成记录）

> 2026-10-09 执行 `docs/player-ui/REFINE-BRIEF-LISTS.md`。
> 工作树 `/Volumes/SSD/hanadesk/hanako-audio-player-lists`，分支 `hana-simple-lists`。
> **未部署、未 reload 安装目录、未动 app-data**（按简报约束，交主代理处理）。

---

## 一、数据模型与迁移

### 曲目（playlist.json）

每条曲目新增两个字段：

| 字段 | 值 | 说明 |
|---|---|---|
| `list` | `"local"` / `"imp:N"` | 归属列表。本地 = 固定文件夹；导入歌单按导入顺序编号 |
| `uid`（仅内存） | `list + "|" + id` | UI 内部定位键。**同一首歌可在多个列表**，稳定 `id` 会重复，所以列表内定位一律用 uid，不用裸 id |

回写 `playlist.json` 时只落 `list`（uid 是派生值，不入盘）。后端去重键见 §三。

### 列表元数据（`hana.storage.global`）

| 键 | 值 |
|---|---|
| `player-lists` | `[{ id:"local", name:"本地" }, { id:"imp:1", name:"鸣潮", source? }, …]`，顺序即顶部切换条顺序 |
| `player-local-dir` | 本地固定文件夹的绝对路径 |

曲目仍写在 `playlist.json`（含 `list`），列表元数据与文件夹路径走宿主存储。
宿主存储不可用时（纯浏览器 / SDK 未落地）退化为内存态：功能照常，只是不跨重启。
**不写 localStorage**（契约硬要求）。

### 旧数据迁移（`migrateLists`，前端 app.js，幂等）

现有 `playlist.json` 无 `list` 字段时：

- `mode === "本地"` → `list:"local"`。
- 其余（在线）→ **按原 `group` 各自成一个导入列表**，按首次出现顺序编 `1/2/3…`，
  列表名用原 group（如「鸣潮」「在线音乐」）；`group` 缺失 → 一个「未分类」列表。
- 迁移后在**每个列表内**按稳定 id 去重；跨列表不去重。
- 迁移结果回写 `playlist.json`（`POST /widget/api/playlist`，后端按新去重键落盘）。
- **幂等**：所有曲目都已有 `list` 字段时，只补列表元数据，不改结构。

无数据丢失（每首歌都落到某个列表）；`verify-ui.mjs` 的迁移夹具断言了总条数守恒。

### 列表显示

- 顶部切换条：`本地` + `1`/`2`/`3`…（导入列表只显示数字，原始名放 `title` 提示）。
- `＋` 仍是导入入口；本地页无文件夹时给「选择文件夹」引导，不空白。

## 二、改了哪些文件

| 文件 | 改动 |
|---|---|
| `ui/app.js` | 歌单模型（`list`/`uid`）、迁移、顶部切换、按列表渲染、导入分流、本地文件夹、`snapshot.activeList` |
| `ui/index.html` | `#queue` 内加一行 `<div class="list-tabs" id="listTabs">`（仅此一处 DOM 新增） |
| `ui/standalone.html` | 同步，仍只差 `<body data-shell>` 一行 |
| `ui/style.css` | `.list-tabs`/`.list-tab`、空态引导 `.q-guide*`、`@media (prefers-color-scheme: dark)` 夜间兜底 |
| `lib/register-routes.js` | 去重键 `trackKey` 纳入 `list`；`DELETE /api/track` 支持可选 `list` |
| `ui/_build.json` + 两个 html | `bump-build`：`1003131545 → 1003131546` |
| `tools/verify-ui.mjs` | 夹具扩成多歌单 + 本地文件夹 + 迁移；新增切换/文件夹/导入/去重/夜间断言 |
| `tools/verify-backend.mjs` | 新增：后端去重键与 DELETE 的单元验收 |

**保留的钩子**：`id`/`data-*` 全量保留（含 `data-id`；新增 `data-uid` 供内部用），
`appSurfaceSession` 鉴权层（`apiFetch`/`withSession`）未动。

## 三、后端去重键怎么改

`lib/register-routes.js` 的 `trackKey` 原来只用 `id`（老数据回退完整 url），
同一首歌进两个列表会被并成一条、丢掉一份归属。改为把 `list` 纳入键：

```js
function trackKey(t) {
  const id = String(t?.id ?? "").trim();
  const list = String(t?.list ?? "").trim();
  if (id) return `id:${list}|${id}`;
  return `url:${list}|${String(t?.url ?? "").trim()}`;
}
```

`DELETE /api/track` 同理：新增**可选** `list` query。带 `list` 时只删该列表里的那一份
（同一首歌可在两个歌单里各自独立删除）；不带时保持旧行为（按 id 全删），兼容旧调用。

单元验收（`node tools/verify-backend.mjs`，5/5 通过）覆盖：跨列表保留、同列表去重、
老数据按 list 分开、DELETE 带/不带 list。

## 四、主题：跟随 macOS 夜间模式

`ui/style.css` 在 `:root` 的 `--hk-*` 定义之后加：

```css
@media (prefers-color-scheme: dark) {
  :root {
    --hk-bg: var(--bg, #34424B);
    --hk-surface: var(--bg-card, #414D56);
    --hk-text: var(--text, #E1EAF0);
    --hk-muted: var(--text-muted, #9FB1BC);
    --hk-faint: var(--text-light, #9FB1BC);
    --hk-accent: var(--accent, #C99AAF);
    --hk-border: var(--border, rgba(170,121,141,0.16));
    --hk-on-accent: #2A3238;
  }
}
```

关键点：每条仍写成 `var(宿主变量, 夜间默认)`，所以**宿主一旦注入就以宿主为准**；
宿主没注入（线上 `theme.css` 从未被请求）时才跟随系统深浅。优先级因此是
**宿主注入 > prefers-color-scheme 兜底 > 写死默认**。`--hk-*` 的定义行结构未动
（同事那层 `--hk-*` 桥保持不变，只加了这个媒体查询块）。

## 五、验收

```sh
node tools/verify-ui.mjs        # 12/12 布局自检 + 接线冒烟 + 迁移，全绿，exit 0
node tools/verify-backend.mjs   # 后端去重键 / DELETE，5/5
```

`verify-ui.mjs` 新增断言（全通过）：

- 顶部切换条 `本地,1,2`；本地页无文件夹 → 引导按钮存在。
- 切到 `1`：20 行；切到 `2`：6 行（含 3 首与 `1` 同 id 的跨列表重复 + 3 首 searchKey）。
  **切列表只换内容**：`#sceneTop`/`#controls`/`#listTabs` 的 rect 前后完全一致。
- 列表内 `data-uid` 无重复（local / imp:1 / imp:2 均查）。
- 本地页选文件夹（stub `hana.resources.pick`）→ 扫出 3 首，无重复 id。
- 导入歌单链接 → 顶部多一个 tab 并激活；导入单曲链接 → 并入当前导入列表。
- 夜间兜底：模拟 `prefers-color-scheme: dark` 且宿主不注入 → `--hk-bg` 变 `#34424B`，
  切回 light 变 `#F8F4ED`。
- 迁移夹具（12 首无 list）：迁移后 `本地,1,2,3`（名 `本地/鸣潮/在线音乐/未分类`），
  条数 `3/4/3/2` 守恒，reload 后结构不变（幂等）。

截图在 `/tmp/hap-verify/`：`list-local-empty`、`list-imp1`、`list-imp2`、`list-local`、
`list-imported`、`migrated`、`list-1040x780-{light,dark}`、`darkfallback`，以及原六尺寸×浅深。

## 六、需要罐头拍板的点

1. **导入单个「单曲」链接归到哪**：简报点名要方案。当前默认 = 归入**当前选中的导入列表**；
   若当前是本地列表（或还没有导入列表），新建一个导入列表（名 `单曲 N`）。
   备选：总是新建「单曲」列表（列表会变多）、或直接丢进本地列表（本地=固定文件夹，语义不符）。
2. **本地列表的语义**：现在是「固定文件夹扫出来的 + 手动导入的本地文件」的并集，
   选文件夹时**并入**而非替换。若罐头要「本地页 = 严格等于那个文件夹」，改成替换式即可
   （代价：手动导入的本地文件会被下次扫描挤掉）。
3. **导入歌单的原始名**：Meting 的 `music/playlist` 只回曲目、不回歌单名，所以新导入列表名
   只能给 `歌单 N`（迁移出来的列表则用原 group 名）。要真名需后端补字段（另开单）。
4. **文件夹内容的实时性**：只在「选文件夹时 / 开机时 / 点重新扫描」扫。文件夹里加删文件
   不会自动反映。要不要做定时或打开本地页即扫？

## 七、未做 / 边界

- 不碰独立窗/小卡的音频连续性（同前，需宿主能力，非本单）。
- `hana.resources.pick` 的真机路径未在本机点过一次（无头环境用 stub 验），
  需罐头在卡片里真选一次文件夹确认。
