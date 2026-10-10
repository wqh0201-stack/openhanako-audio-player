# 音量：单按钮 + 悬停向上弹竖条（已部署）

构建号 **1003131609**。罐头拍板：把原来的「静音键 + 横滑条」合成**一颗按钮**，
鼠标指上去**向上弹出竖向音量条**，**点击 = 静音**，**三种布局通用**。

对齐时罐头定的三条：
1. **触屏不做特殊处理**（「和大卡一样啊，从来没有触屏的需求」）—— 窄卡/长卡和宽窗同一套交互。
2. **悬停即弹、移开即收**，且**要有动画**。
3. 皮**跟播放器现有浮层一套**（深板岩/藕荷粉那套 `--hk-*`），不是照参考图另起一套。

---

## 1. 改了什么

| 文件 | 改动 |
|---|---|
| `ui/index.html` / `ui/standalone.html` | `.vol-group` 内：`#vol` 横条搬进 `.vol-pop`；`#muteBtn` 加 `aria-haspopup/aria-expanded` |
| `ui/style.css` | 新增 `.vol-pop` / `.vol-group::before` / 竖条旋转；删掉 `.range-vol{display:none}` 与宽窗专属展开规则；窄卡不再展平 `.vol-group`；reduced-motion 补一条 |
| `ui/app.js` | 悬停/聚焦开关浮层、拖动保护、Esc、自检断言替换 |
| `tools/verify-ui.mjs` | 新增 7 条断言 |

**`manifest.json` 没动 → 无扩权，reload 不需要重新审批。**

---

## 2. 结构

```html
<div class="vol-group">
  <button class="icon-btn" id="muteBtn" type="button" aria-label="静音" title="静音"
          aria-haspopup="true" aria-expanded="false"></button>
  <div class="vol-pop" id="volPop">
    <input class="range range-vol" id="vol" type="range" min="0" max="100" step="1" value="72" aria-label="音量">
  </div>
</div>
```

浮层是按钮的**绝对定位子元素**，所以 `.vol-group` 必须 `position: relative`。

---

## 3. 四个关键点（改之前先看这里）

### 3.1 连通悬停区：`.vol-group::before`

浮层在按钮上方 8px，中间那道空隙**不属于** `.vol-group` 的盒也不属于浮层。
鼠标从按钮往浮层上行时会经过它 → `pointerleave` 触发 → 浮层中途收起。

补一块 12px 高的透明伪元素把空隙填上（浮层本身是子元素，天然算在组内）：

```css
.vol-group::before {
  content: ""; position: absolute; left: 50%; bottom: 100%;
  width: 44px; height: 12px; transform: translateX(-50%);
}
```

外加 90ms 的关闭宽限（`closeVolPopSoon`）+ 拖动期间 `volDragging` 不收，
三层保险。**别删 ::before**，删了就会「手一往上抬就没了」。

### 3.2 竖条 = 横向 range 旋转 -90°

Chromium 对 `<input type=range>` 支持 `writing-mode: vertical-lr`，但那样得重写一套
轨道渐变（`to right` 在竖排里指向横轴）。**旋转更省事**：整个元素转 -90°，
轨道渐变「左→右 = 小→大」自然变成「下→上」，`.range` 那套轨道/滑块样式一行不用改。

```css
.vol-pop .range-vol {
  position: absolute; top: 50%; left: 50%;
  width: 108px; height: 20px;              /* 旋转前是横的 */
  transform: translate(-50%, -50%) rotate(-90deg);
}
```

- 面板 42×136，滑条 108px 长 → 上下各留 14px。
- **实测拖动映射正确**：拖到 22% → `#vol.value = 22`、`audio.volume = 0.22`。
  （断言 `vol-vertical-drag-sets-volume` 守着这条，映射反了会红。）

### 3.3 窄卡 7 等分：`.vol-group` 不再展平

旧写法靠 `.player[data-layout="compact"] .vol-group { display: contents }`
把静音键摊进 7 等分网格。现在 `.vol-group` 里挂着浮层，
`display: contents` 会把浮层也变成网格子项 → **必须去掉**。

去掉后 `.vol-group` 仍算**一格**（里面只有按钮），格数不变：
`♡ · ⟳ | ⏮ ▶ ⏭ | 🔊 ☰` = 2 + 3 + 2 = **7**。`short-531x451` 自检通过。

### 3.4 层级

`.vol-pop { z-index: 25 }` —— 盖过舞台内容与搜索页（22），
压在队列抽屉（30）/遮罩（28）之下。浮层挂在 `.controls`（`.stage` 之外），
所以不会跟搜索页抢位置；只是向上延伸时可能压住进度条右端（悬停浮层的正常表现）。

---

## 4. 交互清单

| 动作 | 行为 |
|---|---|
| 鼠标移入 `.vol-group`（含浮层与 ::before 桥） | 浮层淡入 + 上浮 + `scale(.94)→1`，`aria-expanded=true` |
| 鼠标移开 | 90ms 宽限后收起 |
| 键盘 Tab 到按钮 | 同上（`focusin`）；Tab 出组才收 |
| 点击按钮 | 切静音（沿用旧逻辑：静音→恢复；音量为 0→恢复 60%），图标切 `i-volume`/`i-volume-mute` |
| 拖动竖条 | 改 `state.volume`，落盘 |
| Esc | 先收浮层（在搜索页/弹层之前） |

reduced-motion：去位移与缩放，只留淡入淡出。

---

## 5. 验收

```
node tools/verify-ui.mjs
```

**99/99 断言**（新增 7 条）、12/12 布局自检、4/4 窄卡自检、零运行时错误。
截图：`/tmp/hap-verify/vol-pop-wide-light.png`、`vol-pop-long-light.png`、`vol-pop-compact-light.png`。

自检里原 `control-visible:vol` 已换成 **`vol-pop-hover-slider`**（默认收起 + 展开后完整可见），
因为 `#vol` 现在默认藏在浮层里，`shown()` 恒为 false。

---

## 6. 真机待看

- 浅/深两套主题下浮层的**边框与阴影**在封面环境色上是否够分得开（尤其深色主题）。
- 浮层压住进度条右端的那一小块，观感是否接受（悬停浮层的常态，但要罐头点头）。
- 面板 42×136 的**比例**：参考图那种细长条；若嫌窄可以调 `width/height` + 滑条 `width` 三处。

---

## 7. 后续修正（2026-10-10，构建号 1003131610，罐头真机反馈）

### 7.1 静音时滑条要归零，取消静音回原值

旧版：静音只换图标，滑条纹丝不动（停在 72%），看着像没静音。

现在 `renderVolume()` 分两件事：

```js
var v = Math.round(state.volume * 100);
var shown = state.muted ? 0 : v;   // 显示值：静音时归零
vol.value = String(shown);
vol.style.setProperty('--fill', shown + '%');
```

**`state.volume` 始终保留**（不因为静音而清零），所以「取消静音回到原音量」是免费的，
不用另存一份「上次音量」。拖动滑条走原路径：`state.muted = state.volume === 0`，
拖到 >0 自动解除静音。

断言：`vol-click-mutes`（多查 `sliderVal === '0'` 与 `--fill === '0%'`）/ `vol-unmute-restores-volume`。

### 7.2 浮层抬到最顶层

歌单抽屉（30）在宽窗下从舞台往上长，音量浮层原先只有 25 → **被抽屉盖住**。

`.vol-pop { z-index: 40 }`，压过抽屉(30)/遮罩(28)/搜索页(22)。
（遮罩与抽屉都只铺在 `.stage` 内，控制条在它们之外，所以按钮本身一直够得着。）

断言：`vol-pop-above-queue`（比 `#volPop` / `#queue` / `#drawerScrim` 的 computed z-index）。

验收：**101/101** 断言、12/12 布局自检、4/4 窄卡自检、零运行时错误。
