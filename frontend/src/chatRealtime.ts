import {api, getSessionUserId} from "./api";
import {API_ORIGIN} from "./config";
import {parseChatFrame, reconnectDelay, ChatRealtimeEvent, ChatConnectionStatus} from "./chatRealtimeCore";
export type {ChatRealtimeEvent, ChatConnectionStatus} from "./chatRealtimeCore";

const listeners = new Map<string, Set<(event: ChatRealtimeEvent) => void>>();
export function subscribeChatEvents(uid: string, listener: (event: ChatRealtimeEvent) => void) {
  const account = listeners.get(uid) || new Set<(event: ChatRealtimeEvent) => void>();
  listeners.set(uid, account); account.add(listener);
  return () => { account.delete(listener); if (!account.size) listeners.delete(uid); };
}
function emit(uid: string, event: ChatRealtimeEvent) {
  for (const listener of listeners.get(uid) || []) {
    try { listener(event); } catch { /* A failed view must not stop other listeners. */ }
  }
}

// One instance is owned by the authenticated root provider, never by each view.
// Cursors live only in that account's mounted session and are discarded at logout.
export function createChatConnection(uid: string, onStatus: (status: ChatConnectionStatus) => void) {
  let active = false, stopped = false, opening = false, attempt = 0, generation = 0;
  let cursor: number | undefined;
  let socket: WebSocket | null = null;
  let reconnect: ReturnType<typeof setTimeout> | undefined;
  let fallback: ReturnType<typeof setTimeout> | undefined;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let handshake: ReturnType<typeof setTimeout> | undefined;
  let fallbackBusy = false, fallbackPrimed = false;
  let lastPong = 0;

  const current = () => active && !stopped && getSessionUserId() === uid;
  const clear = () => {
    clearTimeout(reconnect); clearTimeout(fallback); clearTimeout(handshake); clearInterval(heartbeat);
    reconnect = undefined; fallback = undefined; handshake = undefined; heartbeat = undefined;
  };
  function accept(value: unknown, fallbackLive = false) {
    const frame = parseChatFrame(value);
    if (!frame || frame.type === "pong") { if (frame?.type === "pong") lastPong = Date.now(); return; }
    if (frame.type === "ready" || frame.type === "reset") {
      cursor = frame.reset ? frame.cursor : Math.max(cursor || 0, frame.cursor);
      emit(uid, frame); return;
    }
    if (frame.type === "cursor" || frame.type === "replay_complete") {
      cursor = Math.max(cursor || 0, frame.cursor); return;
    }
    if (frame.type === "chat_changed") {
      if (cursor !== undefined && frame.cursor <= cursor) return;
      cursor = frame.cursor;
      emit(uid, {...frame, live: fallbackLive || frame.live}); return;
    }
    if (frame.type === "refresh") emit(uid, {type: "refresh", cursor: frame.cursor});
  }
  async function poll() {
    if (!current() || fallbackBusy || socket?.readyState === 1) return;
    const version = generation; fallbackBusy = true;
    try {
      const data = await api.getAs<{events: unknown[]; cursor: number; reset: boolean}>(uid,
        "/messages/sync" + (cursor === undefined ? "" : "?after=" + cursor));
      if (!current() || generation !== version || socket?.readyState === 1) return;
      if (!data || !Array.isArray(data.events) || !Number.isSafeInteger(data.cursor)) throw new Error("Unsupported sync response");
      if (data.reset) { cursor = data.cursor; emit(uid, {type: "reset", cursor, reset: true}); }
      else {
        for (const event of data.events) accept(event, fallbackPrimed);
        cursor = Math.max(cursor || 0, data.cursor);
        // A replay may contain no event after retention or an older server restart.
        if (!fallbackPrimed) emit(uid, {type: "refresh", cursor});
      }
      fallbackPrimed = true;
    } catch {
      // Older API deployments remain usable while their realtime upgrade rolls out.
      if (current() && generation === version && socket?.readyState !== 1) emit(uid, {type: "refresh", cursor: cursor || 0});
    } finally {
      fallbackBusy = false;
      if (current() && socket?.readyState !== 1) fallback = setTimeout(() => void poll(), 8_000);
    }
  }
  function failed(ws?: WebSocket) {
    if (ws && socket !== ws) return;
    if (ws) {
      ws.onopen = ws.onmessage = ws.onclose = ws.onerror = null;
      try { ws.close(); } catch { /* Already closed. */ }
    }
    socket = null; opening = false;
    clearTimeout(handshake); clearInterval(heartbeat);
    if (!current()) return;
    onStatus("reconnecting");
    if (!fallback && !fallbackBusy) void poll();
    if (!reconnect) reconnect = setTimeout(() => { reconnect = undefined; void connect(); }, reconnectDelay(attempt++));
  }
  async function connect() {
    if (!current() || opening || socket) return;
    opening = true; const version = generation;
    onStatus(attempt ? "reconnecting" : "connecting");
    try {
      const data = await api.postAs<{ticket: string}>(uid, "/auth/ws-ticket", {scope: "messages"});
      if (!current() || generation !== version) return;
      if (typeof data?.ticket !== "string" || !data.ticket.length) throw new Error("Missing connection ticket");
      const url = API_ORIGIN.replace(/^http/, "ws") + "/ws/messages?ticket=" + encodeURIComponent(data.ticket)
        + (cursor === undefined ? "" : "&after=" + cursor);
      const ws = new WebSocket(url); socket = ws;
      handshake = setTimeout(() => failed(ws), 20_000);
      ws.onopen = () => {
        if (!current() || socket !== ws) { ws.close(); return; }
        opening = false; lastPong = Date.now();
        heartbeat = setInterval(() => {
          if (!current() || ws.readyState !== 1) return;
          if (Date.now() - lastPong > 45_000) { failed(ws); return; }
          try { ws.send("ping"); } catch { failed(ws); }
        }, 15_000);
      };
      ws.onmessage = event => {
        if (!current() || socket !== ws || typeof event.data !== "string" || event.data.length > 16_384) return;
        try {
          const value = JSON.parse(event.data), frame = parseChatFrame(value);
          if (!frame) return;
          if (frame.type === "ready") {
            clearTimeout(handshake); clearTimeout(fallback); fallback = undefined;
            attempt = 0; onStatus("connected");
          }
          accept(frame);
        } catch { /* Ignore malformed frames without losing the connection. */ }
      };
      ws.onerror = () => failed(ws);
      ws.onclose = event => {
        if (event.code === 4401 && current()) void api.getAs(uid, "/auth/me").catch(() => {});
        failed(ws);
      };
    } catch {
      if (current() && generation === version) failed();
    } finally {
      if (generation === version && !socket) opening = false;
    }
  }
  function setActive(next: boolean, offline = false) {
    if (stopped) return;
    if (active === next) {
      if (next && !socket && !opening) void connect();
      else if (!next) onStatus(offline ? "offline" : "paused");
      return;
    }
    active = next; generation++; clear(); opening = false; fallbackPrimed = false;
    const old = socket; socket = null;
    if (old) { old.onopen = old.onclose = old.onerror = old.onmessage = null; try { old.close(); } catch {} }
    if (!next) { onStatus(offline ? "offline" : "paused"); return; }
    void connect();
  }
  return {
    setActive,
    stop() { setActive(false); stopped = true; cursor = undefined; onStatus("idle"); },
  };
}

