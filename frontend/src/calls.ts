import { API_ORIGIN } from "./config";
// Calls — API helpers, WebSocket signaling client, types

import { api, User } from "./api";

export type CallStatus = "ringing" | "active" | "completed" | "missed";

export type Call = {
  id: string;
  members: string[];
  initiator_id: string;
  status: CallStatus;
  duration_sec: number;
  started_at: string | null;
  ended_at: string | null;
  created_at: string;
  other: User | null;
};

export type CallSignal =
  | { type: "incoming_call"; call: { id: string }; from: { id: string; name: string } }
  | { type: "call_accepted"; call_id: string }
  | { type: "call_declined"; call_id: string }
  | { type: "call_missed"; call_id: string }
  | { type: "call_ended"; call_id: string };

export type LiveKitJoin = { url: string; room: string; token: string };

export const callsApi = {
  list: () => api.get<Call[]>("/calls"),
  start: (other_user_id: string) => api.post<Call>("/calls", { other_user_id }),
  accept: (id: string) => api.post<Call>(`/calls/${id}/accept`),
  decline: (id: string) => api.post<Call>(`/calls/${id}/decline`),
  cancel: (id: string) => api.post<Call>(`/calls/${id}/cancel`),
  end: (id: string) => api.post<Call>(`/calls/${id}/end`),
  token: (id: string) => api.post<LiveKitJoin>(`/calls/${id}/token`),
};


export async function openCallSocket(onMessage: (msg: any) => void): Promise<WebSocket | null> {
  const { ticket } = await api.post<{ticket: string}>("/auth/ws-ticket", { scope: "calls" });
  const wsBase = API_ORIGIN.replace(/^http/, "ws");
  const ws = new WebSocket(`${wsBase}/api/ws/calls?ticket=${encodeURIComponent(ticket)}`);
  ws.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data));
    } catch {}
  };
  ws.onerror = () => {};
  return ws;
}
