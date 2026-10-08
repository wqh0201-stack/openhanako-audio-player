/**
 * tools/play.js — 把音频加入队列，并在聊天流里投递一张播放卡。
 *
 * 卡片走**工具返回值** `details.card`（宿主契约：plugin-stream-card-registry），
 * 不走 session:send-custom。后者要求跨会话分区写入（scope:"all" +
 * app/sessions.manage + app/session.start-turn），而工具返回值这条根本不需要
 * 任何会话权限 —— v1 插件的同名工具就是这么做的。
 *
 * v2 工具形状：execute 是单参数调用
 *   execute({ ...参数, context: { sessionPath, messageId, messageText?, callToken? } })
 * 没有第二个参数。
 */

import fs from "node:fs";
import path from "node:path";

const NAME = "audio_play";

const DESCRIPTION =
  "播放音乐：把音频加入播放器列表，并在当前会话投递一张播放卡片。" +
  "source 要是真实存在的本地音频文件绝对路径，或可访问的在线音频 URL（http/https）。" +
  "不支持歌名、歌手、随机等口语描述——这些无法播放。若用户想随机播放，先调用 audio_list_music 查看曲目，" +
  "再把返回的 source 原样传给本工具。";

const PARAMETERS = {
  type: "object",
  properties: {
    source: {
      type: "string",
      description:
        "可播放的音频资源：本地音频文件绝对路径（如 C:/Music/song.mp3），或在线音频 URL（http/https）。",
    },
    title: {
      type: "string",
      description: "曲目名称（可选，用于播放列表与卡片显示）。",
    },
  },
  required: ["source"],
};

function deriveTitle(source) {
  const tail = String(source).split("/").pop()?.split("\\").pop() ?? "";
  const clean = tail.split("?")[0].replace(/\.[a-z0-9]{2,5}$/i, "");
  return clean || "音频";
}

function isRemote(source) {
  return /^https?:\/\//i.test(source);
}

export function makePlayTool(ctx, state) {
  // ctx 不直接给 appId，但 dataDir 的末段就是它（{HANA_HOME}/app-data/<appId>）。
  const appId = path.basename(ctx.dataDir) || "app";
  const playlistPath = path.join(ctx.dataDir, "playlist.json");

  /**
   * 把曲目追加进播放列表。
   *
   * UI 读的就是这份文件（`/widget/api/playlist`），所以工具和界面看到的是同一
   * 份列表。v1 里 play 写 queue.json、UI 读 playlist.json，两个仓 —— 结果工具
   * 播的歌在界面上看不到。v2 不再延续这个分裂。
   *
   * 前端每 30 秒会拉取并合并一次，所以这里的写入不会与它冲突；真正同时发生时
   * 最坏也只是等下一轮合并回来。
   */
  function appendToPlaylist(entry) {
    let list = [];
    try {
      if (fs.existsSync(playlistPath)) {
        list = JSON.parse(fs.readFileSync(playlistPath, "utf-8"));
      }
    } catch (err) {
      ctx.logger?.warn?.(`audio_play: 读取播放列表失败 ${err?.message || err}`);
    }
    if (!Array.isArray(list)) list = [];

    const at = list.findIndex((t) => t && t.url === entry.url);
    if (at >= 0) list[at] = { ...list[at], ...entry };
    else list.push(entry);

    try {
      fs.writeFileSync(playlistPath, JSON.stringify(list, null, 2), "utf-8");
    } catch (err) {
      ctx.logger?.warn?.(`audio_play: 写入播放列表失败 ${err?.message || err}`);
    }
  }

  return {
    name: NAME,
    description: DESCRIPTION,
    parameters: PARAMETERS,

    async execute({ source, title, context } = {}) {
      if (!source || typeof source !== "string" || !source.trim()) {
        return { content: [{ type: "text", text: "请指定要播放的音频文件路径或在线 URL。" }] };
      }

      const src = source.trim();
      const name = (title || "").trim() || deriveTitle(src);
      const remote = isRemote(src);

      appendToPlaylist({
        name,
        url: src,
        mode: remote ? "在线" : "本地",
        dur: 0,
        group: remote ? "在线音乐" : "本地音乐",
      });

      // 记住这次调用所在的会话：卡片自己拿不到 sessionPath（hana.surface.getContext
      // 只给 appId/slot/cardInstanceId），歌词横幅只能靠这里带下去。
      const sessionPath = typeof context?.sessionPath === "string" ? context.sessionPath : "";
      if (sessionPath) state.setBannerSession(sessionPath);

      // 每个会话只投一次播放卡：同一会话反复播歌不再堆卡。
      // 关掉卡后想再看播放器，从卡片中心打开即可（manifest 里已声明）。
      const alreadyDelivered = sessionPath ? await state.hasDeliveredCard(sessionPath) : false;
      if (sessionPath && !alreadyDelivered) state.markDeliveredCard(sessionPath);

      return {
        content: [{ type: "text", text: `🎵 ${name}` }],

        // 聊天流卡。契约字段：pluginId / type / route 必填。
        //
        // channel: "app" 不能省。前端（SendButton 里的 el() 组件）拿它做分支：
        //   h = card.channel === "app"
        //   url = Ns(pluginId, route, h ? "app" : void 0)
        // 没有这个字串时它会按 v1 插件的路径去拼地址，而这是 v2 app —— 拼出来
        // 的 URL 不存在，iframe 就白屏。黑板卡的 channel 由宿主盖章；流内卡不会，
        // 宿主那段规范化对缺字段的卡是「原样返回」，不补默认值。
        //
        // route 指向**原版 UI**（index.html，从 v1 getWidgetHTML 原样移植的那份），
        // 不是早期那套 40 行骨架。两者曾经并存过一阵，投递时挂的是骨架，
        // 导致“卡片中心看到原版、对话里却是骨架”。
        //
        // ?view=compact 是后来加的：对话流里只要一张**浓缩单曲卡**，
        // 不要整页播放器。同一份页面渲染两个壳（同一个播放内核），
        // 不用另起 compact.html —— 那会重演上面那种双实现。
        // 卡片中心 / 拆窗走 manifest 里声明的 /index.html（完整壳，无参数）。
        // 页面自己也会按挂载位兜底判一次（流内卡 → 浓缩），所以这条 query
        // 即使漏了也不会回到整页形态。
        //
        // aspectRatio 故意不写。理由有两条：
        //   1) 这个字段在前端要求是**字符串**（Nn() 里 e.split(":")），
        //      而注册表那边要数字——两端契约不同，写错任一侧都会出错；
        //   2) 省略时“这一层什么都不做”，由内容自己决定高度，
        //      这也是没把握时的正确选择。需要固定比例时再补 "W:H" 形式的字符串。
        ...(alreadyDelivered ? {} : {
          details: {
            card: {
              type: "iframe",
              pluginId: appId,
              channel: "app",
              route: "/index.html?view=compact",
              title: name,
            },
          },
        }),
      };
    },
  };
}
