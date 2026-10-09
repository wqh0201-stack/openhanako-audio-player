# 动效补全：呼出 / 跟随 / 聚焦 / 显隐 / 频谱 / 按压（6 项）

> 2026-10-09 罐头逐条拍板。主 Agent 已只读探查 + 逐项对齐，转交落地。
> 工作区：`/Volumes/SSD/hanadesk/hanako-audio-player-simple`，分支 `hana-simple`。
> 承上：与 `BRIEF-AMBIENT-BLUR.md`（背景）同属一轮，**别互相覆盖**。
> 锚点行号按当前工作区实测，作线索用；改前以文件现状为准。

> ⚠️ **部署归主 Agent**：你只改代码 + 跑 `node tools/verify-ui.mjs` 到全绿、commit。
> 不要 rsync / reload / 动 app-data。

## 〇、总纲

现在的动效是「**结果式**」的——状态一变，界面一帧到位，没有过程。六项都在做同一件事：
**把状态切换补成过渡**。两条底线贯穿全篇，来自 apple-design：

1. **可打断**：任何动效都不能锁输入，用户中途操作要能接住。
2. **只动 `transform` / `opacity`**：不拿 `width` / `height` / `font-size` 做过渡（会重排、会 jank）。

## 一、现状（只读探查结论，带锚点）

| # | 项 | 现状 | 锚点 |
|---|---|---|---|
| 1 | 呼出播放列表 | `compact` 切 `data-page`、`wide` 切 `data-drawer`，队列都靠 `display:none/flex` **硬切** | `style.css` L1136-1137、L1157-1170 |
| 2 | 歌词跟随 | 滚动即 `pauseFollow()` 停跟随 + 弹「回到当前歌词」按钮；**无自动回归**。平滑本身已有（`centerCurrentLine(false)` → `behavior:'smooth'`） | `app.js` L1075-1093、L1044-1055 |
| 3 | 高亮 | `.lyric-line` 过渡的是 `color` + **`font-size`**；当前行放大到 22/24/26px、邻行 15/16px | `style.css` L495-513 |
| 4 | 歌词显隐 | `data-lyrics` 切 `.lyric-wrap` / `.spectrum` 的 `display`，**零过渡** | `style.css` L415-416 |
| 5 | 频谱 | 挂在「歌词开关」上（`data-lyrics="1"` 隐藏频谱），**不是**挂在「有没有歌词」上；无词时歌词区显示 `.lyric-empty「暂无歌词」` | `style.css` L416、`app.js` L1007-1008 |
| 6 | 按钮按压 | 只有 `.play-btn` 有 `:active{filter:brightness(.95)}`；其余全部**只有 hover、没有按压反馈** | `style.css` L985-1022 |

## 二、布局分层（关键前提）

歌词的呈现方式**按承载分层**，别一刀切：

| `data-layout` | 触发 | 承载 | 歌词模式 |
|---|---|---|---|
| `long` | 宽<720 且 高≥560 | 聊天卡片（约 465×930） | **3 行聚焦** |
| `compact` | 高<560 | 矮窗（约 531×451） | **3 行聚焦** |
| `wide` | 宽≥720 | 独立大窗（1040×780） | **多行 + 上下羽化**（保持现状） |

## 三、要做的（6 项）

### 1. 呼出播放列表要有动画
- **`compact`（整页切队列）**：`.queue` 现在 `display:none/flex` 硬切（L1136-1137）。
  改成面板**从右滑入 + 淡入**（`transform: translateX(…)` + `opacity`），退场反向。
- **`wide`（抽屉浮出）**：`.queue` 是绝对定位浮层（L1157-1169），`display:none` 硬切（L1170），
  另有 `.drawer-scrim` 遮罩（L1182-1188）。改成**抽屉从右滑入 + 遮罩淡入**，退场反向。
- **方向一致**：从右来、回右去（apple-design §7 空间一致）。
- `display` 不能过渡：用两段式（进入先 `display`，下一帧加类触发过渡；退出等 `transitionend` 再 `display:none`），
  或用 `visibility` + 过渡。别用会锁输入的写法。
- 保留 `is-shot` 冻结（L1175-1179），自检图必须确定。

### 2. 歌词跟随：滚完停 3s 自动回归
- **去掉「回到当前歌词」按钮**：`index.html` L30-33、`style.css` L521-552、`app.js` 相关引用一起删干净。
- **新增自动回归**：`pauseFollow()` 时起一个 **3s** 定时器，到期自动 `resumeFollow()`；
  期间**任何滚动 / 指针交互重置定时器**（滚一次重新计时）。
- `resumeFollow()` 已走 `centerCurrentLine(false)` → 平滑滚回（L1055），保留。
- **不抢**：定时器在交互进行中不触发；用户正滚 / 正按住时不打断。

### 3. 高亮去放大 + 3 行聚焦
- **去掉放大**：`.lyric-line.is-current` 的 `font-size`（22px 及 L511-513 的 long/wide 覆盖）**全部去掉**；
  `.is-near` 的 `font-size` 也去掉（L504、L513）。**只保留高亮**（颜色 + 字重）。
  高亮交接用 `color` / `font-weight` 的平滑过渡即可，**不做整块滑动**（比"高亮块在行间滑"稳，也不跟滚动打架）。
- **3 行聚焦（仅 `long` + `compact`）**：
  - 所有行**保留在 DOM**（滚动需要高度），不 `display:none`。
  - 常态：只显「上一行 / 当前行 / 下一行」，其余行**淡到几乎不可见**（`opacity` 或遮罩）。
  - **滚动时**：全部行**慢慢显形**（过渡 `opacity` / mask）。
  - **停 3s**：平滑滚回当前行 + **收回 3 行**。
  - 实现提示：用 `.lyrics` 上的状态类（如 `.is-browsing`）+ CSS 过渡驱动，**别逐行改 `font-size`**。
- **`wide`**：保持多行显示 + 上下羽化（`.lyrics` 现有 mask，L472-478 保留），**不聚焦**。

### 4. 歌词显隐要有动画
- `.lyric-wrap` / `.spectrum` 的 `display` 硬切（L415-416）改成**过渡**：
  `opacity` + 轻微位移（`transform`），`display` 同样两段式处理。
- 与第 3 项（3 行聚焦）叠加时注意先后顺序，别互相打架。

### 5. 频谱兜底：检测到无歌词自动切
- 现在频谱挂在「歌词开关」上。改为：**检测到无歌词 → 自动呈现频谱**（歌词区不再显示「暂无歌词」）。
- **优先级：手动 > 自动**。有词时按开关；无词时无论开关都出频谱（没词可显）。
- 频谱本身**仍是纯装饰**，**不接 Web Audio**（`createMediaElementSource` 不可逆、会把声音变哑）——这条不变。

### 6. 按钮点击要有质感
- 给**所有可点元素**加 `:active` 按压反馈：按下 `scale(.96)`、**立即**（过渡 ~100ms `ease-out`），松手回弹。
- 清单：`.icon-btn` / `.text-btn` / `.queue-btn` / `.pop-item` / `.pop-go` / `.back-btn` / `.list-tab` / `.q-row` / `.play-btn`。
- **播放键（48px 圆钮）额外给一点弹性**：回弹带轻微 overshoot。
- `transform-origin` 居中；`scale` 不影响布局。

## 四、边界与硬线

- **只动 `transform` / `opacity`**。现 `.lyric-line` 在动 `font-size`（L501），必须改掉。
- **可打断**：跟随 / 抽屉 / 聚焦都别锁输入。
- **`prefers-reduced-motion: reduce`**：所有新动效要有降级——关缩放、关位移，留淡入淡出。
- **保留所有 `id` / `data-*`**；`index.html` 与 `standalone.html` 同步；无构建步骤；沿用现有 ES5 风格。
- **别动**：歌单模型 / 导入 / 生命周期 / 鉴权层 / 环境色取色（`BRIEF-AMBIENT-BLUR.md` 那摊）。
- `is-shot` 冻结（L1175-1179）不能被破坏。

## 五、验收

```sh
node tools/verify-ui.mjs
```
- 必须全绿（现有 12/12 布局 + 4/4 窄卡 + 断言 + 接线/迁移/生命周期 + 零运行时报错）。
- **新增断言**：
  - 无歌词 → 频谱可见（`shown(spectrum)`）。
  - `long` / `compact` 下 3 行聚焦：非邻行 `opacity≈0`。
  - `wide` 下多行可见（非聚焦）。
- **截图**：`long` / `compact` / `wide` × 有词/无词 × 浅/深；重点抓**抽屉入场中间帧**和**3 行聚焦**。

## 六、交回

- 六项各自的实现要点 + 改了哪些文件 + `verify-ui.mjs` 结果 + 截图。
- **真机待确认**：3s 时长手感、3 行聚焦的淡出强度、按钮按压缩放幅度、抽屉滑入速度。
