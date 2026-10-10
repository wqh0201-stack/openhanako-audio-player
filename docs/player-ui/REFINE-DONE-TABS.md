# 歌单切换条溢出：两侧渐隐 + 当前项跟随（已部署）

构建号 **1003131607**。改动只有两个文件：`ui/style.css`、`ui/app.js`（孪生 html 不动）。

## 问题

歌单攒多之后，切换条右端被**硬切**。`.list-tabs` 本来就有 `overflow-x: auto`，也就是
本来就能滚 —— 但滚动条被 `scrollbar-width:none` + `::-webkit-scrollbar{height:0}` 藏掉，
**没有任何「后面还有」的提示**。所以罐头看到的一排被切掉的按钮，自然会以为后面没有内容。

这不是空间不够，是**可发现性**问题。所以解法不加点击步骤、不加滚动条。

## 做法

### ① 两侧按需渐隐（`mask-image`，不是滚动条）

```css
.list-tabs {
  --tab-fade-l: 0px;
  --tab-fade-r: 0px;
  -webkit-mask-image: linear-gradient(90deg, transparent 0, #000 var(--tab-fade-l), #000 calc(100% - var(--tab-fade-r)), transparent 100%);
          mask-image: linear-gradient(90deg, transparent 0, #000 var(--tab-fade-l), #000 calc(100% - var(--tab-fade-r)), transparent 100%);
}
.list-tabs.is-scroll-l { --tab-fade-l: 22px; }
.list-tabs.is-scroll-r { --tab-fade-r: 22px; }
```

两个状态类由 JS 按 `scrollLeft` / `scrollWidth` 现算：**只在真的溢出、且那一侧还有内容时才亮**。
滚到最右时右侧渐隐自动灭掉，滚到中间时两侧都亮。

### ② 切列表时当前项自动跟进来

`ensureTabVisible(tab)`：nearest 语义 —— 激活项已可见就什么都不做，不可见才把它滚到边缘内侧
（留 14px 与 `.list-tabs` 的左右 padding 对齐，`TAB_PAD` 常量）。

关键约束：**只在激活 id 真的变了时才滚**（模块级 `lastActiveTabId` 比对）。因为 `renderQueue()`
在点心 / 移出 / 重命名时也会重渲染切换条，若无条件跟随，就会把用户手动滚到的位置抢回来。
这和 `centerCurrentInQueue()` 的取舍是同一个道理。

### ③ 滚轮横滚 + 宿主改宽重算

- 鼠标竖滚轮映射为横向滚（触控板 / 触摸本来就能横滑，鼠标用户原来只能按 shift）。
- `ResizeObserver` 观察 `.list-tabs`，宿主布局变化（卡片 ↔ 独立窗、拖拽缩放）后重算渐隐。

## 验收

`node tools/verify-ui.mjs` → **92/92**（新增两条）：

- `list-tabs-overflow-fade`：溢出的切换条在 `scrollLeft=0` 时 `is-scroll-r` 亮、`is-scroll-l` 灭，
  且 `mask-image` 里确实带 gradient。
- `list-tabs-active-scrolls-into-view`：切到最后一个 tab 后 `scrollLeft > 0`、该 tab 右边缘不越界、
  `is-scroll-l` 亮、`is-scroll-r` 灭。

夹具改动：`/widget/api/music/playlist` 原来固定返回同一份 `PLAYLIST_META`，导入多个歌单会**按名字去重**
成一个；现在改成 `id === '888'` 仍返真名夹具、其余按 id 生成「歌单 901」等不同名，测试才造得出多个歌单撑溢。

## 待真机看

渐隐宽度 22px 是拍的，窄卡（465）里可能偏宽或偏窄；渐隐边缘落在第一个 / 最后一个 tab 的哪个位置，
得真机扫一眼。
