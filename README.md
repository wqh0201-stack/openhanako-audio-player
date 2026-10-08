# Hana Audio Player

Hana 的音频播放器 App：本地音乐与在线音乐播放，歌词驱动的双模式视觉舞台。

## 功能

**播放**
- 本地文件 / 文件夹扫描导入（mp3 / wav / ogg / flac / m4a，Range 流式播放，拖进度条不卡）
- 在线搜索与直链播放（网易云 / QQ / 酷狗，meting 公共节点，多节点自动降级）
- 粘贴链接直接导入：**歌单**（整张）和**单曲**都支持
- 播放列表分组：固定来源分组 + 自建分组（持久化，可右键移动 / 重命名 / 删除）

**歌词**
- 自动匹配：播放即按曲名搜索歌词，五源回退
- 逐字歌词：TTML（AMLL 歌词数据库）优先，行级 LRC 兜底
- **离线歌词库**：匹配过的歌词自动落盘（app-data/lyrics/），离线也能出词
- 歌词横幅：当前行实时推到会话输入框上方

**视觉舞台**（顶栏三模式胶囊切换）
- **标准**——黑胶唱盘（播放旋转 / 暂停即停）+ 队列
- **PV**——文字 PV 舞台：[JIZURA](https://github.com/852wa/JIZURA) 式随机排版引擎，每段（一行可再切分）从 13 层里各抽一件：气氛 / 配色 / 字体 / **字形外观** / **背景（29 种）** / 版式（43 种）/ 登场（21 种）/ 保持 / 退场（17 种）/ 衔接（24 种）/ 镜头（20 种）/ 装饰（40 种）/ 处理（25 种），共 278 件，🎲 骰子或 R 键一键重摇（おまかせ）；配牌读数默认不显示，按 T 开关。逐字扫光用 [folia](https://github.com/chthollyphile/folia-major) 的 MonetGlow 包络公式（smoothstep 升起→驻留→衰减），帧级同步音频（rAF 驱动，不走 4Hz 的 timeupdate），拍点会推镜头震动与背景呼吸——数据读自 App 自己的频谱链（音频反应关掉时拍点驱动自然不跑，但 PV 绝不接手 `<audio>`，声音不受影响）。封面取色、歌词行内可写 `/` 分段、`*强调*`、行末 `!`、`\|注釈`
- **歌词**——AMLL 式滚动窗：当前行居中放大，焦外虚化，逐字高亮

**主题**
- 配色面板内置多套预设（含金夜 / 暗夜纯黑），PV 风格可独立于主题切换

## 安装

1. 把本仓库目录放进 `<HANA_HOME>/apps/hanako-audio-player`（目录名须与 `manifest.id` 一致）
2. Hana → Market → Installed → 批准该应用
3. 之后改代码只需在详情页 Reload

最低 Hana 版本：`0.946.2`。

## 可选：完整音源

在 `app-data/hanako-audio-player/cookies.env` 里配置网易云 / 腾讯的登录 cookie，可向 full-url 端点换完整音频（没有则回退试听版）：

```
NETEASE_COOKIE=MUSIC_U=xxx; __csrf=xxx; ...
TENCENT_COOKIE=uin=xxx; qqmusic_key=xxx; ...
```

## 开发

```
pv/build.mjs         文字 PV 层构建（幂等，可反复重跑）
pv/                  PV 层的源：src/ 部件 + css/ 样式，详见 pv/README.md
pv/serve.mjs         本地静态服务（宿主浏览器不吃 file://）
pv/make-test.mjs     生成 pv/test.html 预览台，不放歌也能逐版式看
pv/release.mjs        出两个包：含 PV（hanako-audio-player）与不含 PV（…-lite）
tools/audit-patches.mjs 清点已归档的补丁脚本（见下）
tools/_applied/       一次性补丁脚本：已落地，不再执行
tools/bump-build.mjs 构建号三处同步（_build.json + index.html + standalone.html）
```

**核心 UI（非 PV）怎么改**：直接改 `ui/index.html`（与 `ui/standalone.html` 同步），再跑 `bump-build.mjs`。
以前那批 `tools/inject-*.mjs` / `fix-*.mjs` 已全部归档到 `tools/_applied/`：它们的锚点被自己消费掉了，
既跑不动也不必再跑。要确认它们真的都进了页面，跑 `node tools/audit-patches.mjs`——
它逐脚本、逐锚点回到 html 里比对并分类（已落地 / 被 pv/ 取代 / 被后续补丁吃掉 / 待重放 / 解释不了）。
2026-10-02 的清点结果：已落地 58、仍可重放 0、要人看 0。变更记录交给 git，不再造第二套可重放脚本。

**三条铁律**：
- `ui/index.html` 与 `ui/standalone.html` 是内容相同的双副本——改动必须同步，改完跑 `bump-build.mjs`
- 主 script 是一整个大 IIFE——需要访问内部变量的代码必须注入到 IIFE 内部（以现有代码为锚点），独立 script 块只能做纯 DOM/CSS 操作
- **文字 PV 不再走 `tools/inject-*`**：改 `pv/src`、`pv/css`，然后 `node pv/build.mjs`。`ui/index.html` 里 `PV:BEGIN/END` 之间的内容是构建产物，手改会被下次构建冲掉

## 发布：两个版本（含 PV / 不含 PV）

```bash
node pv/release.mjs            # 出两个包到 dist/full 与 dist/lite
node pv/release.mjs --check     # 只验不打
node pv/release.mjs --keep     # 留下解压目录，直接跑包里的 html 验一看
```

| | 完整版 | lite 版 |
|---|---|---|
| 包名 | `hanako-audio-player-<ver>.zip` | `hanako-audio-player-lite-<ver>-lite.zip` |
| `manifest.id` | `hanako-audio-player` | `hanako-audio-player-lite` |
| 顶栁 | 标准 / PV / 歌词 | 标准 / 歌词 |
| 体积 | 0.40 MB | 0.32 MB |

**lite 不是另一套代码**：同一份 html 去掉 PV 标记块与 `<html data-pv="1">` 就是 lite。
核心里那五个 PV 接入点全部由 `pv/build.mjs` 的声明式钩子注入，并且都带可用性判断——
没 PV 块时三档自动降成两档，不会死在中间档（实测过）。

所以**改完 PV 要重新出包**：`node pv/build.mjs && node pv/release.mjs`。
只改 lite 不重跑构建的话，两边的核心钩子会不一致。

推 tag 就同时出两个 GitHub Release（`v0.8.0` 与 `v0.8.0-lite`），CI 会先校 `pv/build.mjs` 的幂等性。
两个包 id 不同，可以同时装。包内不带 `pv/`、`*.mjs`、测试音与任何凭据。

> 为什么：旧的 `inject-*.mjs` 链用一次性 `replaceOnce`，锚点被自己替换后就不能重跑（`inject-jizura.mjs` 在 HEAD 上已必然抛「命中 0 次」），html 漂出了脚本能复现的范围。PV 层改成幂等流水线：拆旧块 → 剥遗留 → 接钩子 → 插新块 → 写盘前四项自锁，不对就拒写。迁移前的脚本留在 `pv/_legacy/` 只读存档。

## 致谢

- [JIZURA](https://github.com/852wa/JIZURA)（852話）——文字 PV 排版引擎的灵感与部件语义
- [folia-major](https://github.com/chthollyphile/folia-major)——Monet 动效公式（光晕包络 / 逐字插值 / 色调衰减）
- [AMLL TTML DB](https://github.com/Steve-xmh/amll-ttml-db)——逐字歌词数据库
- Meting 公共节点——搜索 / 歌词 / 直链

## License

MIT



