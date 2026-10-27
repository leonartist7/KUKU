import { API_ORIGIN } from "./config";
// Spaces — API helpers, WebSocket client, types


import { api, User } from "./api";



export type AudioTrack = {
  id: string;
  title: string;
  artist: string;
  duration_sec: number;
  cover_emoji: string;
  url: string;
};

export type SpaceContent =
  | {
      type: "youtube";
      url: string;
      video_id: string;
      title: string;
    }
  | {
      type: "audio";
      audio_id: string;
      url: string;
      title: string;
      artist?: string;
      cover_emoji?: string;
      duration_sec?: number;
    };

export type SpaceState = {
  is_playing: boolean;
  position_sec: number;
  host_id: string;
  updated_at: string;
};

export type Space = {
  id: string;
  name: string;
  creator_id: string;
  members: string[];
  member_users: User[];
  presence: Record<string, string>;
  active_members: string[];
  mode: "idle" | "video" | "audio";
  content: SpaceContent | null;
  state: SpaceState;
  created_at: string;
  updated_at: string;
};

export type SpaceMessage = {
  id: string;
  space_id: string;
  sender_id: string;
  sender_name: string;
  text: string;
  created_at: string;
};

export const spacesApi = {
  list: () => api.get<{ active: Space[]; saved: Space[] }>("/spaces"),
  create: (name: string | null, member_ids: string[]) =>
    api.post<Space>("/spaces", { name, member_ids }),
  get: (id: string) => api.get<Space>(`/spaces/${id}`),
  join: (id: string) => api.post<Space>(`/spaces/${id}/join`),
  leave: (id: string) => api.post<{ ok: boolean }>(`/spaces/${id}/leave`),
  setContent: (
    id: string,
    body: { type: "youtube" | "audio"; url?: string; audio_id?: string; upload_id?: string; title?: string },
  ) => api.post(`/spaces/${id}/content`, body),
  setState: (id: string, body: { is_playing: boolean; position_sec: number }) =>
    api.post<SpaceState>(`/spaces/${id}/state`, body),
  listMessages: (id: string) => api.get<SpaceMessage[]>(`/spaces/${id}/messages`),
  sendMessage: (id: string, text: string) =>
    api.post<SpaceMessage>(`/spaces/${id}/messages`, { text }),
  reaction: (id: string, emoji: string) =>
    api.post<{ ok: boolean }>(`/spaces/${id}/reactions`, { emoji }),
  audioLibrary: () => api.get<AudioTrack[]>("/audio/library"),
  audioUploads: () => api.get<AudioUpload[]>("/audio/uploads"),
  uploadAudio: (title: string, data_url: string, duration_sec?: number) =>
    api.post<{ id: string; title: string }>("/audio/uploads", { title, data_url, duration_sec }),
  sessions: () => api.get<SpaceSession[]>("/space-sessions"),
};

export type AudioUpload = {
  id: string;
  uploader_id: string;
  uploader_name: string;
  title: string;
  duration_sec?: number | null;
  cover_emoji?: string;
  created_at: string;
};

export type SpaceSession = {
  id: string;
  space_id: string;
  space_name: string;
  summary: { title: string; mode: string; ended_at: string };
  content: any;
  members: string[];
  created_at: string;
};


export async function openSpaceSocket(
  spaceId: string,
  onMessage: (msg: any) => void,
  onClose?: () => void,
): Promise<WebSocket | null> {
  const { ticket } = await api.post<{ticket: string}>("/auth/ws-ticket", { scope: "space:" + spaceId });
  // Convert https → wss, http → ws
  const wsBase = API_ORIGIN.replace(/^http/, "ws");
  const url = `${wsBase}/api/ws/spaces/${spaceId}?ticket=${encodeURIComponent(ticket)}`;
  const ws = new WebSocket(url);
  ws.onmessage = (e) => {
    try {
      onMessage(JSON.parse(e.data));
    } catch {}
  };
  ws.onclose = () => onClose && onClose();
  ws.onerror = () => {};
  return ws;
}


