// SDK/provider errors may contain signaling URLs, token query strings or device
// details. Only app-owned codes, permission names and HTTP statuses reach UI.
const messages = {
  "another-tab": "A call is already open in another KUKU tab.",
  "ended": "This call has ended.",
  "secure-setup": "Secure calling is not configured correctly. Open Call setup to check it.",
  "native-unavailable": "Calls need the supported browser version. Native calling is being prepared.",
  "calls-disabled": "Calls are not available in this beta yet.",
  "microphone-unsupported": "Microphone access needs a supported browser and a secure connection.",
  "output-unavailable": "This browser could not change the audio output.",
} as const;
export type CallProblemCode = keyof typeof messages;

export class CallClientError extends Error {
  constructor(public readonly code: CallProblemCode) {
    super(messages[code]); this.name = "CallClientError";
  }
}

export function callFailureText(error: unknown, fallback: string, apiStatus?: number): string {
  if (error instanceof CallClientError) return messages[error.code];
  const name = error instanceof Error ? error.name : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Microphone access was blocked. Allow it in your browser settings, then try again.";
  if (name === "NotFoundError") return "No microphone was found. Connect one and try again.";
  if (name === "NotReadableError" || name === "TrackStartError") return "Your microphone is in use or unavailable. Check other apps and try again.";
  if (name === "OverconstrainedError") return "This microphone can't use the requested audio settings. Try another microphone.";
  if (apiStatus === 401) return "Your session expired. Sign in again before calling.";
  if (apiStatus === 403) return "Calling is not available to this account or contact.";
  if (apiStatus === 404) return "This call or contact is no longer available.";
  if (apiStatus === 409) return "Another call or device is already using this session.";
  if (apiStatus === 429) return "Too many call attempts. Wait a moment and try again.";
  if (apiStatus === 503) return "Calling is not ready yet. Open Call setup to check it.";
  return fallback;
}
