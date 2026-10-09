# 封面环境色 · 渐变遮罩重做（已完成）

> 承接 `BRIEF-AMBIENT-COVER.md`（2026-10-09 罐头拍板）。
> 工作区 `hanako-audio-player-simple`，分支 `hana-simple`，build `1003131550 → 1003131551`。
> **未部署**（不 rsync、不 reload、不动 `app-data/`），等主 Agent 审完再部署。

---

## 一、层结构怎么落的

舞台 `.scene` 里自下而上四层（DOM 顺序即绘制顺序）：

| z | 元素 | 干什么 |
|---|---|---|
| 0 | `.stage-ambient` `#stageAmbient`（新） | 环境色：封面右缘像素 → 竖向渐变，`inset:0` 铺满到最右缘 |
| 0 | `.cover-haze` `#coverHaze`（语义改了） | **取色失败时的兜底层**（模糊副本）。取色成功由 `.ambient-ok` 收起 |
| 1 | `.cover` `#cover` | 封面本体（贴左 contain 完整不裁）+ **右缘 mask 淡出** |
| 2 | `.lyric-scrim` `#lyricScrim`（语义改了） | 歌词薄纱：**只罩阅读列**，竖向上下淡出 + 中部可读 |
| 2/3 | `.scene::before` / `.scene-top` / `.lyric-wrap` / `.spectrum` | 位置不变 |

`.cover` 的 `background-color` 由 `--hk-surface` 改成 **透明**，并且不再叠 `--cover-fallback`
第二层：contain 的 letterbox 留白要露出底下的环境色，而不是盖一块纸。
（队列行的小封面 `.q-cover` 仍走带兜底层的 `coverImage()`，那里留白小、叠兜底更稳。）

### 取色算法（`ui/app.js`）

```
probeCover(pic)
 ├─ 画幅探测：new Image()（不设 crossOrigin，非 CORS 封面也要量得出来）→ --cover-w/--content-x
 └─ probeAmbient(pic, token)：另一张 Image + crossOrigin='anonymous'
      画到 48×96 小 canvas → 只取右缘竖带（x 72%~92%）→ 竖向分 12 段逐段水平平均
      → 色标 [[r,g,b]×12] → linear-gradient(180deg, …) 写进 --ambient-gradient
```

- **小图提速**：网易云封面 host（`music.126.net`）自动加 `?param=100y100`（约 25KB）。
- **两端外延 + 映射到封面显示高度**：`renderAmbientGradient()` 把 12 段色标映射到
  `[t0, t1]`（t0/t1 由 contain 后的封面显示高算出），首末色再各自铺到 `0%`/`100%`。
  不做这一步的话，letterbox 会把渐变整体拉伸，封面右缘上下角与环境色对不上、出现色阶。
- **竞态**：沿用 `coverProbeToken`；另有 `ambientCache`（pic → 色标）避免每次 renderQueue
  重复取色，失败也缓存 `null`（不反复重试、不刷错误）。
- **不阻塞切歌**：取色是异步的；出结果前先退回模糊副本（`.cover-haze`），出来再换渐变。

### 封面右缘 mask（「化」进背景）

```css
.cover { -webkit-mask-image: linear-gradient(90deg, #000 0, #000 var(--cover-fade-a), transparent var(--cover-fade-b)); }
```
`--cover-fade-a/b` 由 `updateStageMetrics()` 按封面显示宽写入：淡出宽 = `clamp(28px, coverW*24%, 140px)`，
即 `fade-a = coverW - fade`、`fade-b = coverW`。`nocover` 时 `mask: none`（纸面兜底不用羽化）。

### 歌词遮罩形态

```css
.lyric-scrim { top: var(--lyric-top); bottom:0; left: var(--content-x); right:0;
               background: var(--lyric-scrim);
               mask-image: linear-gradient(90deg, transparent 0, #000 28px); }
```
- 从「整屏横向纸色带（左淡右浓）」改成 **只罩阅读列** + **竖向渐变**：
  上下淡出（0% → 0，94% → 0.32，100% → 0），中部 0.55 够厚。
- 左缘 28px 横向羽化：不然会在封面色上切出一条硬竖边（312/1040 上肉眼可见）。
- 颜色取「两态纱」的基色（见下），**不是** `--hk-surface`，这样才不会被主题纸色/深板岩洗掉。

---

## 二、兜底与可读性

### 两态纱（浅底 / 深底）

`player[data-ambient]` 由 JS 写，取值 `light` / `dark` / `none`：

- `light`：浅纱 `--veil-paper #FCFAF5` + 墨字 `--on-veil-ink #2A2622`
- `dark`：深纱 `--veil-ink #14171C` + 纸字 `--on-veil-paper #F2F6FA`
- `none`（无封面）：退回主题字色 + 无遮罩（原 `.player.nocover` 语义）

**怎么选**：把 12 段色标各按两态纱合成一遍，算 WCAG 对比度，取「最差段位」为主评分
（0.7）+ 均值（0.3）—— 最差都看得清才算数。纱的基色/alpha 从 `:root` 的 `--veil-*` 读，
不在 JS 里另存一份。

**为什么锚在封面而不是主题**：纱的作用是给字做对比。若用主题纸色（深色主题下是深板岩），
「深色主题 + 浅色封面」会得到浅字压中灰，对比度掉到 2.5。锚在封面亮度上，两态都稳。

### 三种兜底

| 情况 | 表现 |
|---|---|
| **无封面**（`.nocover`） | `data-ambient="none"`、无渐变；`.stage-ambient` 铺 `--cover-fallback` 纸面；`.cover-haze` 隐藏；歌词遮罩 `none` |
| **取色失败**（非 CORS / 解码失败 / `getImageData` 抛 SecurityError） | `try/catch` 静默吞掉 → 收起渐变、`ambient-ok` 移除 → `.cover-haze` 模糊副本接管（并压一层主题纸面保字）；极性退回主题极性 |
| **深色封面** | 两态择优 → `dark`：深纱 + 纸字。深色夹具实测 对比度 current 9.68 / near 11.4（中部），最差段 10.0 / 11.7 |

浅底夹具（方形 demo 封面，右缘上浅下深）实测 **light**：current 5.31 / near 4.98（中部），
最差段 3.34 / 3.69 —— 都过阈值（中部 ≥4.5、最差 ≥3.0）。

### 标题块

`.scene-top` 位置不动，顶部可读性继续靠 `.scene::before` 的 `--cover-top-scrim`，
但**调薄**了（原来 0.92 → 0.58 现在 0.80 → 0.42 → 0），并且跟两态一起换极性。
标题不再把上半屏洗白。

---

## 三、改了哪些文件

| 文件 | 改动 |
|---|---|
| `ui/style.css` | 封面层整段重写：新增 `.stage-ambient`；`.cover-haze` 改兜底语义；`.cover` 透明底 + 右缘 mask；`.lyric-scrim` 改「只罩阅读列 + 竖向薄纱 + 左缘羽化」；`--veil-*` / 两态 `[data-ambient]` / `--cover-fade-*` / `--ambient-gradient` 变量 |
| `ui/app.js` | 新增 `probeAmbient()` / `renderAmbientGradient()` / `ambientPolarity()` / `applyAmbient()` / `applyAmbientPending()` / `ambientUrl()` / `themePolarity()` / `coverStageImage()`；`probeCover()` 拆成「画幅探测 + 环境色探测」两路；`updateStageMetrics()` 增写 `--cover-fade-a/b` 并重算渐变 |
| `ui/index.html`、`ui/standalone.html` | 新增 `<div class="stage-ambient" id="stageAmbient">`；`.player` 加 `data-ambient="none"`（两文件仍只差 `<body data-shell>` 一行） |
| `ui/_build.json` + 两 html | build `1003131551` |
| `tools/make-fixture-covers.mjs`（新） | 纯 Node 手写 PNG 生成深色封面夹具（无第三方依赖、确定性可复现） |
| `docs/player-ui/assets/demo-cover-dark.png`（新） | 深色封面夹具 1024×1024，右缘平均亮度 0.008 |
| `tools/verify-ui.mjs` | 新增 3b 段（环境色 11 条断言 + 截图）、深色封面截图矩阵；`AMBIENT_PROBE` 页内探针；**并在第 3 段前补一次 `__fixture/reset`** |
| `docs/player-ui/screenshots/ambient-20261009/`（新） | 关键截图 |
| `AGENTS.md` | §5 当前任务补这一轮 |

**没碰**：`appSurfaceSession` 鉴权层、歌单模型、导入、生命周期、后端 `lib/`、`index.js`。

---

## 四、验收

```sh
node tools/verify-ui.mjs      # exit 0
```

```
selfCheck 12 / 12     （基线，未动）
narrow    4 / 4       （312 窄卡自检）
assertions 43 / 43    （基线 32 + 本轮 11）
wiringOk true  migrationOk true  lifecycleOk true
runtimeErrors []      （零运行时报错；预期噪声只有原有的探测 404 / ERR_ABORTED）
```

本轮新增的 11 条断言：

1. `ambient-gradient-written:light` —— 浅底封面写入渐变、极性 `light`、色标 ≥12 段
2. `ambient-gradient-written:dark` —— 深色封面极性 `dark`、**首段亮度 0.004 < 0.1**
3. `ambient-fills-scene` —— `.stage-ambient` 宽高 == `.scene` 宽高，且背景确实是 `linear-gradient`
4. `ambient-replaces-haze` —— 取色成功时 `.ambient-ok` 在、`.cover-haze` 收起
5. `ambient-dark-lyric-readable` —— 深底：中部对比度 ≥4.5、最差段 ≥3.0
6. `ambient-light-lyric-readable` —— 浅底：同上
7. `cover-right-fade-mask` —— `.cover` 的 `mask-image` 是渐变，`--cover-fade-b == --cover-w`，且 `fade-a < fade-b`
8. `lyric-scrim-covers-column` —— 遮罩左边界 == `--content-x`、上边界 == `--lyric-top`（±1px）
9. `ambient-nocover-fallback` —— 无封面：`nocover`、极性 `none`、无渐变、铺 `--cover-fallback`
10. `ambient-extract-failure-graceful` —— `getImageData` 抛 SecurityError 时：无渐变、`.cover-haze` 可见、不崩
11. `ambient-dark-lyricsoff-scrim-stays` —— 歌词关（频谱态）时薄纱仍在、渐变仍在（R4）

**测试方法说明（怕被当成自证）**：对比度不是读 app 的内部状态，而是在页面里**独立算一遍**：
读 `:root` 的 `--veil-*` 基色与 alpha → 把色标合成到纱上 → 读实际渲染的 `.lyric-line.is-current/.is-near`
计算色（含自身 alpha 合成）→ 算 WCAG 比。阈值分两档：中部（歌词真正落的那段）≥4.5；
最差段位（极端封面）≥3.0（大字）。
取色失败那条用 `CanvasRenderingContext2D.prototype.getImageData` 抛 `SecurityError` 模拟
（非 CORS 封面 / 解码失败的真实路径就是它），不制造网络噪声。

**顺手修了验收脚本一个隐性坑**：第 3 段（精修矩阵）原本跑在第 2 段之后，而第 2 段会把
`imp:1` 删掉、留下播放态 —— 于是矩阵截图拍的一直是「无封面的歌单曲目」残局，看不出封面效果。
现在第 3 段前补了一次 `__fixture/reset`，矩阵截图才真正拍到封面态。

### 截图

`docs/player-ui/screenshots/ambient-20261009/`（11 张）：

- `ambient-light-465x930.png` / `ambient-dark-465x930.png` —— 浅底 / 深底封面 465
- `ambient-dark-312x494-dark.png` / `ambient-dark-1040x780-light.png` —— 深色封面 312 / 1040
- `ambient-dark-465x930-lyrics-off.png` —— 深色封面 + 歌词关（R4）
- `ambient-nocover-465x930.png` / `ambient-fail-465x930.png` —— 无封面 / 取色失败兜底
- `refine-465x930-light-lyrics-on.png` / `-lyrics-off.png` / `refine-1040x780-light-lyrics-on.png` /
  `refine-465x930-dark-lyrics-on.png` —— 主展示态

---

## 五、真机待罐头确认

1. **纱的厚度**（0.55 / 0.60）：现在封面色相透得出来了，但「透多少」是主观项 ——
   觉得还是偏灰就往 0.48 压，觉得字飘就往上加（`--veil-paper` / `--veil-ink` 的中段 alpha，
   连带 `--veil-paper-a` / `--veil-ink-a` 一起调，后者是 JS 择优用的保守值）。
2. **深底封面字色**：现在是「深纱 + 纸字」。参考图（网易云）是暖底 + 浅字，方向一致；
   但深色封面上歌词区会明显比封面亮一档，是否接受。
3. **`.scene::after` 底部 72px 渐隐到 `--hk-surface`**：深色封面 + 浅色主题时，舞台底部会有一条
   浅色过渡带（为了接住下面的控制条）。是否要改成跟着环境色走。
4. **封面右缘淡出宽度**（`coverW*24%`，夹 28~140px）：真机上封面画幅各异，这个比例是否合适。
5. 真机点一次带封面的网易云曲目，确认 `?param=100y100` 走的是真 CORS（本地夹具是 same-origin，
   验不到真跨源那条路；协议与 curl 实测都在简报里）。
