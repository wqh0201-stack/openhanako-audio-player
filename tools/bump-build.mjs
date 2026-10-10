#!/usr/bin/env node
/**
 * tools/bump-build.mjs — 构建号三处同步。
 *
 * 原仓库带这个脚本，本机装的是发布包（没带 dev 工具），这里按 README 的契约补一份：
 *   · ui/_build.json               → {"build":"<新号>"}
 *   · ui/index.html                → window.__HANA_BUILD = "<新号>";
 *   · ui/standalone.html           → 同上
 *
 * 新号 = 旧号 + 1（单调递增，纯数字字符串，格式与原号一致）。
 * ⚠️ 页面**不会**自动重载：index.html 里只有 `window.__HANA_BUILD` 标记，没有 _build.json 轮询块。
 * 改完文件必须显式 reload：`extension_manager reload app:hanako-audio-player`，否则用户看到的还是旧版。
 *
 * 用法：node tools/bump-build.mjs [--print]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const uiDir = path.join(root, "ui");
const buildPath = path.join(uiDir, "_build.json");

const oldRaw = fs.readFileSync(buildPath, "utf-8");
const oldBuild = JSON.parse(oldRaw).build;
if (!/^\d+$/.test(String(oldBuild))) {
  console.error(`[bump-build] _build.json 里的 build 不是纯数字：${JSON.stringify(oldBuild)}`);
  process.exit(1);
}
const nextBuild = String(Number(oldBuild) + 1);

if (process.argv.includes("--print")) {
  console.log(`${oldBuild} -> ${nextBuild}`);
  process.exit(0);
}

const targets = ["index.html", "standalone.html"].map((f) => path.join(uiDir, f));
const touched = [];

for (const file of targets) {
  const src = fs.readFileSync(file, "utf-8");
  const re = /(window\.__HANA_BUILD\s*=\s*")(\d+)(")/;
  const m = src.match(re);
  if (!m) {
    console.error(`[bump-build] ${path.basename(file)} 里找不到 window.__HANA_BUILD = "…"，跳过`);
    continue;
  }
  if (m[2] !== String(oldBuild)) {
    console.warn(`[bump-build] ${path.basename(file)} 里的号是 ${m[2]}，与 _build.json 的 ${oldBuild} 不一致，仍会写成 ${nextBuild}`);
  }
  fs.writeFileSync(file, src.replace(re, `$1${nextBuild}$3`), "utf-8");
  touched.push(path.basename(file));
}

fs.writeFileSync(buildPath, JSON.stringify({ build: nextBuild }), "utf-8");

console.log(`[bump-build] ${oldBuild} -> ${nextBuild}  (同步: _build.json, ${touched.join(", ")})`);
