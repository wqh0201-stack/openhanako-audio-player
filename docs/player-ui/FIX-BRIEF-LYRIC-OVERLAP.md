# 修复简报：歌词层与标题块文字重叠（舞台重构遗留缺陷）

> 发现于合并验收（主工作树 `hana-simple`，已含画师舞台重构 + 歌单重构，HEAD `df502b2`）。
> **这个缺陷在画师你自己的分支上就存在**，不是合并引入的；自检没覆盖到它。

## 现象

歌词开启时，右上内容列的**标题块**（`.scene-top`：歌名 / 歌手 / 元信息行）与**歌词阅读列**
（`.lyric-wrap` + `.lyrics`）**落在同一纵向区间，文字直接相互重叠**，糊在一起看不清。

证据（合并后 `verify-ui.mjs` 输出，`OUT_DIR=/tmp/merged-verify2/`）：
- `refine-465x930-light-lyrics-on.png`：歌名「在线曲目 1」与歌词「fixture 第 33 行歌词」叠字。
- `refine-312x494-light-lyrics-on.png`、`refine-1040x780-light-lyrics-on.png`：同样重叠。
- 我自己 `git stash` 出你分支的原版跑 `OUT_DIR=/tmp/artist-verify/`，同样重叠 → 确认是你这版就有的。

肉眼复核图：`/tmp/tight-top.png`（465 卡右上放大）。

## 根因

- `.scene-top`：`position:absolute; top:0; left:var(--content-x); z-index:3; padding:44px 0 0`。
- `.lyric-wrap`：`position:absolute; top:0; bottom:0; left:var(--content-x); z-index:2`（整列从顶部起铺满）。
- 二者**左边界相同、占同一竖带**；歌词列从 `top:0` 起、垂直居中滚动，总有一行落在标题块占的 44~120px 区间。
- `.lyrics` 的 `-webkit-mask` 只在顶部 44px 淡出，且标题块**无底衬**，于是两串文字互相透出。

## 要求

1. **歌词文字不得出现在标题块占用的竖带里**。推荐做法：给 `.lyric-wrap` 一个 `top` 偏移，
   让阅读列从标题块**下方**开始（标题块高度随歌名行数/是否有 meta 变化，取一个能覆盖最高形态的值，
   或用一条 CSS 变量统一管理）。改完顶部淡出 mask 可相应调整（列已不在标题下方，不必再让 44px）。
2. **312 窄卡**要特别看：垂直空间紧，别为了躲标题把歌词区压得太小（可考虑 312 档标题块更紧凑、
   偏移更小；或窄卡下标题与歌词的排布另走一套）。**主机安全区（右上 100×40）继续让开。**
3. **歌词关 / 开两态都要成立**：关时是频谱，标题块正常；开时标题与歌词不重叠。
4. 三种尺寸（312 / 465 / 1040）× 浅深都要过。
5. **加自检/断言**：在页面自检里加一条「标题块 rect 与任意可见歌词行 rect 不相交」的判定
   （或断言歌词列 `top` ≥ 标题块 `bottom`），防止回归。`tools/verify-ui.mjs` 里也补一条硬断言。

## 边界

- 工作区：主工作树 `/Volumes/SSD/hanadesk/hanako-audio-player-simple`（已合并，HEAD `df502b2`）。
  **只改舞台排布相关的 CSS / 必要的一行 JS / 自检断言**，别动歌单模型、导入、生命周期那几块。
- **不要部署、不要 reload 安装目录、不要动 `app-data/`。** 改完 commit 到 `hana-simple`。
- 保留现有全部 `id` / `data-*` 钩子；`ui/index.html` 与 `ui/standalone.html` 保持只差 `<body data-shell>` 一行。
- 必须跑 `node tools/verify-ui.mjs` 到全绿（12/12 + 4/4 窄卡 + 20/20 断言 + 接线/迁移/生命周期 + 零运行时报错）。

## 交回

- 改了什么（偏移值怎么定的、312 档怎么处理的）。
- 三尺寸 × 浅深 × 歌词开关的截图。
- `verify-ui.mjs` 结果。
