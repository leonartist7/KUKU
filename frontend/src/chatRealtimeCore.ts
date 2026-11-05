export type ChatRealtimeEvent =
  | {type: "chat_changed"; chat_id: string; message_id: string; sender_id: string; cursor: number; live: boolean; change: "created" | "updated"; revision: number}
  | {type: "ready" | "reset" | "refresh"; cursor: number; reset?: boolean; live?: false};
export type ChatRealtimeFrame = ChatRealtimeEvent | {type: "pong"} | {type: "cursor" | "replay_complete"; cursor: number};
export type ChatConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "offline" | "paused";

export function reconnectDelay(attempt: number, random = Math.random()): number {
  const base = Math.min(30_000, 1_000 * 2 ** Math.min(5, Math.max(0, attempt)));
  return Math.round(base * (0.8 + Math.min(1, Math.max(0, random)) * 0.4));
}
export function parseChatFrame(value: unknown): ChatRealtimeFrame | null {
  if (!value || typeof value !== "object") return null;
  const frame = value as Record<string, unknown>;
  if (frame.type === "pong") return {type: "pong"};
  if (!Number.isSafeInteger(frame.cursor) || (frame.cursor as number) < 0) return null;
  const cursor = frame.cursor as number;
  if (frame.type === "chat_changed") {
    if (frame.change !== undefined && frame.change !== "created" && frame.change !== "updated") return null;
    if (frame.revision !== undefined && (!Number.isSafeInteger(frame.revision) || (frame.revision as number) < 0)) return null;
    for (const key of ["chat_id", "message_id", "sender_id"]) {
      if (typeof frame[key] !== "string" || !(frame[key] as string).length || (frame[key] as string).length > 100) return null;
    }
    return {type: "chat_changed", chat_id: frame.chat_id as string, message_id: frame.message_id as string,
      sender_id: frame.sender_id as string, cursor, live: frame.live === true,
      change: frame.change === "updated" ? "updated" : "created", revision: typeof frame.revision === "number" ? frame.revision : 0};
  }
  if (frame.type === "ready" || frame.type === "reset" || frame.type === "refresh") {
    return {type: frame.type, cursor, reset: frame.reset === true, live: false};
  }
  if (frame.type === "cursor" || frame.type === "replay_complete") return {type: frame.type, cursor};
  return null;
}

