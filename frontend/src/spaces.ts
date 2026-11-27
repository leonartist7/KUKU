import { Platform } from "react-native";
import { API_ORIGIN } from "./config";
import { api, ApiError, getToken, getSessionUserId, User } from "./api";
import type { PlaybackState } from "./spacePlayback";

export type AudioTrack = { id: string; title: string; artist: string; duration_sec: number; cover_emoji: string; url: string };
export type SpaceContent =
  | { type: "youtube"; url: string; video_id: string; title: string }
  | { type: "audio"; source?: "library" | "upload"; audio_id?: string; upload_id?: string; url?: string; title: string; artist?: string; cover_emoji?: string; duration_sec?: number };
export type SpaceState = PlaybackState & { host_id: string };
export type Space = { id: string; name: string; creator_id: string; members: string[]; member_users: User[]; presence: Record<string, string>; active_members: string[]; mode: "idle" | "video" | "audio"; content: SpaceContent | null; state: SpaceState; version?: number; server_time?: string; created_at: string; updated_at: string };
export type SpaceMessage = { id: string; space_id: string; sender_id: string; sender_name: string; text: string; created_at: string };
export type AudioUpload = { id: string; uploader_id: string; uploader_name: string; title: string; duration_sec?: number | null; cover_emoji?: string; created_at: string };
export type SpaceSession = { id: string; space_id: string; space_name: string; summary: { title: string; mode: string; ended_at: string }; content: SpaceContent | null; members: string[]; created_at: string };
const read = <T,>(path: string, uid?: string) => uid ? api.getAs<T>(uid, path) : api.get<T>(path);
const write = <T,>(path: string, body: unknown, uid?: string) => uid ? api.postAs<T>(uid, path, body) : api.post<T>(path, body);
const room = (id: string) => "/spaces/" + encodeURIComponent(id);
export const spacesApi = {
  list: (uid?: string) => read<{ active: Space[]; saved: Space[] }>("/spaces", uid),
  create: (name: string | null, member_ids: string[], uid?: string) => write<Space>("/spaces", { name, member_ids }, uid),
  get: (id: string, uid?: string) => read<Space>(room(id), uid),
  join: (id: string, connectionId?: string, uid?: string) => write<Space>(room(id) + "/join", { connection_id: connectionId }, uid),
  leave: (id: string, connectionId?: string, uid?: string) => write<{ ok: boolean }>(room(id) + "/leave", { connection_id: connectionId }, uid),
  setContent: (id: string, body: { type: "youtube" | "audio"; url?: string; audio_id?: string; upload_id?: string; title?: string }, uid?: string) =>
    write<{ ok: boolean; content: SpaceContent; state: SpaceState }>(room(id) + "/content", body, uid),
  setState: (id: string, body: { is_playing: boolean; position_sec: number; expected_version?: number }, uid?: string) => write<SpaceState>(room(id) + "/state", body, uid),
  handoff: (id: string, userId: string, uid?: string) => write<unknown>(room(id) + "/host", { user_id: userId }, uid),
  listMessages: (id: string, uid?: string, before?: string, after?: string) => read<SpaceMessage[]>(room(id) + "/messages" + (before ? "?before=" + encodeURIComponent(before) + "&limit=50" : after ? "?after=" + encodeURIComponent(after) + "&limit=100" : "?limit=50"), uid),
  sendMessage: (id: string, text: string, uid?: string, clientMessageId?: string) => write<SpaceMessage>(room(id) + "/messages", { text, client_message_id: clientMessageId }, uid),
  reaction: (id: string, emoji: string, uid?: string) => write<{ ok: boolean }>(room(id) + "/reactions", { emoji }, uid),
  audioLibrary: (uid?: string) => read<AudioTrack[]>("/audio/library", uid),
  audioUploads: (uid?: string) => read<AudioUpload[]>("/audio/uploads", uid),
  audioDownload: (id: string, uid: string) => read<{ url: string; media_type: string; expires_in: number }>("/audio/uploads/" + encodeURIComponent(id) + "/download", uid),
  sessions: (uid?: string) => read<SpaceSession[]>("/space-sessions", uid),
};
function assertAccount(uid: string) { if (getSessionUserId() !== uid) throw new ApiError("Account changed", 401); }
/** Binary media bypasses the JSON proxy and never enters room snapshots. */
export async function uploadSpaceAudio(asset: { uri: string; name: string; size?: number }, uid: string) {
  if (asset.size !== undefined && (!asset.size || asset.size > 10 * 1024 * 1024)) throw new Error("Choose an audio file between 1 byte and 10 MB.");
  const token = await getToken(); assertAccount(uid);
  if (!token) throw new ApiError("Sign in again to upload audio.", 401);
  const title = asset.name.replace(/\.[^.]+$/, "").slice(0, 160) || "Shared audio";
  const url = API_ORIGIN + "/api/audio/uploads/binary?name=" + encodeURIComponent(asset.name) + "&title=" + encodeURIComponent(title);
  let status: number, data: Record<string, any>;
  if (Platform.OS !== "web") {
    const files = await import("expo-file-system/legacy");
    const info = await files.getInfoAsync(asset.uri);
    if (!info.exists || info.isDirectory || !info.size || info.size > 10 * 1024 * 1024) throw new Error("Choose an audio file between 1 byte and 10 MB.");
    assertAccount(uid);
    const result = await files.uploadAsync(url, asset.uri, { httpMethod: "POST", uploadType: files.FileSystemUploadType.BINARY_CONTENT, headers: { Authorization: "Bearer " + token, "Content-Type": "application/octet-stream" } });
    status = result.status;
    try { data = JSON.parse(result.body); } catch { throw new Error("The upload did not return a valid response."); }
  } else {
    const bytes = await (await fetch(asset.uri)).blob();
    if (!bytes.size || bytes.size > 10 * 1024 * 1024) throw new Error("Choose an audio file between 1 byte and 10 MB.");
    assertAccount(uid);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 90000);
    try {
      const result = await fetch(url, { method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/octet-stream" }, body: bytes, signal: controller.signal });
      status = result.status; data = await result.json().catch(() => ({}));
    } finally { clearTimeout(timer); }
  }
  assertAccount(uid);
  if (status >= 400) throw new ApiError(typeof data.detail === "string" ? data.detail : "Audio could not be saved. Try again.", status);
  return data as AudioUpload;
}
export function privateAudioUrl(value: string): string {
  const base = Platform.OS === "web" && typeof location !== "undefined" ? location.origin : API_ORIGIN;
  const url = new URL(value, base), allowed = new Set([new URL(API_ORIGIN).origin, new URL(base).origin]);
  if (!allowed.has(url.origin) || !/^https?:$/.test(url.protocol) || url.username || url.password || url.hash || !url.pathname.startsWith("/api/")) throw new Error("This audio link could not be verified.");
  return url.toString();
}
export async function openSpaceSocket(spaceId: string, onMessage: (msg: any) => void, onClose?: (code?: number) => void, options: { uid?: string; connectionId?: string; onOpen?: () => void } = {}): Promise<WebSocket> {
  const { ticket } = await write<{ ticket: string }>("/auth/ws-ticket", { scope: "space:" + spaceId }, options.uid);
  if (options.uid) assertAccount(options.uid);
  const url = API_ORIGIN.replace(/^http/, "ws") + "/api/ws/spaces/" + encodeURIComponent(spaceId) + "?ticket=" + encodeURIComponent(ticket) +
    (options.connectionId ? "&connection_id=" + encodeURIComponent(options.connectionId) : "");
  const socket = new WebSocket(url);
  socket.onopen = () => options.onOpen?.();
  socket.onmessage = event => { try { onMessage(JSON.parse(event.data)); } catch { /* Ignore non-protocol frames. */ } };
  socket.onclose = event => onClose?.(event.code);
  socket.onerror = () => socket.close();
  return socket;
}
