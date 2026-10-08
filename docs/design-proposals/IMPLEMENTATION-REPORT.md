# 前端重构实施报告

## 实施结果

在单文件页面内重写了布局边界：顶栏与控制区保持固定；歌词和播放列表分别拥有滚动容器。宽卡按列显示播放舞台与队列；短卡/紧凑卡以整页方式切换队列；独立窗口用不挤动播放舞台的右侧覆盖抽屉。移除了布局/主题补丁链、应用自带主题面板和全页 `body.zoom`；保留音频反应设置、播放/搜索/导入、分组、收藏、歌词及 PV 等现有业务模块。

歌词播放跟随只更新歌词容器的 `scrollTop`，用户主动浏览时暂停自动跟随；队列刷新不再跳到当前曲目。PV 歌词滚动收敛到各自的轨道容器。切歌会使旧歌词异步请求失效。默认封面/当前封面融合为播放舞台背景。聊天卡片保留顶栏右侧 100×40 CSS px 安全区，所有应用可读文本有 11px 最小字号规则。

## 验证结果

- Build：`1003131538`，由 `node tools/bump-build.mjs` 同步。
- `ui/index.html` 与 `ui/standalone.html` 内容一致，仅相差约定的五行 AudioContext 调试块。
- PV CSS 块 SHA-256：`ca63c6688d4214019aa3c16a071c6302853c9c95aa95db9e24be08a1a2cb8fcf`；PV JS 块 SHA-256：`5ed4cf003fb76955187c7fd75d2af0a7fd2f122f8211579281e6d1784641b3f9`，均与基线完全相同。
- 源码扫描确认没有 `scrollIntoView`、`position: fixed`、`body.style.zoom` 与应用自有 `data-theme` 覆盖。
- 官方 `check_env.mjs --capability tools` 通过；`validate_app.mjs --dir . --json` 通过，0 errors、1 warning：`DYNAMIC_DEPENDENCIES_NOT_PROVEN`。
- 官方 isolated smoke 已尝试，但环境缺少 Electron runner（`HANA_APP_ELECTRON`），脚本报告 `SMOKE_RUNTIME_EXCEPTION`；没有把它记作通过。
- Puppeteer 直接加载实际 `ui/index.html` / `ui/standalone.html`，本地模拟后端 40 首队列和 100 行歌词，无运行时错误。动态测试分两段：第一段在歌词高亮变化期间滚动 40 首队列至队尾，观察到 26 次歌词 DOM 状态变化且队列位置不变；第二段在 531×451 矮卡里进行 20 轮队列开关和列表/搜索页切换，音频未暂停且时间继续前进；另用慢速旧歌词响应切到新曲，确认新曲歌词保留、旧曲歌词不覆盖。
- 视觉页面截图均来自生产 HTML，主题颜色作为测试 fixture 注入；它们是模拟结果，不代表宿主主题桥或 Hana Builder 验收。

截图与程序结果保存在 [`implementation-screenshots/`](implementation-screenshots/)；可复跑脚本为 [`tools/verify-player.mjs`](../../tools/verify-player.mjs)；当前机器可设 `PUPPETEER_CORE` 和 `CHROME_BIN` 指向 Puppeteer Core 与 Chrome。

## 截图

- [长卡浅色 465×930](implementation-screenshots/long-card-light.png)
- [高窄卡浅色 585×1172](implementation-screenshots/tall-card-light.png)
- [宽窗浅色 1040×780](implementation-screenshots/wide-window-light.png)
- [宽窗深色 1040×780](implementation-screenshots/wide-window-dark.png)
- [矮卡队列页 531×451](implementation-screenshots/short-card.png)
- [大字号无歌词 560×616](implementation-screenshots/large-type-no-lyrics.png)
- [模拟回归机器结果](implementation-screenshots/verification.json)

真实 Hana 卡片尺寸分配、宿主主题变化、拆窗回挂和 reload 生命周期仍待 HanaAgent 在隔离的宿主环境执行，详见 [`HANA-TEST-HANDOFF.md`](HANA-TEST-HANDOFF.md)。本次没有部署、没有访问或更改安装目录及 app-data。
