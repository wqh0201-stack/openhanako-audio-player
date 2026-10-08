/**
 * lib/state.js — 播放队列与当前曲目。
 *
 * ponytail: 单例状态。多会话同时播不同曲目会互相覆盖；沙盒阶段够用，
 * 真要并行播放时改成 Map<sessionPath, state>。
 */

const STATE_KEY = "player-state";
const SESSION_KEY = "banner-session";

export function createPlayerState({ storage, logger }) {
  let state = { track: null, queue: [] };
  let loaded = false;
  let bannerSessionPath = null;
  let sessionLoaded = false;

  // 已投过播放卡的会话：同一会话不重复投卡，避免堆一串。
  // 宿主没给普通 App 关闭自己卡片的权限（APPS.md：只有显式关闭、
  // 项目清理或生命周期结束才关闭视图），所以只能从投递端收敛。
  const DELIVERED_KEY = "card-delivered";
  let delivered = {};
  let deliveredLoaded = false;

  async function loadDelivered() {
    if (deliveredLoaded) return delivered;
    deliveredLoaded = true;
    try {
      const raw = await storage?.get(DELIVERED_KEY);
      if (raw && typeof raw === "object" && !Array.isArray(raw)) delivered = raw;
    } catch (err) {
      logger?.warn?.(`delivered load failed: ${err?.message || err}`);
    }
    return delivered;
  }

  async function load() {
    if (loaded) return state;
    loaded = true;
    try {
      const raw = await storage?.get(STATE_KEY);
      if (raw && typeof raw === "object" && Array.isArray(raw.queue)) {
        state = { track: raw.track ?? null, queue: raw.queue };
      }
    } catch (err) {
      logger?.warn?.(`state load failed: ${err?.message || err}`);
    }
    return state;
  }

  /**
   * 会话粘性：把绑定的会话持久化。
   *
   * 卡片拿不到 sessionPath（宿主只给 appId/slot/cardInstanceId，SDK 也没有
   * 任何 session API），所以只能靠工具调用把它存下来。
   * 但存内存里重启就没了 —— 用户从卡片点播时又拿不到会话，横幅就死了。
   * 落盘后：只要在对话里播过一次，之后长期有效（含重启）。
   */
  async function loadSession() {
    if (sessionLoaded) return bannerSessionPath;
    sessionLoaded = true;
    try {
      const raw = await storage?.get(SESSION_KEY);
      if (raw && typeof raw === "object" && typeof raw.path === "string") {
        bannerSessionPath = raw.path.trim() || null;
      }
    } catch (err) {
      logger?.warn?.(`banner session load failed: ${err?.message || err}`);
    }
    return bannerSessionPath;
  }

  async function save() {
    try {
      await storage?.set(STATE_KEY, state);
    } catch (err) {
      logger?.warn?.(`state save failed: ${err?.message || err}`);
    }
    return state;
  }

  return {
    async get() {
      await load();
      return { track: state.track, queue: state.queue.slice() };
    },

    async push(track) {
      await load();
      state.queue.push(track);
      state.track = track;
      return save();
    },

    async select(index) {
      await load();
      const track = state.queue[index];
      if (!track) return null;
      state.track = track;
      await save();
      return track;
    },

    /**
     * 记住最近一次工具调用所在的会话，供 banner 推送使用。
     * 卡片自己拿不到 sessionPath（hana.surface.getContext 只给 appId/slot/cardInstanceId）。
     * 这里异步落盘，让粘性跨重启保持。
     */
    setBannerSession(path) {
      const p = typeof path === "string" && path.trim() ? path.trim() : null;
      if (!p || p === bannerSessionPath) return;
      bannerSessionPath = p;
      sessionLoaded = true;
      Promise.resolve(storage?.set(SESSION_KEY, { path: p })).catch((err) => {
        logger?.warn?.(`banner session save failed: ${err?.message || err}`);
      });
    },
    async bannerSession() {
      return await loadSession();
    },
    /** 卡片侧查询：当前有没有绑过会话（供 UI 提示用）。 */
    async hasBannerSession() {
      return !!(await loadSession());
    },

    /** 这个会话是否已经投过播放卡。 */
    async hasDeliveredCard(sessionPath) {
      const p = typeof sessionPath === "string" ? sessionPath.trim() : "";
      if (!p) return false;
      const map = await loadDelivered();
      return !!map[p];
    },

    /** 标记这个会话已投过播放卡。 */
    markDeliveredCard(sessionPath) {
      const p = typeof sessionPath === "string" ? sessionPath.trim() : "";
      if (!p) return;
      delivered[p] = Date.now();
      deliveredLoaded = true;
      Promise.resolve(storage?.set(DELIVERED_KEY, delivered)).catch((err) => {
        logger?.warn?.(`delivered save failed: ${err?.message || err}`);
      });
    },

    /** 卡片上报当前曲目时调用（只改“当前曲目”，不动队列）。 */
    setCurrentTrack({ title, source }) {
      const t = typeof title === "string" ? title.trim() : "";
      if (!t) return;
      const prev = state.track;
      state.track = {
        ...(prev && typeof prev === "object" ? prev : {}),
        title: t,
        source: typeof source === "string" ? source : (prev?.source ?? ""),
      };
      // 落盘（失败不影响播放）
      Promise.resolve(save()).catch(() => {});
    },

    /**
     * 只在“还没绑过会话”时补位。
     * 用于 bus 订阅的保底路径：会话有活动时顺手把会话记下，
     * 但**不抢**已经绑定好的那个（用户可能从别的会话切回来）。
     */
    adoptSessionIfUnbound(path) {
      const p = typeof path === "string" && path.trim() ? path.trim() : null;
      if (!p || bannerSessionPath) return;
      bannerSessionPath = p;
      sessionLoaded = true;
      Promise.resolve(storage?.set(SESSION_KEY, { path: p })).catch((err) => {
        logger?.warn?.(`banner session save failed: ${err?.message || err}`);
      });
    },
  };
}
