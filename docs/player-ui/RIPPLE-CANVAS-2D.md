# Canvas 2D 指针涟漪：方案与可粘贴实现

日期：2026-10-10。本文是独立替换模块的方案与代码，尚未接入生产 UI。

## A. 技术选型

建议使用 **Canvas 2D 扩散圆环**。在播放器的安静留白风格里，真实折射的收益不足以抵消逐像素处理的成本。重点应放在指针落波的节奏、淡出和停止调度上。

| 方案 | 观感 | 主要成本 | 建议 |
|---|---|---|---|
| 扩散圆环 | 清淡、抽象，直接响应指针 | 每帧清画布，绘制十几条圆弧 | 推荐 |
| 双缓冲高度场，仅绘制明暗 | 波传播、叠加、干涉 | 遍历模拟网格，再生成图像 | 可以，但未必更好看 |
| 双缓冲高度场 + 封面折射 | 封面像水下倒影一样扭曲 | 模拟、计算梯度、重采样图片、上传像素 | 不建议常驻 |

### 高度场能否不用 WebGL

可以。用两个 `Float32Array` 保存当前和上一时刻的高度，邻域差分推进波，再用高度梯度偏移图片采样坐标，最后通过 `putImageData()` 输出。

但高度场只产生高度，不会自动产生折射；昂贵的是后续逐像素重采样。透明 Canvas 也不能直接折射下面的 DOM，需要把封面作为图像源重新绘制。

跨源图片还会带来读像素限制：无 CORS 的封面画进 Canvas 后，`getImageData()` 会抛出 `SecurityError`。参考：[MDN：跨源图片与 Canvas](https://developer.mozilla.org/en-US/docs/Web/HTML/How_to/CORS_enabled_image)。

1040×780、DPR 2 对应约 **324 万像素/帧**；60 帧约为每秒 1.95 亿个像素位置，还没算邻域、插值和输出。降低模拟分辨率能减少模拟成本，但若折射仍全分辨率输出，那部分成本还在。

若要试高度场，建议限制在封面区域，先用约 `260×195` 网格、30Hz 模拟及低分辨率输出放大，作为可选实验效果。

## B. 可粘贴实现

无库、无构建、无 CDN、无 WebGL；使用 ES5 语法与 Chromium 原生 API。

### 行为约定

- 移动累计到一定距离才落波，同时限制落波频率。
- 按下产生更大的一圈。
- 播放且空闲时，间隔数秒缓慢起波；等待期间没有 rAF。
- 暂停后约 **350ms** 收敛，随后停止；`pause(true)` 可立即停止。
- 截图模式冻结当前帧，退出后续接；截图期间 resize 延后处理。
- reduced-motion 立即清空并关闭；页面隐藏、离开视口时停止调度。
- 暂停期间忽略指针，不会被鼠标重新唤醒。
- 触屏移动不生成连续涟漪，避免把歌词滚动误当成水面交互；按下仍可产生一圈。

### HTML

放在 `.scene` 内，替代旧频谱效果。

```html
<canvas class="ripple-canvas" aria-hidden="true"></canvas>
```

### CSS

放在现有样式后。

```css
.scene {
  position: relative;
  overflow: hidden;
  isolation: isolate;
}

/* 明确层级：封面 → 涟漪 → 蒙层 → 文字 */
.scene > .cover {
  z-index: 1;
}

.scene > .ripple-canvas {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  z-index: 2;
  pointer-events: none;
  color: var(--hl-accent, var(--hk-accent));
}

.scene > .lyric-scrim {
  z-index: 3;
}

.scene > .lyric-wrap,
.scene > .scene-top {
  z-index: 4;
}

@media (prefers-reduced-motion: reduce) {
  .scene > .ripple-canvas {
    display: none;
  }
}
```

`pointer-events:none` 只解决事件穿透，不能解决视觉压字，所以蒙层和文字另放在涟漪上方。没有给整个画布设置低 `opacity`，避免和每条波的透明度重复相乘。

### JavaScript

```js
function initRipples(scene, audio) {
  var canvas = scene.querySelector('.ripple-canvas');
  var ctx = canvas.getContext('2d');
  var reduce = matchMedia('(prefers-reduced-motion: reduce)');
  var waves = [], raf = 0, timer = 0, last = 0;
  var width = 0, height = 0, dpr = 1;
  var playing = !!(audio && !audio.paused && !audio.ended);
  var destroyed = false, inView = true, drain = 0;
  var point = null, distance = 0, emitted = 0, inputAt = 0;
  var dprQuery;
  var pointerOptions = { passive: true, capture: true };
  var MAX_WAVES = 18;

  function shot() { return document.body.classList.contains('is-shot'); }
  function blocked() {
    return destroyed || reduce.matches || shot() || document.hidden ||
      !inView || !width || !height;
  }
  function clear() { ctx.clearRect(0, 0, width, height); }
  function stop() {
    cancelAnimationFrame(raf);
    clearTimeout(timer);
    raf = timer = last = 0;
  }
  function resetPointer() { point = null; distance = 0; }

  function size() {
    if (destroyed || shot()) return; // 截图时连 backing store 都不改
    var w = canvas.clientWidth, h = canvas.clientHeight;
    var ratio = Math.min(window.devicePixelRatio || 1, 2);
    if (w === width && h === height && ratio === dpr) return;
    width = w; height = h; dpr = ratio;
    canvas.width = Math.max(1, Math.round(w * ratio));
    canvas.height = Math.max(1, Math.round(h * ratio));
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    resetPointer();
    if (!blocked()) draw();
  }

  function draw() {
    clear();
    // CSS 负责解析 var() / color-mix()，Canvas 只接收计算后的颜色。
    ctx.strokeStyle = getComputedStyle(canvas).color;
    ctx.lineWidth = 1;
    for (var i = 0; i < waves.length; i++) {
      var w = waves[i], p = w.age / w.life;
      var fade = Math.min(1, w.age / 0.12) * Math.pow(1 - p, 2);
      if (!playing) fade *= Math.max(0, drain / 0.35);
      ctx.globalAlpha = w.alpha * fade;
      ctx.beginPath();
      ctx.arc(w.x * width, w.y * height,
        3 + w.radius * (1 - Math.pow(1 - p, 1.5)), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  function add(x, y, strong) {
    if (waves.length >= MAX_WAVES) waves.shift();
    waves.push({
      x: x, y: y, age: 0,
      life: strong ? 2.4 : 1.8,
      radius: Math.min(180, Math.min(width, height) * 0.32) *
        (strong ? 1.25 : 1),
      alpha: strong ? 0.18 : 0.10
    });
  }

  function breathe() {
    timer = 0;
    if (blocked() || !playing) return;
    // 鼠标仍在缓慢移动时，不让呼吸波与交互争抢。
    if (performance.now() - inputAt < 4500) { schedule(); return; }
    add(0.25 + Math.random() * 0.5, 0.3 + Math.random() * 0.4, false);
    wake();
  }
  function schedule() {
    if (!timer && playing && !blocked()) {
      timer = setTimeout(breathe, 5000 + Math.random() * 2500);
    }
  }
  function wake() {
    if (blocked() || (!playing && drain <= 0)) return;
    if (!waves.length) { schedule(); return; }
    clearTimeout(timer); timer = 0;
    if (!raf) {
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }
  function frame(now) {
    raf = 0;
    if (blocked()) { stop(); return; }
    var dt = Math.min(0.05, Math.max(0, (now - last) / 1000));
    last = now;
    if (!playing) {
      drain = Math.max(0, drain - dt);
      if (!drain) { waves.length = 0; clear(); return; }
    }
    for (var i = waves.length - 1; i >= 0; i--) {
      waves[i].age += dt;
      if (waves[i].age >= waves[i].life) waves.splice(i, 1);
    }
    draw();
    if (waves.length) raf = requestAnimationFrame(frame);
    else { last = 0; schedule(); }
  }

  function sync() {
    if (destroyed) return;
    stop(); resetPointer();
    if (reduce.matches) { waves.length = 0; drain = 0; clear(); return; }
    if (shot()) return; // 保留最后一帧及波的年龄
    size();
    if (!blocked()) { draw(); wake(); }
  }
  function resume() {
    if (destroyed || playing) return;
    playing = true; drain = 0; sync();
  }
  function pause(immediate) {
    if (destroyed) return;
    // audio 的事件对象不视作 immediate。
    if (!playing && immediate !== true) return;
    playing = false;
    drain = immediate === true ? 0 : 0.35;
    if (immediate === true) waves.length = 0;
    sync();
  }

  function position(e) {
    var r = canvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) / r.width,
             y: (e.clientY - r.top) / r.height, t: performance.now() };
  }
  function allowed(e) {
    return playing && !blocked() && e.isPrimary !== false &&
      e.pointerType !== 'touch'; // 不把触屏滚动转成连续涟漪
  }
  function move(e) {
    if (!allowed(e)) return;
    var p = position(e);
    inputAt = p.t;
    if (point) {
      var dx = (p.x - point.x) * width;
      var dy = (p.y - point.y) * height;
      var step = Math.sqrt(dx * dx + dy * dy);
      var speed = step / Math.max(1, p.t - point.t);
      distance = speed >= 0.06 ? distance + step : 0;
      // 累计路程，不能只检查相邻 pointermove 的距离。
      if (distance >= 16 && p.t - emitted >= 60) {
        add(p.x, p.y, false);
        distance = 0; emitted = p.t; wake();
      }
    }
    point = p;
  }
  function down(e) {
    if (!playing || blocked() || e.isPrimary === false || e.button !== 0) return;
    var p = position(e);
    inputAt = p.t;
    add(p.x, p.y, true); wake();
  }

  function watchDpr() {
    if (dprQuery) dprQuery.removeEventListener('change', dprChanged);
    dprQuery = matchMedia('(resolution: ' + window.devicePixelRatio + 'dppx)');
    dprQuery.addEventListener('change', dprChanged);
  }
  function dprChanged() { watchDpr(); sync(); }
  var resize = new ResizeObserver(sync);
  resize.observe(canvas);
  var visibility = new IntersectionObserver(function (entries) {
    inView = entries[0].isIntersecting; sync();
  });
  visibility.observe(canvas);
  var classes = new MutationObserver(sync);
  classes.observe(document.body, { attributes: true, attributeFilter: ['class'] });
  reduce.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('resize', sync);
  scene.addEventListener('pointermove', move, pointerOptions);
  scene.addEventListener('pointerdown', down, pointerOptions);
  scene.addEventListener('pointerleave', resetPointer, pointerOptions);
  scene.addEventListener('pointercancel', resetPointer, pointerOptions);
  if (audio) {
    audio.addEventListener('play', resume);
    audio.addEventListener('pause', pause);
    audio.addEventListener('ended', pause);
    audio.addEventListener('emptied', pause);
  }
  watchDpr(); sync();

  return {
    resume: resume,
    pause: pause,
    destroy: function () {
      if (destroyed) return;
      destroyed = true; stop(); waves.length = 0; clear();
      resize.disconnect(); visibility.disconnect(); classes.disconnect();
      reduce.removeEventListener('change', sync);
      dprQuery.removeEventListener('change', dprChanged);
      document.removeEventListener('visibilitychange', sync);
      window.removeEventListener('resize', sync);
      scene.removeEventListener('pointermove', move, pointerOptions);
      scene.removeEventListener('pointerdown', down, pointerOptions);
      scene.removeEventListener('pointerleave', resetPointer, pointerOptions);
      scene.removeEventListener('pointercancel', resetPointer, pointerOptions);
      if (audio) {
        audio.removeEventListener('play', resume);
        audio.removeEventListener('pause', pause);
        audio.removeEventListener('ended', pause);
        audio.removeEventListener('emptied', pause);
      }
    }
  };
}
```

### 初始化与释放

在 DOM 就绪后初始化一次：

```js
var ripples = initRipples(
  document.querySelector('.scene'),
  document.getElementById('audio')
);

// 自动跟随 audio 的播放、暂停、结束，也可手动控制：
// ripples.pause();      // 短暂收敛后停止
// ripples.pause(true);  // 立即清空、停止；截图冻结优先
// ripples.resume();     // 恢复效果，不负责启动音频
// ripples.destroy();    // 卸载时释放监听器、观察器和调度
```

`capture:true` 只是**在事件捕获阶段旁听**，不是 `setPointerCapture()`。没有 `preventDefault()`、`stopPropagation()`，也没有更改 `touch-action`，不会阻断歌词滚动或按钮点击。

### 接入当前仓库

1. 撤掉旧频谱的生成和动画调用，并调整 `syncPanels()` 对旧 `#spectrum` 的引用；不能只删除节点而保留所有旧调用。
2. 仓库已有的 `bindRipple()` 应由本模块替换，避免两套监听器同时运行。
3. 新涟漪不必沿用“有歌词就隐藏频谱”的规则，因为它已经位于文字和蒙层下方。
4. 本效果不读取音频，不需要 `captureStream()`、AnalyserNode 或 `createMediaElementSource()`。若旧分析链只服务于频谱，接入时应清理对应调度和资源；不要影响其他仍在使用音频分析的功能。
5. 实际接入生产代码时，按仓库约定同步两个 HTML、更新构建号并完成验证。本文档本身没有改动或部署生产 UI。

## C. 性能与生命周期

- **最多 18 条波，每条一笔描边。** 不使用阴影、模糊、像素读取或额外合成模式。
- **按经过时间推进。** 不按“每帧增加固定半径”计算，避免高刷新率屏幕上动画加速。
- **DPR 封顶 2。** 像素面积随 DPR 平方增长；大窗口仍需留意整张画布清除和合成的成本。参考：[MDN：devicePixelRatio](https://developer.mozilla.org/en-US/docs/Web/API/Window/devicePixelRatio)。
- **无波就停 rAF。** 播放状态也不例外；呼吸波由一个低频 `setTimeout` 唤醒。
- **暂停后停止新增波。** 仅允许有限的收敛绘制；截图、reduced-motion、后台和离屏取消调度。
- **不要每帧重设 Canvas 尺寸。** 只在尺寸或 DPR 真正变化时重设；也不要每帧申请 `ImageData`。
- 代码每个活动帧读取一次计算后的颜色，能跟随宿主主题；没有在帧内读写页面布局。是否进一步缓存颜色，应以实际测量为准。
- Canvas 2D 避开了自写 WebGL，但 Chromium 仍可能使用 GPU 加速绘制和合成，不能理解为强制纯 CPU。
- `IntersectionObserver` 不保证识别所有被其他 UI 遮住的情况。如果舞台仍占布局空间但被整页浮层覆盖，可由应用主动暂停效果。

### 截图与减少动态效果的区别

- `body.is-shot`：保留当前像素、波年龄与画布尺寸，不响应指针；退出后再应用最新尺寸并续接。初始化就处于截图模式时，画布为空。
- `prefers-reduced-motion: reduce`：清空并关闭整个效果。与截图同时存在时，减少动态效果的关闭要求优先。
- 截图冻结期间调用 `pause(true)` 会停止并清空内部波列表，但冻结的像素会保留至退出截图模式；`destroy()` 则会清空画布并释放资源。

## 验证记录

2026-10-10 使用本机 Chromium 对本实现做了独立验证，以下检查通过：

- 无波时不调度 rAF。
- DPR 3 环境下画布按 DPR 2 创建。
- 指针穿透，底层按钮点击正常。
- 运行中进入截图模式，指针与 resize 不改变冻结像素。
- 退出截图模式后应用延后的尺寸变化。
- 暂停后短暂收敛，随后无 rAF；暂停期间点击不会重启动画。
- 运行中切换 reduced-motion，动画关闭。
- 波自然结束后，呼吸等待期间没有 rAF。
- `destroy()` 后没有残留 rAF。

这些验证针对独立模块，不代表已经接入生产页面或完成 Electron 宿主验收。宿主内的实际帧耗时、浅深主题观感、三种布局及歌词可读性仍需真机验证。
