/**
 * lib/register-tools.js — 工具注册 + 会话跟随。
 *
 * v2 没有 contributes.tools[]；工具必须在这里编程式注册。
 * ctx.tools.register 同步返回 disposer。
 */

import { makePlayTool } from "../tools/play.js";
import { makeListMusicTool } from "../tools/list-music.js";
import { makeBindBannerTool } from "../tools/bind-banner.js";

/** 与 register-routes.js 里的 BANNER_ID 保持一致。 */
const BANNER_ID = "audio-player-lyrics";

/**
 * 会让横幅「跟过去」的事件。
 *
 *   session_created —— APPS.md：在「第一次创建」和「已有 session 被重新加载
 *     进运行时缓存（切回一个旧对话）」时都触发。隔离会话（子代理、后台任务）
 *     默认不上总线，天然干净。
 *
 *   message_end —— 补 session_created 的缺口：会话一直在运行时缓存里时，
 *     切回去不触发 session_created。但用户切过去总会说话，所以再听一条
 *     「用户消息」。只认 role === "user"（见回调里的过滤），
 *     assistant / toolResult 的消息不参与。
 *
 * 不用 turn_start：它无字段，分不清用户回合和后台任务。实测记忆摘要任务
 * 会在旧会话上反复触发它，把绑定抢走。
 */
const FOLLOW_EVENT_TYPES = ["session_created", "message_end"];

export function registerTools(ctx, state) {
  // ── 会话跟随 ────────────────────────────────────
  //
  // 两个必须条件（都实测过）：
  //   1. manifest 声明 app/sessions.read；
  //   2. filter 必须显式传。不传时宿主读 undefined.types 抛
  //      `Cannot read properties of null (reading 'types')`，整个 app 加载失败。
  //
  // 切换时顺手 dismiss 掉旧会话上的横幅 —— 宿主契约是每个
  // (sessionPath, app) 持有一条横幅，不主动收的话旧对话上方会一直挂着。
  const disposeFollow = (() => {
    try {
      return ctx.bus.subscribe((event, sessionPath) => {
        const type = event?.type;

        // message_end 只认用户消息：assistant / toolResult 不参与跟随
        if (type === "message_end" && event?.message?.role !== "user") return;

        const next = (typeof sessionPath === "string" && sessionPath.trim())
          || (typeof event?.sessionPath === "string" && event.sessionPath.trim())
          || "";
        if (!next) return;

        Promise.resolve(state.bannerSession())
          .then((prev) => {
            if (prev && prev !== next) {
              try {
                ctx.inputBanner?.dismiss?.({ sessionPath: prev, bannerId: BANNER_ID });
                ctx.logger?.info?.(`[follow] dismissed ${prev}`);
              } catch (err) {
                ctx.logger?.warn?.(`[follow] dismiss failed: ${err?.message}`);
              }
            }
            state.setBannerSession(next);
            ctx.logger?.info?.(`[follow] ${type} → ${next}`);
          })
          .catch((err) => {
            ctx.logger?.warn?.(`[follow] bind failed: ${err?.message}`);
          });
      }, { types: FOLLOW_EVENT_TYPES });
    } catch (err) {
      ctx.logger?.warn?.(`[follow] subscribe failed: ${err?.message}`);
      return () => {};
    }
  })();

  const disposers = [
    makePlayTool(ctx, state),
    makeListMusicTool(ctx, state),
    makeBindBannerTool(ctx, state),
  ].map((tool) => {
    // 包装 execute：工具调用也更新横幅会话（保底路径，与 bus 跟随并行）
    const originalExecute = tool.execute;
    tool.execute = async (args) => {
      const sessionPath = typeof args?.context?.sessionPath === "string"
        ? args.context.sessionPath.trim() : "";
      if (sessionPath) state.setBannerSession(sessionPath);
      return originalExecute(args);
    };
    return ctx.tools.register(tool);
  });

  return () => {
    try { disposeFollow?.(); } catch { /* teardown */ }
    for (const off of disposers) {
      try { off?.(); } catch { /* fiber teardown */ }
    }
  };
}
