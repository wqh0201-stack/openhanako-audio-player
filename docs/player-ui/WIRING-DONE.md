# 极简播放器 · 接线完成记录（2026-10-09）

原型（`docs/player-ui/`）→ 生产 `ui/` 的融合已完成并部署。本文只记**接线结论与坑**，
设计/契约见 `CONTRACT.md`，端点见 `WIRING.md`。

## 交付物

| 文件 | 说明 |
|---|---|
| `ui/app.js` | 全部业务逻辑：真 `<audio>`、后端列表、歌词降级链、导入、记忆、主题 |
| `ui/style.css` | 原型样式 + 主题派生层（见下「宿主主题变量」） |
| `ui/index.html` / `ui/standalone.html` | 薄壳，只差 `<body data-shell="card|window">` |
| `lib/register-routes.js` | 稳定 `id` + 按 id 去重 + `DELETE /api/track`（后端同事产出，已冻结） |
| `tools/verify-ui.mjs` | 无头验收：假后端 + puppeteer-core，六尺寸×浅深自检 + 接线冒烟 |

自检入口留在 `app.js`（`?assert=1` 跑布局清单输出到 `#report`，`?shot=1` 冻结动画），
纯 dev 用途，不参与正常使用。

## 宿主主题变量（重要，踩过一次）

宿主主题样式表（`/api/apps/theme.css?theme=<名>`）注入的变量里**没有 `--surface`**。
本 App 面板底色原来写 `var(--surface)` → 透明。已改成从宿主真实变量派生：

```css
--surface: var(--bg-card, color-mix(in srgb, var(--bg, #F8F4ED) 94%, var(--text, #2A2622) 6%));
```

宿主确实提供的：`--bg` `--bg-card` `--bg-glass` `--text` `--text-light` `--text-muted`
`--accent` `--border` `--shadow` `--sidebar-bg` 等。
**不要**自己定义同名 `--bg/--text/--accent` 去盖宿主（AGENTS.md 已写）。

## 旧播放列表的真实形状（和契约假设不同）

`app-data/hanako-audio-player/playlist.json` 里 203 首**全部**是这种：

```json
{ "name": "长路归航", "url": "", "mode": "在线", "dur": 0, "group": "鸣潮",
  "searchKey": "长路归航 战双帕弥什", "searchServer": "netease" }
```

没有 `id`、没有 `url`，靠 `searchKey` 现搜现播。契约只说了「在线 = `server:metingId`」，
所以接线时必须补一条：

- **稳定 id**：`search:<searchKey>`（`deriveId`），别用歌名（同名会互相覆盖，
  而后端 `POST /widget/api/playlist` 是按 id 去重的，撞 id 会丢数据）。
- **播放前解析**：`ensurePlayable()` 用 `searchKey` 打 `music/search`，主源失败依次降级
  `netease → tencent → kugou → kuwo → baidu`；命中后把 `url/pic/lrcUrl` 补进曲目、
  回写列表（`savePlaylist()`），下次不用再搜。
- **歌词**：解析后 `t.url` 变成 `…/music/go/<id>`，`onlineIdOf()` 从 url 抠出 meting id →
  走 `music/lrc`（后端直连 meting，不吃 host 白名单）；失败再退 `lrc-proxy`（用 `lrcUrl`）→ `ttml`。

`normalizeTrack` / `toStoredTrack` 会保留 `searchKey/searchServer/_metaTried` 等未识别字段，
回写不丢。

## 验证

```bash
node tools/verify-ui.mjs      # 12/12 自检通过；接线冒烟全绿；截图在 /tmp/hap-verify
```

覆盖：六尺寸×浅深布局自检、真 `<audio>` 播放、上下首、模式循环、歌词开关与降级链、
导入在线链接、删除、宽窗抽屉、旧版 searchKey 曲目解析播放。
`runtimeErrors` 里那条 404 是 `lrc/load` 的探测（离线库没有就走在线），属预期。

## 部署回路（本仓库 → 安装目录）

```bash
cp ui/{index.html,standalone.html,style.css,app.js,_build.json} ~/.hanako/apps/hanako-audio-player/ui/
cp lib/register-routes.js ~/.hanako/apps/hanako-audio-player/lib/
node tools/bump-build.mjs
# 然后重载 app（extension_manager reload）
```

回退：`.backups/install-before-fusion-*.tgz`（部署前的安装目录 ui/ + register-routes.js）。

## 视觉对齐（2026-10-09 画师）

生产 UI 又对了一次初始设计稿（`docs/design-proposals/hana-player-queue-v4.png` 长卡/独立窗、
`hana-player-compact-v2.png` 矮卡），差距清单与改法见 `docs/player-ui/ALIGN-BRIEF.md`。
要点：顶栏去盒、歌名直压封面；无封面走「纸面留白」双态（`.nocover`）；
控制条摊平为设计稿节奏 + 实心字形；歌词字号阶梅 22/15/13；队列行 44px 缩略 + 分隔线；
独立窗抽屉 `clamp(320px,34%,380px)`。`app.js` 只动呈现层（nocover 一行 + 队列键 aria 名实一致）。

## 未做 / 待确认

- **独立窗口 ↔ 小卡音频不中断**：`<audio>` 活在视图里，视图被销毁即中断。契约说这要先核实
  宿主是否有持续音频承载能力，纯前端解决不了。本次未动。
- **本地文件 / 文件夹导入**走 `hana.resources.pick`（`app/resources.read` 已在 manifest 声明），
  但没在真机上跑过 —— 需要罐头在卡片里点一次确认。
- 逐字歌词（TTML）只取行级，没做字级高亮（极简 UI 没有字级控件）。
