# 封面环境色 · 渐变遮罩重做

> 2026-10-09 罐头拍板后的执行简报。承接平台重构。
> 工作区：`/Volumes/SSD/hanadesk/hanako-audio-player-simple`，分支 `hana-simple`（HEAD `d4c1cab`，
> build `1003131550`，已部署）。参考图：`docs/player-ui/refs/`（网易云沉浸播放页）。

> ⚠️ **部署归主 Agent**：你只改代码 + 跑 `tools/verify-ui.mjs` 到全绿、commit 到 `hana-simple`。
> **不要** rsync 到 `~/.hanako/apps/`、不要 reload、不要动 `app-data/`。

---

## 一、罐头要的效果（原话）

「整个播放区域按封面颜色进行过渡，然后歌词区域再一个渐变遮罩覆盖回来。也就是底下一层跟随封面
（不渐变，沿着封面右侧的颜色过渡覆盖完全），上面一层歌词的。」

参考图（网易云沉浸播放页）：**整块播放区就是封面的颜色铺满**，暖调一路铺到右缘；封面右缘柔和地
「化」进背景；歌词压在上面一层薄纱上。现状的毛病：底层被**两道纸色遮罩**（`.cover-haze::after`
＋ `.lyric-scrim`）洗成近纸白，封面色相几乎没了（主 Agent 采样：宽窗右侧 `rgb(252,250,245)`）。

## 二、拍板结论（罐头在卡里选的）

1. **颜色来源 = 读封面像素取主色/右缘色**（不是纯 CSS blur 近似）。
2. **底层封面色铺到最右缘**（整块播放区，不再回主题纸色）。
3. **歌词遮罩 = 盖在歌词区整体一层**（上下淡出 + 中部可读）。
4. **封面也柔化右缘**，让它「化」进背景。

## 三、已核实事实（直接用，别再踩）

- **网易云封面带 CORS**：`curl -I https://p1.music.126.net/...` 回 `access-control-allow-origin: *`。
  所以 `img.crossOrigin='anonymous'` + canvas `drawImage` + `getImageData` **能拿到像素**，不会 taint。
- **封面支持缩放参数**：`?param=100y100` → 约 25KB（原图 2.3MB / 1200px）。取色用小图更轻。
- 封面 host：`*.music.126.net`（已在 manifest allowedHosts），另有 `p1/p2/p3.music.126.net`。
  非网易云来源的封面**可能没有 CORS** → 取色失败必须**优雅退回**（见 §五）。
- 现有代码：`ui/app.js` 的 `probeCover()`（已用 `new Image()` 量画幅比例，但**没设 crossOrigin**）、
  `applyCovers()`、`updateStageMetrics()`（算 `--cover-w`/`--content-x`/`--lyric-top`）。
  CSS：`ui/style.css` 的 `--cover-top-scrim` / `--cover-blend` / `--lyric-scrim` / `.cover-haze` /
  `.cover` / `.lyric-scrim` / `.scene::before/after`。

## 四、层结构（bottom → top）

```
① .stage-ambient（新，或复用 .cover-haze 改造）
     position:absolute; inset:0; z-index:0
     background = 竖向 linear-gradient，色标来自封面右缘像素采样
     铺满整个 .scene 到最右缘（不叠纸色）
     无封面 / 采样失败 → 退回现有 --cover-fallback（纸面兜底）

② .cover（封面本体，位置不动：贴左 contain 完整不裁）
     z-index:1
     新增：右缘淡出 mask，让它「化」进 ①。
       -webkit-mask-image: linear-gradient(90deg, #000 calc(var(--cover-fade-a)), transparent calc(var(--cover-fade-b)));
       淡出起点贴着封面显示宽（--cover-w），由 JS 写入 --cover-fade-a/--cover-fade-b。

③ .lyric-scrim（改语义：不再是「左淡右浓的水平纸色带」）
     z-index:2
     只罩**歌词列**（left: var(--content-x); right:0; top: var(--lyric-top); bottom:0）
     竖向渐变：上下淡出 + 中部够厚（保证字在任意封面色上都可读）
     颜色仍取主题纸色/墨色的 mix，但**要能透出底色**（别再把底下封面色压死）
     无封面时不出现（.nocover 下 none）
     歌词关闭（频谱态）时：这层仍要在（频谱也压在它上面）——R4 语义别丢
```

**标题块**（`.scene-top`，右列上方）：顶部可读性继续靠一条轻量顶渐变（现 `--cover-top-scrim` 可保留但
**调薄**，别再把上半屏洗白）。要求：标题在任意封面色上可读，但不阻挡封面色。

## 五、取色算法（canvas）

```js
function extractAmbient(pic) {
  // 返回竖向色标数组 [[r,g,b], ...]（从上到下 N 段），失败返回 null
  // 1) img = new Image(); img.crossOrigin = 'anonymous'; img.src = pic（可加 ?param=100y100 提速）
  // 2) onload: 画到小 canvas，只取封面**右缘**一条竖带（约 rightmost 18%~28% 宽），
  //    高度分 N（如 10~14）段，每段在竖带内**逐行水平平均** → 得到一条竖向色标
  // 3) getImageData 读像素；任何异常（taint / 解码失败）→ catch 返回 null
}
```

- 采样区在封面**右缘**（对应「沿着封面右侧的颜色」），不是整张主色。
- N 段色标 → `linear-gradient(180deg, rgb(..) 0%, ... rgb(..) 100%)`，写进 CSS 变量
  （如 `--ambient-gradient`），由 `.stage-ambient` 消费。
- **节流/竞态**：切歌频繁时用 token 方式（现有 `coverProbeToken` 的做法），过期结果丢弃。
- **色彩保真**：不要额外加纸色 mix；如需要压暗/压亮以保歌词可读，压暗放在**歌词遮罩层**做，
  不要把 ambient 本身洗掉。

## 六、兜底与边界

- **无封面**（`.nocover`）：`.stage-ambient` 退回 `--cover-fallback`（现有纸面）；歌词遮罩不出现。
- **取色失败**（非 CORS 封面 / 解码失败）：退回现有 `.cover-haze`（模糊副本）或纸面兜底，
  **不能白屏、不能报错刷控制台**。
- **可读性**：拿一张**深色封面**验证歌词是浅字压深底、仍可读（可能要按 ambient 亮度切歌词字色，
  或用足够厚的歌词遮罩）。**别把字调成看不见**。必要时给歌词字色一个基于 ambient 亮度的双态
  （深底→浅字，浅底→墨字）——你判断需不需要，做之前想清楚优先级（可读 > 还原度）。
- 性能：取色别阻塞切歌；能异步就异步，出不来就先用兜底、出来再换。

## 七、硬约束（不变）

- 保留 app.js 依赖的所有 `id`/`data-*`；`ui/index.html` 与 `ui/standalone.html` 同步（只差 `<body data-shell>` 一行）。
- 单文件、无构建、无框架、无 CDN；SVG 线描图标；字号 ≥11px；不用 `position:fixed`；右上 100×40 留空；
  根容器直角；ES5 风格。
- 别动 `appSurfaceSession` 鉴权层、别动歌单模型、导入、生命周期那几块（这次只碰「呈现层颜色」相关）。
- 不引入对宿主主题变量的直接覆盖（继续走 `--hk-*` 桥）。

## 八、验收

```sh
node tools/verify-ui.mjs
```
- 必须全绿（当前基线：12/12 布局 + 4/4 窄卡 + 32/32 断言 + 接线/迁移/生命周期 + 零运行时报错）。
- **扩充夹具与断言**：
  - 加一张**深色封面**夹具（`docs/player-ui/assets/`），断言：切到它后 `--ambient-gradient` 被写入
    且首段色接近深色；歌词在当前字色下对比度够（给个阈值判定，如相对亮度差）。
  - 断言 `.stage-ambient` 铺满（宽 = scene 宽），背景**不是** `--hk-surface` 单色（即确实用上了封面色）。
  - 断言无封面时不崩、退回兜底；取色失败（构造一个无 CORS 的假封面 URL 或注入失败）时优雅退回。
  - 保留并复核 R4：歌词关 = 频谱在、歌词层隐、**遮罩仍在**。
- 截图：312 / 465 / 1040 × 浅深 × 歌词开/关，外加「深色封面」几张（验可读性）。

## 九、交回

1. 层结构怎么落的（尤其取色算法、封面右缘 mask、歌词遮罩形态）。
2. 兜底策略（无封面 / 取色失败 / 深色封面可读性）。
3. 改了哪些文件。
4. `verify-ui.mjs` 结果 + 关键截图（含深色封面）。
5. 真机上需要罐头确认的点（如 ambient 饱和度/压暗程度）。
