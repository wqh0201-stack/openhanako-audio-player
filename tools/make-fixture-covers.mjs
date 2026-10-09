#!/usr/bin/env node
/* ============================================================
   tools/make-fixture-covers.mjs — 生成 verify-ui 用的封面夹具（开发用）

   为什么不用现成图：深色封面夹具必须是「右缘确实深」的图，才能验证
   「深底 → 浅字」这条分支；随手找的图不可控也不可复现。这里纯 Node
   （zlib 手写 PNG）生成，无第三方依赖。

   用法：node tools/make-fixture-covers.mjs
   产出：docs/player-ui/assets/demo-cover-dark.png（1024×1024，深色夜景）
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outDir = path.join(repo, 'docs/player-ui/assets');

/* ---------- 最小 PNG 编码器（8bit RGB，无隔行） ---------- */
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function encodePNG(w, h, rgb) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  // 每行前置 filter 字节 0（None）
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    const src = y * w * 3, dst = y * (1 + w * 3);
    raw[dst] = 0;
    rgb.copy(raw, dst + 1, src, src + w * 3);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---------- 深色封面：夜景。右缘必须确实深（验证「深底→浅字」） ---------- */
const W = 1024, H = 1024;
const buf = Buffer.alloc(W * H * 3);
let seed = 20261009;
function rnd() { // 确定性伪随机（xorshift），保证每次生成同一张图
  seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
  return ((seed >>> 0) % 100000) / 100000;
}
const TOP = [9, 13, 26], BOT = [24, 17, 30];
const GLOW = { x: 0.60, y: 0.74, r: 0.46, c: [78, 44, 26] };
for (let y = 0; y < H; y++) {
  const t = y / (H - 1);
  for (let x = 0; x < W; x++) {
    const u = x / (W - 1);
    let r = TOP[0] + (BOT[0] - TOP[0]) * t;
    let g = TOP[1] + (BOT[1] - TOP[1]) * t;
    let b = TOP[2] + (BOT[2] - TOP[2]) * t;
    // 右下暖光：地平线余晖
    const dx = u - GLOW.x, dy = t - GLOW.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const k = Math.max(0, 1 - d / GLOW.r) ** 2;
    r += GLOW.c[0] * k; g += GLOW.c[1] * k; b += GLOW.c[2] * k;
    // 细颗粒，避免死板
    const n = (rnd() - 0.5) * 9;
    const i = (y * W + x) * 3;
    buf[i] = Math.max(0, Math.min(255, Math.round(r + n)));
    buf[i + 1] = Math.max(0, Math.min(255, Math.round(g + n)));
    buf[i + 2] = Math.max(0, Math.min(255, Math.round(b + n)));
  }
}
fs.mkdirSync(outDir, { recursive: true });
const out = path.join(outDir, 'demo-cover-dark.png');
fs.writeFileSync(out, encodePNG(W, H, buf));
console.log('wrote', out, `${W}x${H}`, fs.statSync(out).size, 'bytes');

/* ---------- 浅色封面：晨雾。竖版卡下封面贴左裁切，屏上可见的是「左侧一条」，
 * 所以这张必须整张都浅（含左缘），才能稳定走「浅纱 + 墨字」支路。 ---------- */
seed = 20261010;
const buf2 = Buffer.alloc(W * H * 3);
const LTOP = [236, 232, 224], LBOT = [206, 214, 220];
const LGLOW = { x: 0.30, y: 0.40, r: 0.55, c: [24, 18, 12] };   // 柔和暖雾（不是暗块）
for (let y = 0; y < H; y++) {
  const t = y / (H - 1);
  for (let x = 0; x < W; x++) {
    const u = x / (W - 1);
    let r = LTOP[0] + (LBOT[0] - LTOP[0]) * t;
    let g = LTOP[1] + (LBOT[1] - LTOP[1]) * t;
    let b = LTOP[2] + (LBOT[2] - LTOP[2]) * t;
    const dx = u - LGLOW.x, dy = t - LGLOW.y;
    const d = Math.sqrt(dx * dx + dy * dy);
    const k = Math.max(0, 1 - d / LGLOW.r) ** 2;
    r -= LGLOW.c[0] * k; g -= LGLOW.c[1] * k; b -= LGLOW.c[2] * k;
    const n = (rnd() - 0.5) * 7;
    const i = (y * W + x) * 3;
    buf2[i] = Math.max(0, Math.min(255, Math.round(r + n)));
    buf2[i + 1] = Math.max(0, Math.min(255, Math.round(g + n)));
    buf2[i + 2] = Math.max(0, Math.min(255, Math.round(b + n)));
  }
}
const out2 = path.join(outDir, 'demo-cover-light.png');
fs.writeFileSync(out2, encodePNG(W, H, buf2));
console.log('wrote', out2, `${W}x${H}`, fs.statSync(out2).size, 'bytes');
