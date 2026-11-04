import type { Call } from "./calls";

export type CallPhase = "preparing" | "ringing" | "connecting" | "connected" | "reconnecting" | "ended";

export function callIsTerminal(call: Pick<Call, "status">) {
  return call.status === "completed" || call.status === "missed";
}
export function callEndLabel(reason?: string | null) {
  switch (reason) {
    case "declined": return "The call was declined.";
    case "cancelled": return "The call was cancelled.";
    case "ringing_timeout": return "No answer this time.";
    case "connection_lost": return "The connection was lost.";
    default: return "Call ended.";
  }
}
export function callDuration(startedAt: number | null, now = Date.now()) {
  const seconds = startedAt !== null && Number.isFinite(startedAt) ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0;
  return Math.floor(seconds / 60) + ":" + (seconds % 60).toString().padStart(2, "0");
}
export function callPhaseLabel(phase: CallPhase) {
  switch (phase) {
    case "preparing": return "Getting ready";
    case "ringing": return "Calling";
    case "connecting": return "Connecting audio";
    case "connected": return "On a call";
    case "reconnecting": return "Reconnecting";
    default: return "Call ended";
  }
}
export function mediaTimestamp(call: Pick<Call, "media_ready_at">): number | null {
  const value = call.media_ready_at ? Date.parse(call.media_ready_at) : NaN;
  return Number.isFinite(value) ? value : null;
}

export function callHistoryLabel(call: Pick<Call, "status" | "end_reason" | "media_ready_at" | "duration_sec">) {
  if (call.status === "ringing") return "Calling";
  if (call.status === "active") return call.media_ready_at ? "In progress" : "Connecting audio";
  if (call.end_reason === "declined") return "Declined";
  if (call.end_reason === "cancelled") return "Cancelled";
  if (call.status === "missed" || call.end_reason === "ringing_timeout") return "No answer";
  if (call.end_reason === "connection_lost") return "Connection lost";
  if (!call.media_ready_at) return "Ended before audio connected";
  const seconds = Number.isFinite(call.duration_sec) ? Math.max(0, Math.floor(call.duration_sec)) : 0;
  return Math.floor(seconds / 60) + ":" + (seconds % 60).toString().padStart(2, "0");
}
