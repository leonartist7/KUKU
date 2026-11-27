import type { Room, RemoteTrack, RemoteParticipant } from "livekit-client";
import type { LiveKitJoin } from "./calls";
import { CallClientError } from "./callErrors";

export type AudioOutput = { id: string; label: string };
export type CallConnectionQuality = "unknown" | "excellent" | "good" | "poor" | "lost";
export type CallQuality = { local: CallConnectionQuality; remote: CallConnectionQuality };
export type CallMediaCallbacks = {
  ready: () => void;
  reconnecting: (message: string) => void;
  disconnected: () => void;
  playbackBlocked: (blocked: boolean) => void;
  muted: (muted: boolean) => void;
  quality: (quality: CallQuality) => void;
  remoteMuted: (muted: boolean | null) => void;
  remoteAudioError: (message: string | null) => void;
};

// Media tokens may only be sent to a normal secure LiveKit signaling endpoint.
// The server independently applies the same policy before issuing a token.
export function isSecureLiveKitUrl(value: unknown): value is string {
  if (typeof value !== "string" || !/^wss:\/\/[a-z0-9]/i.test(value) || /[\s\\%?#@]|[^\x21-\x7e]/.test(value)) return false;
  try {
    const authority = value.slice(value.indexOf("://") + 3).split("/")[0];
    if (authority.endsWith(":")) return false;
    const url = new URL(value);
    const host = url.hostname.toLowerCase(), labels = host.split(".");
    const tld = labels[labels.length - 1];
    return url.protocol === "wss:" && !url.username && !url.password && !url.search && !url.hash &&
      (url.pathname === "" || url.pathname === "/") && (!url.port || (Number(url.port) >= 1 && Number(url.port) <= 65535)) &&
      host.length <= 253 && labels.length >= 2 && host !== "localhost" && !host.endsWith(".localhost") &&
      !/^\d+\.\d+\.\d+\.\d+$/.test(host) && /^(?:[a-z]{2,}|xn--[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)$/.test(tld) &&
      labels.every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label));
  } catch { return false; }
}

export function normalizeCallQuality(value: unknown): CallConnectionQuality {
  return value === "excellent" || value === "good" || value === "poor" || value === "lost" ? value : "unknown";
}

export function callQualityLabel(value: CallConnectionQuality) {
  return value === "unknown" ? "Checking" : value === "excellent" ? "Excellent" : value === "good" ? "Good" : value === "poor" ? "Weak" : "Interrupted";
}

export function callQualityNotice(value: CallQuality) {
  if (value.local === "lost") return "Your connection is interrupted. Reconnecting audio.";
  if (value.remote === "lost") return "Their connection is interrupted. Waiting for audio to return.";
  if (value.local === "poor" && value.remote === "poor") return "Both connections are weak. A more stable network may help.";
  if (value.local === "poor") return "Your connection is weak. Try moving closer to Wi-Fi or switching networks.";
  if (value.remote === "poor") return "Their connection is weak. Audio may break up while it recovers.";
  return null;
}
export type CallMedia = {
  connect: () => Promise<void>;
  dispose: () => void;
  mute: (muted: boolean) => Promise<boolean>;
  resumeAudio: () => Promise<void>;
  outputs: () => Promise<AudioOutput[]>;
  output: (id: string) => Promise<void>;
};
type MediaOptions = {
  expectedParticipant: string;
  isCurrent: () => boolean;
  loadSdk?: () => Promise<typeof import("livekit-client")>;
};

// Chrome/Android Chrome can prevent another tab from taking the same microphone
// session. Unsupported browsers still rely on the server session and RTC identity.
async function acquireMediaLease(): Promise<() => void> {
  if (typeof navigator === "undefined" || !navigator.locks) return () => {};
  let release = () => {};
  const acquired = new Promise<void>((resolve, reject) => {
    void navigator.locks.request("kuku-call-media", { ifAvailable: true }, (lock) => {
      if (!lock) { reject(new CallClientError("another-tab")); return; }
      return new Promise<void>((unlock) => { release = unlock; resolve(); });
    }).catch(reject);
  });
  await acquired;
  return () => release();
}

// Kept outside React so navigation can minimize the call without owning tracks.
// The SDK is imported only when an authorized, accepted call needs media.
export async function createCallMedia(join: LiveKitJoin, callbacks: CallMediaCallbacks, options: MediaOptions): Promise<CallMedia> {
  if (!isSecureLiveKitUrl(join.url)) throw new CallClientError("secure-setup");
  const releaseLease = await acquireMediaLease();
  let sdk: typeof import("livekit-client");
  try {
    sdk = await (options.loadSdk || (() => import("livekit-client")))();
    if (!options.isCurrent()) throw new CallClientError("ended");
  } catch (error) { releaseLease(); throw error; }
  let room: Room;
  try { room = new sdk.Room({
    adaptiveStream: true, dynacast: true,
    audioCaptureDefaults: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    publishDefaults: { audioPreset: sdk.AudioPresets.speech, dtx: true, red: true, forceStereo: false },
  }); }
  catch (error) { releaseLease(); throw error; }
  let disposed = false;
  let localReady = false;
  let reportedReady = false;
  let hasBeenReady = false;
  let quality: CallQuality = { local: "unknown", remote: "unknown" };
  let remoteMuted: boolean | null = null;
  const elements = new Map<RemoteTrack, HTMLMediaElement>();
  const playable = new Set<RemoteTrack>();
  const rejectedPlayback = new Set<RemoteTrack>();
  const current = () => !disposed && options.isCurrent();
  const playbackAllowed = () => room.canPlaybackAudio !== false;
  const resetFeedback = () => {
    quality = { local: "unknown", remote: "unknown" }; remoteMuted = null;
    callbacks.quality({ ...quality }); callbacks.remoteMuted(null); callbacks.remoteAudioError(null);
  };
  const checkReady = () => {
    if (!current()) return;
    const blocked = !playbackAllowed() || rejectedPlayback.size > 0;
    const receiving = playable.size > 0 || (hasBeenReady && remoteMuted === true);
    const ready = localReady && receiving && !blocked && room.state === "connected" && quality.local !== "lost" && quality.remote !== "lost";
    callbacks.playbackBlocked(blocked);
    if (blocked && reportedReady) {
      reportedReady = false;
      callbacks.reconnecting("Tap to hear the call.");
    }
    if (ready && !reportedReady) { reportedReady = true; hasBeenReady = true; callbacks.ready(); }
  };
  const detach = (track: RemoteTrack) => {
    const element = elements.get(track);
    elements.delete(track); playable.delete(track); rejectedPlayback.delete(track);
    if (element) {
      try { element.pause(); } catch { /* Continue clearing and removing this sink. */ }
      try { element.srcObject = null; } catch { /* Detached by SDK. */ }
      try { element.remove(); } catch { /* Detached by SDK. */ }
    }
    try { track.detach().forEach((node) => { try { node.remove(); } catch { /* Remove every sink. */ } }); } catch { /* Already removed. */ }
    if (current() && reportedReady && playable.size === 0 && remoteMuted !== true) {
      reportedReady = false;
      callbacks.reconnecting("Waiting for the other microphone.");
    }
  };
  const attach = (track: RemoteTrack, publication: { source?: string; isMuted?: boolean }, participant: RemoteParticipant) => {
    if (!current() || track.kind !== "audio" || participant.identity !== options.expectedParticipant || elements.has(track)) return;
    if (publication.source === "microphone") {
      remoteMuted = publication.isMuted === true; callbacks.remoteMuted(remoteMuted);
    }
    const element = track.attach();
    element.setAttribute("data-kuku-call-audio", "true");
    element.setAttribute("playsinline", "");
    element.setAttribute("aria-hidden", "true");
    element.style.display = "none";
    document.body.appendChild(element);
    elements.set(track, element);
    void element.play().then(() => {
      if (!current() || elements.get(track) !== element) return;
      playable.add(track); rejectedPlayback.delete(track); checkReady();
      callbacks.remoteAudioError(null);
    }).catch(() => {
      if (current() && elements.get(track) === element) { rejectedPlayback.add(track); checkReady(); }
    });
  };
  room.on(sdk.RoomEvent.TrackSubscribed, attach);
  room.on(sdk.RoomEvent.TrackUnsubscribed, (track) => detach(track));
  room.on(sdk.RoomEvent.AudioPlaybackStatusChanged, () => checkReady());
  room.on(sdk.RoomEvent.Reconnecting, () => {
    if (!current()) return;
    reportedReady = false;
    resetFeedback();
    callbacks.reconnecting("Finding the connection again.");
  });
  room.on(sdk.RoomEvent.Reconnected, () => {
    if (!current()) return;
    callbacks.quality({ ...quality });
    const participant = room.remoteParticipants.get(options.expectedParticipant);
    participant?.trackPublications.forEach((publication) => {
      if (publication.source === "microphone") { remoteMuted = publication.isMuted; callbacks.remoteMuted(remoteMuted); }
    });
    checkReady();
  });
  room.on(sdk.RoomEvent.ParticipantDisconnected, (participant) => {
    if (current() && participant.identity === options.expectedParticipant) {
      reportedReady = false;
      for (const track of [...elements.keys()]) detach(track);
      quality = { ...quality, remote: "unknown" }; remoteMuted = null;
      callbacks.quality({ ...quality }); callbacks.remoteMuted(null); callbacks.remoteAudioError(null);
      callbacks.reconnecting("Waiting for the other person to reconnect.");
    }
  });
  room.on(sdk.RoomEvent.Disconnected, () => { if (current()) callbacks.disconnected(); });
  room.on(sdk.RoomEvent.LocalTrackPublished, () => { if (current()) callbacks.muted(!room.localParticipant.isMicrophoneEnabled); });
  const microphoneChanged = (publication: { source?: string; isMuted: boolean }, participant: { identity: string }) => {
    if (!current()) return;
    if (participant === room.localParticipant) { callbacks.muted(!room.localParticipant.isMicrophoneEnabled); return; }
    if (participant.identity !== options.expectedParticipant || publication.source !== "microphone") return;
    remoteMuted = publication.isMuted; callbacks.remoteMuted(remoteMuted);
    if (!remoteMuted && reportedReady && playable.size === 0) {
      reportedReady = false; callbacks.reconnecting("Waiting for the other microphone audio.");
    }
    checkReady();
  };
  room.on(sdk.RoomEvent.TrackMuted, (publication, participant) => {
    if (current() && participant === room.localParticipant) callbacks.muted(!room.localParticipant.isMicrophoneEnabled);
    else microphoneChanged(publication, participant);
  });
  room.on(sdk.RoomEvent.TrackUnmuted, (publication, participant) => {
    if (current() && participant === room.localParticipant) callbacks.muted(!room.localParticipant.isMicrophoneEnabled);
    else microphoneChanged(publication, participant);
  });
  room.on(sdk.RoomEvent.ConnectionQualityChanged, (quality, participant) => {
    if (!current()) return;
    const side = participant === room.localParticipant ? "local" : participant.identity === options.expectedParticipant ? "remote" : null;
    if (!side) return;
    updateQuality(side, normalizeCallQuality(quality));
  });
  function updateQuality(side: keyof CallQuality, value: CallConnectionQuality) {
    quality = { ...quality, [side]: value }; callbacks.quality({ ...quality });
    if (value === "lost") {
      reportedReady = false;
      callbacks.reconnecting(side === "local" ? "Your connection dropped. Reconnecting audio." : "Their connection dropped. Waiting for audio to return.");
    }
    checkReady();
  }
  room.on(sdk.RoomEvent.TrackSubscriptionFailed, (trackSid, participant) => {
    if (!current() || participant.identity !== options.expectedParticipant) return;
    const publication = participant.trackPublications.get(trackSid);
    if (publication && (publication.kind !== "audio" || publication.source !== "microphone")) return;
    callbacks.remoteAudioError("Their microphone audio could not be received. Waiting for it to reconnect.");
    if (playable.size === 0 && remoteMuted !== true) {
      reportedReady = false; callbacks.reconnecting("Waiting for the other microphone audio.");
    }
  });
  // May run again after an in-flight SDK connect/capture resolves. A previous
  // disconnect cannot stop tracks that the SDK has not created yet.
  function forceCleanup() {
    for (const track of [...elements.keys()]) detach(track);
    room.localParticipant.trackPublications.forEach((publication) => {
      try { publication.track?.stop(); } catch { /* One failed track must not retain the others. */ }
    });
    try { void room.disconnect(true).catch(() => {}); } catch { /* Continue releasing local ownership. */ }
  }
  function dispose() {
    if (disposed) return;
    if (options.isCurrent()) resetFeedback();
    disposed = true;
    room.removeAllListeners();
    try { forceCleanup(); } finally { releaseLease(); }
  }
  return {
    async connect() {
      try {
        if (!current()) { dispose(); return; }
        resetFeedback();
        await room.connect(join.url, join.token, { autoSubscribe: true });
        if (!current()) { if (disposed) forceCleanup(); else dispose(); return; }
        await room.localParticipant.setMicrophoneEnabled(true);
        if (!current()) { if (disposed) forceCleanup(); else dispose(); return; }
        localReady = true;
        callbacks.muted(!room.localParticipant.isMicrophoneEnabled);
        // Include tracks that became subscribed while connect() was settling.
        room.remoteParticipants.forEach((participant) => participant.trackPublications.forEach((publication) => {
          if (publication.track) attach(publication.track, publication, participant);
        }));
        try { await room.startAudio(); } catch { if (current()) callbacks.playbackBlocked(true); }
        checkReady();
      } catch (error) { if (disposed) forceCleanup(); else dispose(); throw error; }
    },
    dispose,
    async mute(muted) {
      if (!current()) throw new CallClientError("ended");
      try { await room.localParticipant.setMicrophoneEnabled(!muted); }
      catch (error) { if (!current()) forceCleanup(); throw error; }
      if (!current()) { forceCleanup(); throw new CallClientError("ended"); }
      const actual = !room.localParticipant.isMicrophoneEnabled;
      callbacks.muted(actual);
      return actual;
    },
    async resumeAudio() {
      if (!current()) return;
      await room.startAudio();
      if (!current()) return;
      await Promise.all([...elements].map(async ([track, element]) => {
        await element.play();
        if (current() && elements.get(track) === element) { playable.add(track); rejectedPlayback.delete(track); }
      }));
      if (current()) checkReady();
    },
    async outputs() {
      if (!current() || typeof HTMLMediaElement === "undefined" || !("setSinkId" in HTMLMediaElement.prototype)) return [];
      const devices = await sdk.Room.getLocalDevices("audiooutput", false);
      if (!current()) return [];
      return devices.map((device, index) => ({ id: device.deviceId, label: device.label || (index === 0 ? "Default audio output" : "Audio output " + (index + 1)) }));
    },
    async output(id) {
      if (!current()) throw new CallClientError("ended");
      const changed = await room.switchActiveDevice("audiooutput", id);
      if (!current()) return;
      if (!changed) throw new CallClientError("output-unavailable");
    },
  };
}
