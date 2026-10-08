# 已知基线 · build 1003131534

> 这是**当前线上运行**的版本。重构以它为起点，**别把它当成"坏掉的老版本"**——
> 一批布局与主题问题已经在这里修好了，回退它们等于白干。

---

## 一、视觉基调（已定，重构不换）

**基调 = 跟随宿主 Hana 的主题，不要自己另起一套。** 宿主通过 `hana.theme`
（快照 + 订阅，`{ theme, cssUrl }`）提供当前主题；SDK **默认就会**把宿主主题
样式表注进页面（`ui/sdk.js` 里的 `followHostTheme` → `applyHostThemeStylesheet`，
`followHostTheme` 默认开）。所以重构时**别定义同名 `--bg/--text/--accent` 去盖宿主**。

两套观感（浅 / 夜间）：

| 维度 | 浅色（纸感） | 夜间（深板岩） |
|---|---|---|
| 底 | 纸 `#F8F4ED` | 深板岩 `#34424B` |
| 面 / 选中底 | 卡面 `#FFFDF7` | 浅板岩 `#414D56` |
| 墨 / 文字 | `#2A2622`（次级 `#6B6158`） | `#E1EAF0`（次级 `#9FB1BC`） |
| **强调色** | 远山蓝 `#537D96` | **藕荷粉 `#C99AAF`** |
| 强调用法 | 只用在「当前 / 激活 / 强调」 | 同左（**"选中变粉色"**） |
| 几何 | 小圆角约 5px（图 8px + 白边） | 同左 |
| 图标 | 只 SVG 线描，禁 emoji | 同左 |

> 夜间的三个值（`#34424B` / `#414D56` / `#C99AAF`）是从一张小截图里**采的近似**，
> 权威值以 `hana.theme` 签发的 cssUrl 为准，**别硬编码**。

⚠️ **别把两套皮搞混**：`house-style.md` 那套（纸 / 墨 / 远山蓝）是**卡片与文档**
的审美；Hana **App 界面**（侧栏、选中态）是另一套（深板岩 + 藕荷粉）。
播放器活在界面里，**跟随宿主**，别自己定第三套色。

权威：`~/.hanako/recipes/hana-folio/references/house-style.md`（卡片面）
+ 宿主 `hana.theme`（运行时主题）。

## 二、这一版已经修好的（重构时别回退）

| 项 | 现状 |
|---|---|
| **字号缩放** | `html,body{height:calc(100vh / var(--font-scale,1))}` 补偿 `body zoom`；大字号不再把内容撑出容器 |
| **正在播放区虚空** | `.np-info` 从 `flex:1` 改 `flex:0 0 auto` |
| **底部列表归零** | `.tab-content{min-height:96px}`，列表不再被算成 0 高 |
| **歌词双层滚动条** | 正文填满 `.lyrics-section`、section 定上限、正文在 section 内滚（单一滚动容器） |
| **超短窗** | `@media (max-height:620px)` 切成纵向滚动列，各区块给足可用高度 |
| **宽版标题被挤没** | ≥660 时收掉顶栏标题（左栏 300px 塞不下） |
| **纸感主题看不见字** | `applyPreset` 直接落 `data-theme`——原来 `applyTheme` 定义在主 IIFE 内、没挂 `window`，预设的**明暗方向从来没生效过** |
| **预设配色被清** | `clearInlineTheme()` 后发 `hana:theme-reapply`，预设层重写一遍 |
| **浅色主题配色** | `[data-theme="light"]` 换成 Hana 纸/墨/远山蓝（原来是暖黄纸 + 暖金） |
| **缺失的构建工具** | 补了 `tools/bump-build.mjs`（同步 `_build.json` + 两个 html 的 `__HANA_BUILD`） |

## 三、仍然存在（重构要解决的）

- **播放列表很长时，打开后顶部消失、没有滚动条**（同一类高度链问题）。
- 容器尺寸可变的整体适配：大量 `vh`/`vmax`、按"整页"设计的固定高度。
- 响应式只写了一半：`body.bp-narrow` / `bp-wide` 有 JS 在写，**CSS 全文 0 次使用**。

完整根因、目标形态、两步走流程见 **`docs/REFACTOR-BRIEF.md`**。
