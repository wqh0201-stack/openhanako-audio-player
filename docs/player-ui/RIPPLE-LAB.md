# 涟漪实验室

独立演示文件：`ripple-lab.html`，2026-10-10。

绝对路径：

```text
/Volumes/SSD/hanadesk/hanako-audio-player-simple/docs/player-ui/ripple-lab.html
```

用桌面 Chrome 直接打开即可。HTML / CSS / JavaScript 均内嵌，无构建、无 npm、无外部资源、无网络请求、无 WebGL。源码沿用仓库 AGPL-3.0 许可。本次仅新增演示和说明，没有修改生产 UI 或部署宿主。

## 交互

- 在水面移动指针：连续尾流、密集小波，移动速度和累计路程共同控制落波。
- 在水面按下，或点“落下一滴”：更强的多层波纹。
- “流光”：双缓冲高度场的法线明暗，叠加多层轮廓。
- “等高线”：波场驱动的变形线网，观察波的传播和干涉。
- “回响”：保留多层细线波纹。
- “波澜”：调节强度；默认 1.6。
- “冻结画面”：保留当前画布；`body.is-shot` 同样冻结。
- 右上角按钮仅用于演示深浅主题；生产仍应跟随宿主。

水面是艺术动效，不把它伪装成精确音频测量。初次打开会有一次装饰性欢迎波；没有音频时不生成任何频谱柱。

## 真实音频

### 本页播放本地文件

选择或拖入音频文件，通过本地 blob URL 播放，文件不上传。

```text
<audio> 原始播放路径保持不变
    └─ captureStream()
          └─ MediaStreamAudioSourceNode
                └─ AnalyserNode（不连接 destination）
```

分析流不重复输出声音，不调用不可逆的 `createMediaElementSource()`。`captureStream()` 无权限或不受支持时，显示失败原因，不替换成假的频谱。

真实读数：

- `getFloatFrequencyData()` → 80 段对数频谱、真实峰值保持。
- `getFloatTimeDomainData()` → 波形和 RMS dBFS 电平。
- FFT 4096 点；主频是最大频率 bin 的中心频率，不做插值。
- 主频、音量和实际低频能量均来自分析节点。水面的音频触发使用低频能量相对平滑包络的增长，属于艺术映射，不宣称精准节拍识别。
- 没有输入不画柱；静音数据归零；暂停清空频谱，余波约 400ms 收敛后停止 rAF。
- 播放中即使处于静音段，也需继续采样，才能发现随后恢复的声音。

### 已经在其他应用播放的声音

点击“共享正在播放的音频”，调用 `getDisplayMedia({video:true,audio:true,systemAudio:'include'})`。必须由用户在共享弹窗中选择来源并同意。

**请求系统音频不等于一定拿得到。** 是否支持取决于 Chromium 版本、操作系统和 Electron 宿主的共享实现；某些环境只有标签页音频，没有全系统音频。页面检查返回的真实 audio tracks；没有音轨就停止共享并提示，不绘制假频谱。

网页接口要求同时请求视频轨，本页不展示、不录制、不上传画面。共享期间保留轨道，结束时统一停止全部轨道。页面离开也释放共享。

如果是生产播放器自身的 `<audio>`，应在它所在的同一文档里接 `captureStream()`。另一个 HTML / WebView 不能直接读取生产播放器 DOM 或凭空获得其音频。跨源媒体捕获仍受浏览器安全限制。

参考：

- [MDN：captureStream](https://developer.mozilla.org/en-US/docs/Web/API/HTMLMediaElement/captureStream)
- [MDN：AnalyserNode（输出可不连接）](https://developer.mozilla.org/en-US/docs/Web/API/AnalyserNode)
- [MDN：getDisplayMedia](https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getDisplayMedia)

## 性能与生命周期

- 水面网格约每 4.8 CSS px 一个采样，最多 260×160，双 `Float32Array` 高度场。
- 局部高斯扰动、固定步长传播、阻尼、双缓冲交换；低分辨率法线着色后放大，未做封面逐像素折射。
- 最多 22 组波包，每组 4–5 条轮廓；尾流最多 40 点。
- DPR 上限 2；活动帧上限约 60Hz；FFT 读取约 30Hz。
- 无音频且余波消失后停止调度；动态效果减少、页面隐藏、页面离开视口时停止 rAF。
- 系统 reduced-motion 关闭动态显示，但不停止音频播放。
- 截图冻结期间不重设画布 backing store，resize 延后到解冻。
- 演示暴露只读 `window.rippleLab.stats()` 方便检查来源、实际 RMS、主频、绘制耗时和是否正在调度；没有注入虚假分析数据的接口。

## 已做验证

使用本机 Chromium、DPR 2 / 3 环境和独立测试音频进行检查：

- 440 Hz 正弦输入检测到约 441.43 Hz 的 FFT 峰值，符合 bin 分辨率；RMS 约 0.212。
- 静音段 RMS 与最高频谱柱归零，没有装饰性频谱。
- 未加载音频时，频谱值为零。
- 暂停后余波收敛并停止 rAF。
- 冻结期间像素和绘制帧数保持不变。
- 375px 窄屏无横向溢出；DPR 3 下画布封顶为 2。
- 动态切换 reduced-motion 后停止 rAF。
- 无页面 JavaScript 错误。

绘制统计仅计算 JavaScript 提交绘制命令的耗时，不包含完整 GPU/合成耗时，不作为所有设备上的帧率保证。

**未完成的真机项**：浏览器实际授权的系统/标签页音频共享、Electron 宿主共享支持以及生产播放器生命周期集成。本页是可交互演示，不是已部署的生产改造。
