# 点歌手名 → 直接搜这位歌手（ARTIST-SEARCH-DONE）

2026-10-10。罐头要的：点歌词上面那行歌手名，直接跳搜索。
**已部署**，构建号 1003131615 → **1003131616**。改动落在 `ui/index.html` /
`ui/standalone.html` / `ui/style.css` / `ui/app.js`（+ `tools/verify-ui.mjs` 四条断言）。

---

## 1. 先厘清一件事：搜索页一直不依赖宽窗

「搜索页只有大卡片才有」这个印象来自**入口**，不是**页面**：

- 入口 = 控制条最左那颗 🔍（`.search-entry`），只在 `data-layout="wide"` 显示 ——
  窄卡的控制面排不下它，这是 `QUIET-CONTROLS-HANDOFF` 定的。
- 页面 = `.search-page`，`position: absolute; inset: 0` 长在 `.stage` 里。
  **`.stage` 三种布局都有**，页面本身从没有过尺寸门槛。

所以这不是"能不能"的问题，是"要不要请它进来"的问题。而舞台上那行歌手名
（`.scene-top` 里的 `#trackArtist`）**三种尺寸都显示着**，它当入口一分控制条空间都不占 ——
罐头原话：「现在元素平衡得刚好……点歌手直接跳转，左上角能返回，不需要搜索按钮」。

## 2. 做法

### 2.1 那行字从死的变成活的

`<p class="track-artist">` → `<button class="track-artist" id="trackArtist">`，
视觉与原来一致（`font: inherit` + 显式 13px / 行高 / 颜色），只多一枚 **11px、opacity .4**
的搜索字形（`.ta-go`）作「这里能点」的提示：

- hover：文字下划线（`text-underline-offset: 2px`）+ 字形提到不透明 + 颜色由
  `--cover-text-soft` 提到 `--cover-text`；`:active` 压到 .72。
- `:focus-visible` 给 `--hl-accent` 描边，键盘可达。
- **拿不到歌手时禁用**：`disabled` + `hidden`（没文本就整行收起，不留空行）+ 隐去字形。
  「还没有曲目」时的引导语也走同一条路（`actionable = false`），只是显示不点。
- `width: fit-content` + `max-width: 100%`：命中区就是文字本身那么宽，长歌手名照常换行。

统一由 `setArtistLine(text, actionable)` 管（`ui/app.js`），`renderTrack()` 里两处调用。

### 2.2 点下去发生什么

`openArtistSearch(name)`：

```js
if (searchInput) searchInput.value = name;      // 关键词预填
if (searchPage && searchPage.hidden) openSearch();  // 已填 → openSearch 不再拉推荐区
searchScope = 'artist';                          // 范围切「搜歌手」
renderSearchScope();
doSearch();                                      // 立刻出结果，不用再点搜索
```

即：**一次点击 = 打开 + 预填 + 切范围 + 出结果**。左上角那颗「返回」按既有的分层返回
逻辑退（详情层 → 推荐区根层 → 退出搜索）。

### 2.3 拆掉「离开宽窗就强收搜索页」

`applyLayout()` 里原来有：

```js
if (next !== 'wide' && searchPage && !searchPage.hidden) closeSearch();   // 离开独立窗便收起搜索
```

这条的前提是"卡片里开不了搜索页，留着就是一张野页面"。前提没了，它就变成了 bug：
卡片里（尤其宿主 ResizeObserver 一抖）会把用户刚开的搜索页误杀。已删，退出交给「返回」。

## 3. 窄卡（312×494）实测

头部 `flex-wrap` 自然折成三行，没有横溢：

| 行 | 内容 |
|---|---|
| 1 | 返回 + 输入框（**185px**）+ 搜索按钮 |
| 2 | 平台条：网易云 / B站 / QQ / 酷狗（一行放得下） |
| 3 | 范围：搜歌曲 / 搜歌手 |

下面就是结果列表 + 底部控制条（全程可见可用）。截图存
`/tmp/hap-verify/artist-search-narrow-312x494-light.png`。
罐头拍板先自然折，真机看过再决定要不要为窄卡收一版头部（返回收纯图标 / 平台条改横滑）。

## 4. 验收

`node tools/verify-ui.mjs` → **110/110** 断言、12/12 布局自检、4/4 窄卡自检、零运行时错误。
新增四条（2d 段）：

| 断言 | 证什么 |
|---|---|
| `artist-line-inert-without-artist` | 没歌手时是 `<button>` 但 `hidden` + `disabled`、高度 0、字形不显示 |
| `artist-line-clickable-with-artist` | 有歌手时可见可点、名字对、`aria-label = 搜索歌手：X`、字形显示 |
| `artist-search-opens-and-searches` | 点一下：开、`scope=artist`、关键词预填、已出结果、推荐区隐去、标题「歌手结果」 |
| `artist-search-usable-in-narrow-card` | 312×494 里同一个入口也开得了；不横溢；返回键与输入框都在 |

## 5. 真机待看

1. 歌手名后面那枚 11px 字形在浅/深封面上的可见度 —— 嫌它动到「元素平衡」就摘掉，
   只留 hover 下划线（一行 CSS）。
2. 触屏（无 hover）下这行的可发现性 —— 靠的就是那枚字形。
3. 窄卡头部三行会不会显得高（真机上如果挡结果，就上收一版头部）。
