# Hana Audio Player（极简重构版）

> 这是 [openhanako-labs/openhanako-audio-player](https://github.com/openhanako-labs/openhanako-audio-player) 的一份**极简重构 fork**：
> 后端沿用上游，前端整个重写、按 Hana 卡片的三种形态重新设计，并砍掉了 PV 舞台 / 黑胶唱盘 / 主题面板。
> 上游以 **AGPL-3.0** 发布（另提供[商业授权](https://github.com/openhanako-labs/openhanako-audio-player/blob/master/COMMERCIAL-LICENSE.md)），
> 本 fork 作为其衍生同样以 **AGPL-3.0** 发布，见 [`LICENSE`](LICENSE)。

## 与上游的差异

| | 上游 | 本 fork |
|---|---|---|
| 前端 | `ui/index.html` 单文件（约 734 KB） | 拆成 `index.html` + `app.js` + `style.css`，状态由 `data-*` 驱动，无构建 |
| 视觉 | 三模式胶囊：标准（黑胶唱盘）/ PV（文字排版舞台）/ 歌词 | 单一形态、按卡片三态自适应：窄长卡 / 矮卡 / 宽窗 |
| 主题 | 内置配色面板 + 多套预设 | 只跟随宿主 `hana.theme`（+ macOS 深浅兜底），不自带面板 |
| 构建 | `pv/build.mjs` 幂等流水线 + `pv/release.mjs` 出双包（含 PV / lite） | 无构建；`tools/bump-build.mjs` 只管构建号 |
| 取源 | `music/go/:id` 302 跳到 CDN | 改**同源分片流式代理**（跨源媒体接 Web Audio 会被静音） |

## 功能

**播放**
- 本地文件 / 文件夹扫描导入（`.mp3` `.wav` `.ogg` `.flac` `.m4a`），走 Range 流式，拖进度条不卡
- 在线曲目走 meting 公共节点（多节点自动降级）；粘贴链接可导入**整张歌单**或**单曲**
- 播放列表：本地固定文件夹 + 自建导入列表，可切换 / 重命名 / 删除；去重键带上归属，同一首歌可同时存在于多个歌单
- 补全歌手（老数据缺 author 时按标题回查）

**歌词**
- 播放即按曲名自动匹配，多源回退（TTML / LRC）
- 匹配过的歌词自动落盘（`app-data/lyrics/`），离线也能出词
- 歌词横幅：当前行实时推到会话输入框上方

**视觉**
- 封面主色调背景 + 歌词两态薄纱；当前句高亮（颜色 + 字重），窄卡只显当前句 ±1 行
- 无歌词时自动切频谱；接真音频（`AnalyserNode`）随乐律动，建链失败则退回装饰循环
- 动效：歌词 ⇄ 频谱交叉淡入淡出、队列进出场、按钮按压反馈 —— 两条底线是**可打断**且**只动 `transform` / `opacity`**

## 安装

1. 把本仓库目录放进 `<HANA_HOME>/apps/hanako-audio-player`（目录名须与 `manifest.id` 一致）
2. Hana → Market → Installed → 批准该应用
3. 之后改代码只需在详情页 Reload

最低 Hana 版本：`0.946.2`。

> 包 id 与上游相同（`hanako-audio-player`），**两者不能同时装**。

## 可选：完整音源

在 `app-data/hanako-audio-player/cookies.env` 里配置登录 cookie，可向 full-url 端点换完整音频（没有则回退试听版）：

```
NETEASE_COOKIE=MUSIC_U=xxx; __csrf=xxx; ...
TENCENT_COOKIE=uin=xxx; qqmusic_key=xxx; ...
```

## 开发

```
ui/index.html            卡片页
ui/standalone.html       独立窗页（内容与 index.html 相同，仅 data-shell 不同）
ui/app.js                全部逻辑（ES5，无构建）
ui/style.css             全部样式（三态布局 + 动效）
tools/bump-build.mjs     构建号三处同步（_build.json + index.html + standalone.html）
tools/verify-ui.mjs      无头验收：布局自检 + 断言 + 截图
tools/verify-backend.mjs 后端验收：去重键 / DELETE / playback-state / playlist-meta
```

**两条铁律**
- `ui/index.html` 与 `ui/standalone.html` 必须同步改，改完跑 `node tools/bump-build.mjs`
- 无构建步骤：改完 `ui/` 同步进安装目录 + Reload 即可

## 许可

**AGPL-3.0**，见 [`LICENSE`](LICENSE)。本仓库是上游 AGPL-3.0 作品的衍生，因此同样以 AGPL-3.0 分发。
若需闭源或商业使用，请走上游的[商业授权](https://github.com/openhanako-labs/openhanako-audio-player/blob/master/COMMERCIAL-LICENSE.md)。

## 致谢

- 上游 [openhanako-labs/openhanako-audio-player](https://github.com/openhanako-labs/openhanako-audio-player) —— 后端与数据链路
- [AMLL TTML DB](https://github.com/Steve-xmh/amll-ttml-db) —— 歌词数据库
- Meting 公共节点 —— 搜索 / 歌词 / 直链
