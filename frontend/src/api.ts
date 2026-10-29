import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { API_ORIGIN } from "./config";

const REFRESH_KEY = "kuku_refresh";
export const API_BASE = Platform.OS === "web" && !__DEV__ ? "/api" : API_ORIGIN + "/api";
let accessToken: string | null = null;
let sessionUserId: string | null = null;
let sessionEpoch = 0;
let refreshFlight: Promise<string | null> | null = null;
const expiredListeners = new Set<() => void>();
export function onSessionExpired(listener: () => void) {
  expiredListeners.add(listener);
  return () => { expiredListeners.delete(listener); };
}
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
export async function setToken(value: string | null) {
  accessToken = value;
  if (!value) { sessionUserId = null; sessionEpoch++; }
  if (!value && Platform.OS !== "web") await SecureStore.deleteItemAsync(REFRESH_KEY);
}
export async function acceptSession(data: { token: string; refresh_token?: string; user: {id:string} }) {
  sessionEpoch++;
  accessToken = data.token;
  sessionUserId = data.user.id;
  if (Platform.OS !== "web" && data.refresh_token) {
    await SecureStore.setItemAsync(REFRESH_KEY, data.refresh_token);
  }
}
function headers() {
  return { "Content-Type": "application/json", "X-Kuku-Platform": Platform.OS === "web" ? "web" : "native" };
}
async function parse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const detail = data.detail;
    throw new ApiError(typeof detail === "string" ? detail : Array.isArray(detail) ? detail.map((v: {msg?: string}) => v.msg).join(" ") : "Request failed", response.status);
  }
  return data;
}
export async function refreshSession(): Promise<string | null> {
  if (refreshFlight) return refreshFlight;
  const epoch = sessionEpoch;
  refreshFlight = (async () => {
    const refresh_token = Platform.OS === "web" ? undefined : await SecureStore.getItemAsync(REFRESH_KEY);
    if (Platform.OS !== "web" && !refresh_token) return null;
    const renew = async () => parse(await fetch(API_BASE + "/auth/refresh", {
      method: "POST", credentials: "include", headers: headers(), body: JSON.stringify({ refresh_token }),
    }));
    const data = Platform.OS === "web" && typeof navigator !== "undefined" && navigator.locks
      ? await navigator.locks.request("kuku-session-refresh", renew) : await renew();
    if (sessionEpoch !== epoch) return accessToken;
    await acceptSession(data);
    return data.token;
  })();
  try { return await refreshFlight; }
  catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      if (sessionEpoch !== epoch) return accessToken;
      await setToken(null);
      expiredListeners.forEach((listener) => listener());
      return null;
    }
    throw error;
  } finally { refreshFlight = null; }
}
export async function getToken(): Promise<string | null> {
  return accessToken || refreshSession();
}
async function request<T>(path: string, options: RequestInit = {}, retried = false, expectedUser?: string): Promise<T> {
  const anonymous = ["/auth/login", "/auth/register", "/auth/forgot-password", "/auth/reset-password"].includes(path);
  const token = anonymous ? null : await getToken();
  if (expectedUser && sessionUserId !== expectedUser) throw new ApiError("Account changed", 401);
  const response = await fetch(API_BASE + path, {
    ...options, credentials: "include",
    headers: { ...headers(), ...(token ? { Authorization: "Bearer " + token } : {}), ...options.headers },
  });
  if (response.status === 401 && !anonymous && !retried) {
    const renewed = await refreshSession();
    if (renewed) return request<T>(path, options, true, expectedUser);
    expiredListeners.forEach((listener) => listener());
  }
  return parse(response);
}
export const api = {
  postAs: <T = any>(uid:string,path:string,body:unknown) => request<T>(path,{method:"POST",body:JSON.stringify(body)},false,uid),
  get: <T = any>(path: string) => request<T>(path),
  post: <T = any>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  delete: <T = any>(path: string) => request<T>(path, { method: "DELETE" }),
};
export type User = { email_verified?: boolean; onboarding_complete?: boolean; id: string; email?: string; name: string; avatar?: string | null; bio?: string; created_at?: string };
export type Message = {
  id: string; chat_id: string; sender_id: string; sender_name: string;
  type: "text" | "voice" | "image" | "file" | "space_invite";
  text?: string | null; media?: string | null; file_name?: string | null; file_size?: number | null;
  duration_ms?: number | null; space_id?: string | null; space_name?: string | null;
  created_at: string; client_message_id?: string; attachment_id?: string; attachment_deleted?: boolean;
};
export type Chat = { id: string; type: string; other: User | null; last_message: Message | null; updated_at: string };

export async function uploadAttachment(chatId: string, uri: string, name: string) {
  const url = API_ORIGIN + "/api/chats/" + encodeURIComponent(chatId) + "/attachments?name=" + encodeURIComponent(name);
  const token = await getToken();
  if (Platform.OS !== "web") {
    const files = await import("expo-file-system/legacy");
    const info = await files.getInfoAsync(uri);
    if (!info.exists || info.isDirectory || !info.size || info.size > 25 * 1024 * 1024) throw new Error("Choose a file between 1 byte and 25 MB");
    const response = await files.uploadAsync(url, uri, {
      httpMethod: "POST", uploadType: files.FileSystemUploadType.BINARY_CONTENT,
      headers: { Authorization: "Bearer " + token, "Content-Type": "application/octet-stream" },
    });
    const data = JSON.parse(response.body);
    if (response.status >= 400) throw new ApiError(data.detail || "Upload failed", response.status);
    return data as {id: string; file_name: string; file_size: number};
  }
  const blob = await (await fetch(uri)).blob();
  if (!blob.size || blob.size > 25 * 1024 * 1024) throw new Error("Choose a file between 1 byte and 25 MB");
  return parse(await fetch(url, {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/octet-stream" }, body: blob,
  })) as Promise<{id: string; file_name: string; file_size: number}>;
}
