import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { API_ORIGIN } from "./config";

const REFRESH_KEY = "kuku_refresh";
export const API_BASE = Platform.OS === "web" && !__DEV__ ? "/api" : API_ORIGIN + "/api";
let accessToken: string | null = null;
let sessionUserId: string | null = null;
// A cached profile can constrain which account may restore, but is never a
// credential and never populates sessionUserId or grants request access.
let expectedRestoredUser: string | null = null;
let sessionEpoch = 0;
let refreshFlight: Promise<string | null> | null = null;
const REQUEST_TIMEOUT_MS = 95_000;
let secureWrites: Promise<unknown> = Promise.resolve();
export const getSessionUserId = () => sessionUserId;
export const getSessionEpoch = () => sessionEpoch;
export function setExpectedRestoredUser(uid: string | null, expectedEpoch: number): boolean {
  if (sessionEpoch !== expectedEpoch) return false;
  expectedRestoredUser = uid;
  return true;
}
const expiredListeners = new Set<() => void>();
export function onSessionExpired(listener: () => void) {
  expiredListeners.add(listener);
  return () => { expiredListeners.delete(listener); };
}
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
// Keep the deadline until the response body is decoded, not only until headers arrive.
// The API may need to wake on the free hosting tier, but it must never wait forever.
export async function withRequestDeadline<T>(run: (signal: AbortSignal) => Promise<T>, timeout = REQUEST_TIMEOUT_MS): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout>;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new ApiError("KUKU is taking longer to connect. Please try again; your session has been kept.", 408));
      controller.abort();
    }, timeout);
  });
  try { return await Promise.race([run(controller.signal), deadline]); }
  finally { clearTimeout(timer!); }
}
function storeRefresh(value: string | null) {
  secureWrites = secureWrites.catch(() => {}).then(() => value
    ? SecureStore.setItemAsync(REFRESH_KEY, value)
    : SecureStore.deleteItemAsync(REFRESH_KEY));
  return secureWrites;
}
export async function setToken(value: string | null) {
  accessToken = value;
  if (!value) { sessionUserId = null; expectedRestoredUser = null; sessionEpoch++; refreshFlight = null; }
  if (!value && Platform.OS !== "web") await storeRefresh(null);
}
export async function acceptSession(data: { token: string; refresh_token?: string; user: {id:string} }) {
  sessionEpoch++;
  expectedRestoredUser = null;
  accessToken = data.token;
  sessionUserId = data.user.id;
  if (Platform.OS !== "web" && data.refresh_token) {
    await storeRefresh(data.refresh_token);
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
  const expectedUser = expectedRestoredUser || sessionUserId;
  const flight = (async () => {
    const refresh_token = Platform.OS === "web" ? undefined : await SecureStore.getItemAsync(REFRESH_KEY);
    if (Platform.OS !== "web" && !refresh_token) return null;
    const renew = async (signal: AbortSignal) => parse(await fetch(API_BASE + "/auth/refresh", {
      method: "POST", credentials: "include", headers: headers(), body: JSON.stringify({ refresh_token }), signal,
    }));
    const data = await withRequestDeadline(signal => Platform.OS === "web" && typeof navigator !== "undefined" && navigator.locks
      ? navigator.locks.request("kuku-session-refresh", {signal}, () => renew(signal)) : renew(signal));
    if (sessionEpoch !== epoch) return accessToken;
    // A refresh rotates credentials in the same session; it does not invalidate
    // unrelated in-flight reads for that account.
    if ((expectedUser && data.user.id !== expectedUser) ||
        (expectedRestoredUser && data.user.id !== expectedRestoredUser) ||
        (sessionUserId && data.user.id !== sessionUserId)) throw new ApiError("Your account changed. Please sign in again.", 401);
    accessToken = data.token;
    sessionUserId = data.user.id;
    if (Platform.OS !== "web" && data.refresh_token) await storeRefresh(data.refresh_token);
    if (sessionEpoch !== epoch) return accessToken;
    return data.token;
  })();
  refreshFlight = flight;
  try { return await flight; }
  catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      if (sessionEpoch !== epoch) return accessToken;
      await setToken(null);
      expiredListeners.forEach((listener) => listener());
      return null;
    }
    throw error;
  } finally { if (refreshFlight === flight) refreshFlight = null; }
}
export async function getToken(): Promise<string | null> {
  if (accessToken) {
    if (expectedRestoredUser && sessionUserId !== expectedRestoredUser) throw new ApiError("Your account changed. Please sign in again.", 401);
    return accessToken;
  }
  return refreshSession();
}
async function request<T>(path: string, options: RequestInit = {}, retried = false, expectedUser?: string): Promise<T> {
  const anonymous = ["/auth/login", "/auth/register", "/auth/forgot-password", "/auth/reset-password"].includes(path);
  const startedEpoch = sessionEpoch;
  const startedUser = expectedUser || expectedRestoredUser || sessionUserId;
  const token = anonymous ? null : await getToken();
  const assertCurrent = () => {
    if (!anonymous && (sessionEpoch !== startedEpoch || (startedUser && sessionUserId !== startedUser))) throw new ApiError("Account changed", 401);
  };
  assertCurrent();
  let unauthorized = false;
  const data = await withRequestDeadline(async signal => {
    const response = await fetch(API_BASE + path, {
      ...options, credentials: "include", signal,
      headers: { ...headers(), ...(token ? { Authorization: "Bearer " + token } : {}), ...options.headers },
    });
    assertCurrent();
    if (response.status === 401 && !anonymous && !retried) { unauthorized = true; return null; }
    const body = await parse(response);
    assertCurrent();
    return body;
  });
  if (unauthorized) {
    const renewed = await refreshSession();
    assertCurrent();
    if (renewed) return request<T>(path, options, true, expectedUser);
    expiredListeners.forEach((listener) => listener());
    throw new ApiError("Please sign in again.", 401);
  }
  return data as T;
}
export const api = {
  postAs: <T = any>(uid:string,path:string,body:unknown) => request<T>(path,{method:"POST",body:JSON.stringify(body)},false,uid),
  get: <T = any>(path: string) => request<T>(path),
  getAs: <T = any>(uid:string,path:string) => request<T>(path,{},false,uid),
  deleteAs: <T = any>(uid:string,path:string) => request<T>(path,{method:"DELETE"},false,uid),
  post: <T = any>(path: string, body?: unknown) => request<T>(path, { method: "POST", body: JSON.stringify(body ?? {}) }),
  delete: <T = any>(path: string) => request<T>(path, { method: "DELETE" }),
};
export type User = { email_verified?: boolean; onboarding_complete?: boolean; id: string; email?: string; name: string; avatar?: string | null; bio?: string; created_at?: string };
export type Message = {
  id: string; chat_id: string; sender_id: string; sender_name: string;
  type: "text" | "voice" | "image" | "file" | "space_invite" | "emote";
  emote_id?: string | null;
  revision?: number; edited_at?: string | null; deleted_at?: string | null;
  reply_to_id?: string | null; pinned?: boolean;
  reactions?: {emoji: string; user_ids: string[]}[];
  text?: string | null; media?: string | null; file_name?: string | null; file_size?: number | null;
  duration_ms?: number | null; space_id?: string | null; space_name?: string | null;
  created_at: string; client_message_id?: string; attachment_id?: string; attachment_deleted?: boolean;
};
export type Chat = { id: string; type: string; other: User | null; last_message: Message | null; updated_at: string };

export async function uploadAttachment(chatId: string, uri: string, name: string, expectedUser?: string, kind = "file") {
  const epoch = sessionEpoch;
  const assertCurrent = () => {
    if (sessionEpoch !== epoch || (expectedUser && sessionUserId !== expectedUser)) throw new ApiError("Account changed", 401);
  };
  assertCurrent();
  const url = API_ORIGIN + "/api/chats/" + encodeURIComponent(chatId) + "/attachments?name=" + encodeURIComponent(name) + "&kind=" + encodeURIComponent(kind);
  const token = await getToken();
  assertCurrent();
  if (Platform.OS !== "web") {
    const files = await import("expo-file-system/legacy");
    const info = await files.getInfoAsync(uri);
    if (!info.exists || info.isDirectory || !info.size || info.size > 25 * 1024 * 1024) throw new Error("Choose a file between 1 byte and 25 MB");
    assertCurrent();
    const response = await withRequestDeadline(async signal => {
      const task = files.createUploadTask(url, uri, {
        httpMethod: "POST", uploadType: files.FileSystemUploadType.BINARY_CONTENT,
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/octet-stream" },
      });
      const cancel = () => { void task.cancelAsync().catch(() => {}); };
      signal.addEventListener("abort", cancel, {once: true});
      try {
        const result = await task.uploadAsync();
        if (!result) throw new Error("The upload was cancelled. Your file is still selected.");
        return result;
      } finally { signal.removeEventListener("abort", cancel); }
    });
    const data = JSON.parse(response.body);
    if (response.status >= 400) throw new ApiError(data.detail || "Upload failed", response.status);
    assertCurrent();
    return data as {id: string; file_name: string; file_size: number};
  }
  const blob = await (await fetch(uri)).blob();
  if (!blob.size || blob.size > 25 * 1024 * 1024) throw new Error("Choose a file between 1 byte and 25 MB");
  assertCurrent();
  const data = await withRequestDeadline(async signal => parse(await fetch(url, {
    method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/octet-stream" }, body: blob,
    signal,
  })));
  assertCurrent();
  return data as {id: string; file_name: string; file_size: number};
}
