import { API_ORIGIN } from "./config";
import { api, User } from "./api";

// Signaling is account-bound. An accepted call is not proof of connected media.
export type CallStatus = "ringing" | "active" | "completed" | "missed";
export type Call = {
  id: string;
  members: string[];
  initiator_id: string;
  status: CallStatus;
  duration_sec: number;
  started_at: string | null;
  accepted_at?: string | null;
  media_ready_at?: string | null;
  expires_at?: string | null;
  ended_at: string | null;
  end_reason?: string | null;
  can_join_media?: boolean;
  created_at: string;
  other: User | null;
};
export type CallSignal = {
  type: "incoming_call" | "call_accepted" | "call_declined" | "call_missed" | "call_ended";
  call_id?: string;
  call?: Pick<Call, "id">;
  from?: Pick<User, "id" | "name">;
};
export type LiveKitJoin = { url: string; room: string; token: string };
const route = (id: string) => "/calls/" + encodeURIComponent(id);
export const callsApi = {
  list: (uid: string) => api.getAs<Call[]>(uid, "/calls"),
  get: (id: string, uid: string) => api.getAs<Call>(uid, route(id)),
  start: (other: string, uid: string) => api.postAs<Call>(uid, "/calls", { other_user_id: other }),
  accept: (id: string, uid: string) => api.postAs<Call>(uid, route(id) + "/accept", {}),
  decline: (id: string, uid: string) => api.postAs<Call>(uid, route(id) + "/decline", {}),
  cancel: (id: string, uid: string) => api.postAs<Call>(uid, route(id) + "/cancel", {}),
  end: (id: string, uid: string) => api.postAs<Call>(uid, route(id) + "/end", {}),
  token: (id: string, uid: string) => api.postAs<LiveKitJoin>(uid, route(id) + "/token", {}),
  heartbeat: (id: string, uid: string, mediaReady: boolean) =>
    api.postAs<Call>(uid, route(id) + "/heartbeat", { media_ready: mediaReady }),
};

export async function openCallSocket(uid: string, onMessage: (msg: unknown) => void): Promise<WebSocket> {
  const { ticket } = await api.postAs<{ ticket: string }>(uid, "/auth/ws-ticket", { scope: "calls" });
  const ws = new WebSocket(API_ORIGIN.replace(/^http/, "ws") + "/api/ws/calls?ticket=" + encodeURIComponent(ticket));
  ws.onmessage = (event) => {
    try { onMessage(JSON.parse(event.data)); } catch { /* Invalid signaling payloads are ignored. */ }
  };
  return ws;
}
