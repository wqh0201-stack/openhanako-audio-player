/**
 * lib/cookies.js — 播放凭证读取。
 *
 * v1 用 cookies.env 文件（放在插件目录）存网易云/腾讯的登录 cookie，
 * 用来向 full-url 端点换取完整音频（绕开试听限制）。
 *
 * v2 里安装目录只读，所以文件移到可写的 app-data：
 *   app-data/hanako-audio-player/cookies.env
 *
 * 格式（每行一条，`#` 开头是注释）：
 *   NETEASE_COOKIE=MUSIC_U=xxx; __csrf=xxx; ...
 *   TENCENT_COOKIE=uin=xxx; qqmusic_key=xxx; ...
 *
 * 没有文件或没有对应条目 → 空串，full-url 端点自然回退试听版，不报错。
 */
import fs from "node:fs";
import path from "node:path";

export function loadCookies(dataDir) {
  const out = { NETEASE_COOKIE: "", TENCENT_COOKIE: "" };
  try {
    const cookiePath = path.join(dataDir, "cookies.env");
    if (!fs.existsSync(cookiePath)) return out;
    const raw = fs.readFileSync(cookiePath, "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = /^([A-Z_]+)=(.*)$/.exec(line.trim());
      if (!m || !m[2].trim()) continue;
      if (m[1] === "NETEASE_COOKIE") out.NETEASE_COOKIE = m[2].trim();
      if (m[1] === "TENCENT_COOKIE") out.TENCENT_COOKIE = m[2].trim();
    }
  } catch (e) {
    console.warn("[audio-player] cookies.env load failed:", e.message);
  }
  return out;
}
