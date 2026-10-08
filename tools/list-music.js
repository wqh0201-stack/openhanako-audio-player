/**
 * tools/list-music.js — 列出播放器音乐库里的可播曲目。
 *
 * 数据源是 `app-data/<appId>/playlist.json` —— 跟 UI 读的是同一个文件，
 * 也是 v1 的 list_music 读的那一份。工具和界面看到同一份列表，才不会出现
 * “LLM 查到的曲目”和“用户在界面上看到的”是两套东西。
 *
 * v1 只列 http(s) 曲目（本地曲目存的是相对路径，当时 LLM 拿不到完整地址）。
 * v2 修掉这一点：本地曲目的 URL 前缀是已知的，补全后 LLM 可以直接播。
 */

import fs from "node:fs";
import path from "node:path";

const NAME = "audio_list_music";

const DESCRIPTION =
  "列出音频播放器音乐库中的可播曲目（名称 + 可播地址）。" +
  "播放前先调用本工具查找真实存在的曲目，再把返回的 source 原样传给 audio_play。" +
  "支持按关键词、分组过滤。";

const PARAMETERS = {
  type: "object",
  properties: {
    keyword: {
      type: "string",
      description: "可选，按曲目名称过滤，如 钢琴、纯音乐、summer。不传返回全部（截取前 limit 条）。",
    },
    group: {
      type: "string",
      description: "可选，按分组过滤，如 在线音乐 / 本地音乐 / 电台流 / 我的喜欢 / 纯音乐。",
    },
    limit: {
      type: "number",
      description: "返回条数上限，默认 20，最大 50。",
      default: 20,
    },
  },
};

export function makeListMusicTool(ctx) {
  const appId = path.basename(ctx.dataDir) || "app";
  const playlistPath = path.join(ctx.dataDir, "playlist.json");
  const V1_MEDIA_PREFIX = "/api/plugins/hanako-audio-player/";
  const V2_BASE = `/api/apps/${appId}/routes/`;

  /**
   * 把 v1 时期存下的媒体路径规范到 v2。
   * v1 的本地曲目 url 长这样：/api/plugins/hanako-audio-player/widget/media/x.wav
   * 这条路径在 v2 下是 404，原样列给模型等于给了一条播不了的地址。
   */
  function toPlayable(url) {
    const s = String(url || "");
    return s.startsWith(V1_MEDIA_PREFIX) ? V2_BASE + s.slice(V1_MEDIA_PREFIX.length) : s;
  }

  return {
    name: NAME,
    description: DESCRIPTION,
    parameters: PARAMETERS,

    async execute({ keyword, group, limit } = {}) {
      let tracks = [];
      try {
        if (fs.existsSync(playlistPath)) {
          tracks = JSON.parse(fs.readFileSync(playlistPath, "utf-8"));
        }
      } catch (err) {
        ctx.logger?.warn?.(`audio_list_music: 读取播放列表失败 ${err?.message || err}`);
      }
      if (!Array.isArray(tracks)) tracks = [];

      const max = Math.min(Math.max(Number(limit) || 20, 1), 50);
      const kw = String(keyword || "").trim().toLowerCase();
      const grp = String(group || "").trim();

      let hits = tracks.filter((t) => t && typeof t.url === "string" && t.url);
      if (grp) hits = hits.filter((t) => String(t.group || "") === grp);
      if (kw) hits = hits.filter((t) => String(t.name || "").toLowerCase().includes(kw));

      const sample = hits.slice(0, max).map((t) => ({
        name: String(t.name || ""),
        source: toPlayable(t.url),
        group: String(t.group || ""),
      }));

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(
              { total: hits.length, returned: sample.length, tracks: sample },
              null,
              2,
            ),
          },
        ],
      };
    },
  };
}
