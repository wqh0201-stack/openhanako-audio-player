# 动效第二轮修复：复审问题 + 频谱（淡入淡出 / 不闪 / 随乐律动）

> 2026-10-09 复审 `62d267b` 后，罐头反馈「频谱没法随音乐律动、切换闪烁、没淡入淡出」。
> **本轮由主 Agent 自修**（不派隔壁）。工作区 `…/hanako-audio-player-simple`，分支 `hana-simple`，基线 `62d267b`。
> ⚠️ **等隔壁其它任务收工再动手**——同仓同分支，避免抢文件。
> ⚠️ 部署仍归主 Agent：改完跑 `tools/verify-ui.mjs` 全绿、commit，再问罐头一次才 reload。

---

## 一、复审揪出的问题（BRIEF-MOTION 未做全）

| # | 问题 | 锚点 |
|---|---|---|
| A1 | **队列退场无动画**：只在进入时放 `pulseQueueAnim()`；关闭抽屉 / 从队列页返回撞 `display:none` 硬切 | `app.js` L1580/L1583；`style.css` L1146、L1185 |
| A2 | **`pointermove` 让 3s 自动回归失效**：没过滤 `pointerType`，桌面鼠标悬停即不停重置定时器 → 永不回归，而按钮已删 | `app.js` L1102 |
| A3 | **歌词显隐只做「显」**：`pulseLyricAnim()` 只在 `state.lyrics` 为真时调用；关歌词仍 `display` 硬切 | `app.js` L1552、L1558；`style.css` L415-416 |
| A4 | （小）队列入场用 `animation` 关键帧，非可打断 | `style.css` L1149/L1183 |
| A5 | （小）reduced-motion 直接关动画，未「留淡入淡出」 | `style.css` L1202+ |

## 二、频谱的三个新问题

| # | 问题 | 根因 |
|---|---|---|
| B1 | **切换闪烁** | 歌词 ⇄ 频谱是 `display` 硬切（`style.css` L435-438）；`.spec-bar` 的 `animation` 在 `display` 切换时**重启**，柱子跳一下 |
| B2 | **没淡入淡出** | 同上，无 opacity 过渡 |
| B3 | **没法随音乐律动** | 现在是**纯装饰固定循环**：34 根柱写死高度/`--d`/`--delay`，`specPulse` 关键帧 `scaleY(0.32→1)`；`data-playing` 只切 `paused/running`，与音频无关（`app.js` L990 `renderSpectrum`；`style.css` L913-925） |

## 三、要做的

### A. 复审三项

- **A1 退场动画**：给「离开」也加动画。
  - `wide` 关抽屉、`compact` 回播放页时，先播退场（`queueOut`：`translateX(0→100%)` + `opacity 1→0`），`transitionend` 后再 `display:none`；
  - 同时 `compact` 的 `.scene` 补一个入场（`sceneIn`），避免「队列走了舞台空一下」。
  - 建议改**可打断的写法**（见 A4）：用 `transition` + 状态类，而不是 `animation` 关键帧——用户中途反向能接住。
- **A2 `pointermove`**：删掉 `app.js` L1102 这条（`scroll` 监听已足够覆盖真实滚动）；或加 `if (e.pointerType !== 'mouse')`。
- **A3 歌词/频谱显隐双向**：把「隐」也做成过渡（见 B2 的统一做法）。
- **A4/A5**：队列入场改用 `transition`；reduced-motion 下保留 opacity 淡入淡出、只关位移/缩放。

### B. 频谱

- **B1+B2 不闪 + 淡入淡出（先做，纯安全）**：
  - **不再切 `display`**。`.lyric-wrap` 与 `.spectrum` 都常驻 DOM，用 `opacity` + `visibility` 过渡（~0.28s）做交叉淡入淡出，由 `data-lyrics` / `data-haslyrics` 驱动。
  - 常驻后 `.spec-bar` 的 `animation` **不再重启**，闪烁消失。
  - 用 `transition-delay` 让两者错开一点点，避免中间帧重叠糊在一起。
  - `visibility` 而非 `display`，既保留过渡又让隐藏元素不可交互、不占无障碍树。
- **B3 随音乐律动（本轮重点，带风险）**：
  - **移植旧完整版的真·反应链**（`hanako-audio-player/ui/index.html` L8840+ 有现成实现）：
    `AudioContext` → `createMediaElementSource(#audio)` → `createAnalyser`（`fftSize=128`、`smoothingTimeConstant≈0.82`）→ `connect(destination)`；rAF 里 `getByteFrequencyData` 驱动 34 根柱的 `scaleY`（对数取样，低频多给几格）。
  - **安全设计（防「变哑」）**：
    1. 懒建：只在**第一次成功播放的用户手势里**建链，且只在频谱**可见**（无歌词 / 歌词关）时才建；
    2. `new AudioContext()` 后若 `state!=='running'`，先 `resume()`，**resume 成功才** `createMediaElementSource`；失败就 `close()` 并**保留装饰循环**；
    3. `analyser.connect(destination)` 一定接上；不在别处 `disconnect`；
    4. `visibilitychange` 回前台时 `resume()` 一次，防上下文被挂起；
    5. **兜底**：拿不到 `__reactiveReady` 就退回现有 `specPulse` 装饰循环，绝不白屏、绝不静音。
  - **跨源约束**：`<audio>` 走 `createMediaElementSource` 读频谱要求 `crossOrigin='anonymous'` **且源站发 CORS**。网易云封面/CDN 有 CORS（已实测）；**非 CORS 源**读不到数据 → 自动退装饰循环，**不设 `crossOrigin` 破坏其播放**。
  - **暂停态**：暂停时把柱定格成静态均衡器（保留现状语义）。

## 四、风险与决策

- **唯一真风险**：`createMediaElementSource` 一旦建立**不可逆**——之后声音只走 WebAudio，上下文若挂起就静音（reload 可恢复）。
  上面的安全设计把「建链」卡在 `resume()` 成功之后，并要求 `connect(destination)`，把风险压到最低。
- **若罐头不想冒这个险**：退路是**不接真音频**，只让装饰律动更「像在动」——但它本质上仍不随乐。默认按「接真音频」做。

## 五、验收

```sh
node tools/verify-ui.mjs
```
- 全绿（现有 48 条 + 布局/窄卡/接线/迁移/生命周期）。
- **补断言**：
  - `motion-spectrum-fade`：切歌词时 `.spectrum` 的 `opacity` 有过渡（不是 `display` 瞬切）；
  - `motion-queue-exit`：关抽屉后队列确实退场（过渡结束才 `display:none`）；
  - `motion-follow-mouse`：模拟鼠标 `pointermove` 不再重置自动回归（回归仍生效）；
  - `motion-spectrum-reactive`：`__reactiveReady` 为真时柱子 `scaleY` 随 `getByteFrequencyData` 变（假后端下可用注入的 bin 数据验证）。
- **截图**：切歌词的中间帧（证明交叉淡入淡出）、无歌词频谱定格/律动两态。

## 六、交回

- A1–A3 + B1–B3 各自怎么改的 + 改了哪些文件 + verify 结果 + 截图。
- **真机待确认**：频谱是否真的随乐动、切换是否顺、有没有出现静音（重点听一遍）。
