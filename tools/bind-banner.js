/**
 * tools/bind-banner.js — 切换歌词横幅的目标会话。
 *
 * 背景：
 * 卡片自己拿不到 sessionPath（hana.surface.getContext 只给 appId/slot/
 * cardInstanceId），所以歌词横幅原本只能"跟随最近一次工具调用的会话"。
 * 用户在多会话间切来切去时，横幅就挂在过时的地方——看起来是"没触发"。
 *
 * 这个工具把切换动作显式化：传一个 sessionPath，插件就把 bannerSession
 * 绑过去。宿主对 ctx.inputBanner.set 的 sessionPath 不做权限过滤
 * （探针实测：接受任意路径，accepted:true），所以这里可以直接信任入参。
 *
 * 副作用：
 * 1) 影响此后所有 /api/lyric-line 的推送目标
 * 2) 不 dismiss 旧会话上的横幅 —— 那个会留在旧会话上，直到旧会话关闭
 *    或下次 dismiss 调用（宿主契约：每个 (sessionPath, app) 只保留一条）
 *
 * 无播放副作用：不动 audio、不动卡片、不动队列。
 */

const NAME = "audio_bind_banner";

const DESCRIPTION =
  "切换歌词横幅的目标会话。之后插件会把当前播放的歌词推到你指定的会话输入框上方。" +
  "不影响正在播放的曲目，也不影响已打开的播放器卡片。" +
  "用于多会话时决定横幅挂在哪里。";

const PARAMETERS = {
  type: "object",
  properties: {
    sessionPath: {
      type: "string",
      description:
        "要挂载横幅的目标会话 JSONL 路径。必须是 Hana 里真实存在的会话，例如 " +
        "C:/Users/Administrator/.hanako/agents/ophelia/sessions/<id>.jsonl",
    },
  },
  required: ["sessionPath"],
};

export function makeBindBannerTool(ctx, state) {
  return {
    name: NAME,
    description: DESCRIPTION,
    parameters: PARAMETERS,

    async execute({ sessionPath } = {}) {
      const p = typeof sessionPath === "string" ? sessionPath.trim() : "";
      if (!p) {
        return {
          content: [{ type: "text", text: "请提供 sessionPath。" }],
        };
      }

      state.setBannerSession(p);

      return {
        content: [
          {
            type: "text",
            text: `✓ 歌词横幅已切到该会话\n${p}`,
          },
        ],
      };
    },
  };
}
