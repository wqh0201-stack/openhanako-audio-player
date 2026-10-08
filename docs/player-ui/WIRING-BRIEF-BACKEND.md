# 接线简报 · 后端补缺（lib/）

在 `lib/register-routes.js`（必要时 `lib/state.js`）里补三个缺口，**不改已有路由的契约**。
参考 `docs/player-ui/WIRING.md` §10。

## 红线（先看）
- 只动 `lib/`。**不碰 `ui/`、`index.js`、`manifest.json`、`app-data/`**（UI 由另一位同事改）。
- **不要部署、不要重载安装目录**（`~/.hanako/apps/hanako-audio-player`）。
- 保持 Node ESM、零新依赖。**不改已被旧 UI 引用的 `/widget/api/...` 路径**（那是刻意的，见 `register-routes.js` 顶部注释）。

## 三个缺口
1. **稳定 `id`**：导入端点返回的曲目加上 `id`
   - `import-file` / `scan-folder` → `id` = 文件名（含扩展名）
   - `music/song` / `music/playlist` → `id` = `${server}:${metingId}`
   - `GET /widget/api/playlist` 空仓库时扫 media 生成的初始列表，产出的曲目**也要带 `id`**
2. **去重**：在 `POST /widget/api/playlist` 或新增一个"按稳定 id 追加"的入口，保证**按 `id` 去重**（不是按 URL 去 query 后比）。二选一，写清你选了哪条、为什么。
3. **`DELETE /api/track?id=`**：从 `playlist.json` 移除该 id 的曲目，并删除对应的 `app-data/media/<文件>` 与 `app-data/lyrics/<曲名>.lrc`（若存在）。返回 `{ ok, removed }`。

## 也顺手核
- `pic` 字段：在线曲目返回 `pic`（封面完整地址）；本地曲目无。
- `dur`：现状恒为 0；保持 0 即可（UI 拿到 metadata 后回写）。

## 自检
- `node --check` 通过；并**实际验**：起一遍路由或写个小脚本打这几个端点，给出请求/响应实例。
- **没验证的不许说通过。**

## 交回
改动文件 + 一段说明：新增/改了哪些端点、请求/响应形状、怎么验的、有没有破坏旧契约。
