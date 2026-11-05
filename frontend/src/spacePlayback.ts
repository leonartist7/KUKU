/** Clock and playback math are independent of render frames. */
export type PlaybackState = { is_playing: boolean; position_sec: number; updated_at: string; version?: number; session_id?: string; server_time?: string };
export type ClockSample = { offsetMs: number; roundTripMs: number; receivedAt: number };
const wallOrigin = Date.now();
const monotonicOrigin = typeof performance !== "undefined" ? performance.now() : null;
export function timelineNow(): number {
  return monotonicOrigin === null ? Date.now() : wallOrigin + performance.now() - monotonicOrigin;
}
export function sampleServerClock(serverTime: string | undefined, sentAt: number, receivedAt: number, previous?: ClockSample): ClockSample | undefined {
  const serverMs = serverTime ? Date.parse(serverTime) : NaN, roundTripMs = receivedAt - sentAt;
  if (!Number.isFinite(serverMs) || !Number.isFinite(roundTripMs) || roundTripMs < 0 || roundTripMs > 10000) return previous;
  if (previous && receivedAt - previous.receivedAt < 60000 && roundTripMs > previous.roundTripMs + 100) return previous;
  return { offsetMs: serverMs - (sentAt + receivedAt) / 2, roundTripMs, receivedAt };
}
export function playbackPosition(state: PlaybackState, localNow = Date.now(), offsetMs = 0, duration?: number): number {
  const updatedAt = Date.parse(state.updated_at), base = Number.isFinite(state.position_sec) ? Math.max(0, state.position_sec) : 0;
  const elapsed = state.is_playing && Number.isFinite(updatedAt) ? Math.max(0, (localNow + offsetMs - updatedAt) / 1000) : 0;
  const position = base + elapsed;
  return duration && Number.isFinite(duration) && duration > 0 ? Math.min(duration, position) : position;
}
export function acceptsPlayback(current: PlaybackState | undefined, next: PlaybackState): boolean {
  if (!current) return true;
  const a = Number.isFinite(current.version) ? current.version! : 0, b = Number.isFinite(next.version) ? next.version! : 0;
  if (b !== a) return b > a;
  if (current.session_id && next.session_id && current.session_id !== next.session_id) return Date.parse(next.updated_at) > Date.parse(current.updated_at);
  return Date.parse(next.updated_at) >= Date.parse(current.updated_at);
}
export function playbackCorrection(actual: number, target: number, force = false): "none" | "seek" {
  return Number.isFinite(actual) && Number.isFinite(target) && Math.abs(actual - target) > (force ? 0.25 : 0.75) ? "seek" : "none";
}
export function reconnectDelay(attempt: number, jitter = Math.random()): number {
  return Math.min(20000, 1000 * 2 ** Math.min(5, Math.max(0, attempt))) + Math.round(Math.max(0, Math.min(1, jitter)) * 500);
}
export function mergeSpaceMessages<T extends { id: string; created_at: string }>(current: T[], incoming: T[], limit = 500): T[] {
  const unique = new Map(current.map(message => [message.id, message]));
  incoming.forEach(message => unique.set(message.id, message));
  return Array.from(unique.values()).sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id)).slice(-limit);
}
export function formatPlayback(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
}
