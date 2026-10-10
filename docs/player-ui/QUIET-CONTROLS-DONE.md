# 「静听 · 连续布局」控制条 · 实现完成

2026-10-10。按 `QUIET-CONTROLS-HANDOFF.md` 把选定草图落进生产 UI。**已部署**，构建号
1003131610 → **1003131611**。

设计源：`docs/player-ui/refs/quiet-controls/`（approved-fragment.html / 三张截图 / Lucide 图标导出）。

## 1. 一句话

底部控制条从「三段式网格 + 窄卡七等分」改成**一张控制面**：常规高 100、特别窄 112，所有槽位
绝对定位在面内；三种尺寸只重排周边槽位，中央三键（上一首 · 播放 · 下一首）几何中心恒在面正中，
全程 44×44、中心距 52/52、整组宽 148。

## 2. 改了什么

| 文件 | 改动 |
|---|---|
| `ui/index.html` / `ui/standalone.html` | 控制条 DOM 拍平；11 个图标 symbol 换成 Lucide 形状；play 按钮内置双字形 |
| `ui/style.css` | 「底部播放控制 · 静听」整节重写；删旧 `.btn-row/.cell/.ctl-divider/.qb-now` 等规则 |
| `ui/app.js` | `arrangeControls()` 连续换位；`data-ctl` 密度位；曲目信息两行；play/pause 字形交叉；红心弹跳；切歌入场 |
| `tools/verify-ui.mjs` | 宽窗几何断言重写 + 新增 2 条；`ctl-title-hidden-in-card` 改判可见性 |
| `ui/LUCIDE-LICENSE.txt` | 新增：图标许可随生产包保留（ISC + Feather 衍生 MIT 全文） |

### 2.1 图标（Lucide，非手绘）

只取形状搬进原 `<symbol>`，`viewBox="0 0 24 24"` 与 symbol id 不变，统一 `currentColor`；
**不新增在线请求、不引入运行时、不增 manifest 网络权限**。替换清单：

`i-search` `i-heart` `i-repeat` `i-repeat-one` `i-shuffle` `i-prev` `i-play` `i-pause` `i-next` `i-list` `i-close`

线描 19×19 / `stroke-width:1.65`；上/下一首 18×18 实心 `1.3`；播放/暂停 19×19 实心 `1.5`。
**实心规则挂在图标职责上**（`#prevBtn` / `#nextBtn` / `.play-glyph`），不挂在 `.transport` 下 ——
上一版草图「宽窗实心、卡片空心」的割裂就是选择器只写了宽窗那一份。现在三种尺寸同一组 DOM、同一套选择器。

### 2.2 几何（CSS px，不随 DPR 变）

- 中央三键：整组 148×44，各 44×44，间距 8，中心距 52/52，距控制面底边 14；`left:50% + translateX(-50%)`。
- 宽窗 `--ctl-pad:24`；长卡 / 窄卡 `--ctl-pad:12`。
- 宽窗：搜索 `P+22`、曲目信息 `P+52`、红心紧随、模式 `C-112`、音量 `C+112`、队列 `W-P-22`。
- 长卡 / 窄卡：搜索与曲目信息收起，红心落 `P+22`；模式 / 音量仍在 `C∓112`。
- 特别窄（宽 < 400）：模式与音量上移到时间线两侧（`bottom:64px`），中央三键留在下行。
- 时间线：顶部 3px、行高 28、两侧 inset `P`；特别窄时顶部 10px、inset `P+48`、间距 7。

`data-ctl="narrow"` 的 400 换行点**独立于**全局 `data-bar` 的 420（后者还管舞台文字），不互相牵连。

### 2.3 动效

主缓动沿用 `cubic-bezier(0.22,0.61,0.36,1)`；操作状态立即提交，动画只呈现变化。

- 槽位跨断点换位：WAAPI 反向位移 340ms（`arrangeControls`），可打断、不排队；中央三键不做 FLIP。
- 控制面高度 100↔112：340ms 过渡。
- 播放/暂停：同位置双字形交叉淡入淡出（透明度 160ms / 缩放 240ms），圆与位置不跳。
- 红心：填充立即更新 + `1 → 1.16 → .98 → 1` 360ms。
- 切歌：曲目信息从下方 5px 回位 + 淡入 260ms（只作用于文字）。
- 图标悬停 140ms、按压 `scale(.96)`、播放圆悬停 `scale(1.025)` + 亮度 1.04。

`prefers-reduced-motion` 下：换位/高度/字形/红心弹跳全部退为即时或纯淡入；首次加载直接落正确尺寸，
不从窗口态播一次收缩动画。

## 3. 音量：原样保留

按交接 §2，**内部结构、交互、动效一律没动**：`.vol-group` / `#muteBtn` / `.vol-pop` / `#volPop` /
`#vol`、悬停桥 `.vol-group::before`、90ms 关闭宽限、拖动保护、Esc 优先、静音显示零但 `state.volume`
保留、`z-index:40`。

**只改了它在控制面里的位置**：外层 `position:absolute`（`left:calc(50% + 90px)` / 窄档
`left:calc(100% - pad - 44px)`），成为参与响应式排列的实体盒。

> ⚠️ 踩过的坑：`.vol-group` 自带 `position:relative`（浮层的定位上下文），当它作为响应式槽位时
> **必须显式提为 `position:absolute`** —— 否则 `left/bottom` 变成相对文档流的位移，音量按钮会飘到
> 控制条上方（第一轮截图就撞上了）。内层按钮再 `inset:0` 填满外层盒。

## 4. 验收

- `node tools/verify-ui.mjs`：**103/103** 断言（原 101，新增 `ctl-transport-geometry`、
  `ctl-flank-slots-wide`）、**12/12** 布局自检、**4/4** 窄卡自检、零运行时错误。
  - `ctl-endpoints-symmetric-wide` 改判：搜索中心 = `ctl.left + 24 + 22`、队列中心 = `ctl.right - 46`、
    队列纯图标、曲目信息有字。
  - `ctl-play-centered-wide`：播放中心与控制面中心误差 < 1px。
  - `ctl-title-hidden-in-card` 改判「不可见」（`display:none` / `opacity:0` / 宽 0 任一）—— 长卡/窄卡里
    曲目信息是 `opacity:0` 收起，不是 `display:none`。
- 未跑 `verify-backend`：本轮不动后端（无路由 / 音源改动）。

## 5. 部署

- `node tools/bump-build.mjs` → 1003131611（三处同步）。
- 整包同步 `ui/` 六件（index / standalone / style / app / _build / LUCIDE-LICENSE）到
  `~/.hanako/apps/hanako-audio-player/ui/`，`diff -rq` 校验一致。
- `extension_manager reload app:hanako-audio-player` —— **无 manifest 扩权，不需重新审批**。

## 6. 尚未做的实机复核（待罐头在真机看）

1. **连续缩放**：从宽窗拖到窄卡的槽位换位观感、快速反向是否闪白 / 丢响应。
2. **音量浮层遮挡**：新父层绝对定位后，浮层（40）是否仍实际盖过队列抽屉（30）/遮罩（28）/搜索页（22），
   命中不被打断 —— 断言只比 z-index 数字，实机要看遮挡。
3. **长卡队列常驻区**：展开 / 收拢时舞台与底栏之间是否出现大块空白（本轮只改了控制条，队列区沿用生产）。
4. **浅深主题**下的图标对比、红心撞色是否够看。
5. **reduced-motion** 下的换位与首次加载。

## 7. 没动的东西

音源、搜索收藏去向、最近播放、随机上一首历史、歌词兜底、媒体会话、同源代理、音频反应链、app-data；
未引入 `createMediaElementSource`。长卡队列的可拖分隔比例 / 滚动 / 列表长度 / 用户保存布局一律保留。
