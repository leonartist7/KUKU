import type { Room, RemoteTrack, RemoteParticipant } from "livekit-client";
import type { LiveKitJoin } from "./calls";

export type AudioOutput = { id: string; label: string };
export type CallMediaCallbacks = {
  ready: () => void;
  reconnecting: (message: string) => void;
  disconnected: () => void;
  playbackBlocked: (blocked: boolean) => void;
  muted: (muted: boolean) => void;
  quality: (poor: boolean) => void;
};
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
      if (!lock) { reject(new Error("A call is already open in another KUKU tab.")); return; }
      return new Promise<void>((unlock) => { release = unlock; resolve(); });
    }).catch(reject);
  });
  await acquired;
  return () => release();
}

// Kept outside React so navigation can minimize the call without owning tracks.
// The SDK is imported only when an authorized, accepted call needs media.
export async function createCallMedia(join: LiveKitJoin, callbacks: CallMediaCallbacks, options: MediaOptions): Promise<CallMedia> {
  const releaseLease = await acquireMediaLease();
  let sdk: typeof import("livekit-client");
  try {
    sdk = await (options.loadSdk || (() => import("livekit-client")))();
    if (!options.isCurrent()) throw new Error("The call has ended.");
  } catch (error) { releaseLease(); throw error; }
  let room: Room;
  try { room = new sdk.Room({ adaptiveStream: true, dynacast: true }); }
  catch (error) { releaseLease(); throw error; }
  let disposed = false;
  let localReady = false;
  let reportedReady = false;
  const elements = new Map<RemoteTrack, HTMLMediaElement>();
  const playable = new Set<RemoteTrack>();
  const rejectedPlayback = new Set<RemoteTrack>();
  const current = () => !disposed && options.isCurrent();
  const playbackAllowed = () => room.canPlaybackAudio !== false;
  const checkReady = () => {
    if (!current()) return;
    const blocked = !playbackAllowed() || rejectedPlayback.size > 0;
    const ready = localReady && playable.size > 0 && !blocked && room.state === "connected";
    callbacks.playbackBlocked(blocked);
    if (blocked && reportedReady) {
      reportedReady = false;
      callbacks.reconnecting("Tap to hear the call.");
    }
    if (ready && !reportedReady) { reportedReady = true; callbacks.ready(); }
  };
  const detach = (track: RemoteTrack) => {
    const element = elements.get(track);
    elements.delete(track); playable.delete(track); rejectedPlayback.delete(track);
    if (element) {
      try { element.pause(); element.srcObject = null; element.remove(); } catch { /* Detached by SDK. */ }
    }
    try { track.detach().forEach((node) => node.remove()); } catch { /* Already removed. */ }
    if (current() && reportedReady && playable.size === 0) {
      reportedReady = false;
      callbacks.reconnecting("Waiting for the other microphone.");
    }
  };
  const attach = (track: RemoteTrack, _publication: unknown, participant: RemoteParticipant) => {
    if (!current() || track.kind !== "audio" || participant.identity !== options.expectedParticipant || elements.has(track)) return;
    const element = track.attach();
    element.setAttribute("data-kuku-call-audio", "true");
    element.setAttribute("playsinline", "");
    element.setAttribute("aria-hidden", "true");
    element.style.display = "none";
    document.body.appendChild(element);
    elements.set(track, element);
    void element.play().then(() => {
      if (!current() || !elements.has(track)) return;
      playable.add(track); rejectedPlayback.delete(track); checkReady();
    }).catch(() => {
      if (current() && elements.has(track)) { rejectedPlayback.add(track); checkReady(); }
    });
  };
  room.on(sdk.RoomEvent.TrackSubscribed, attach);
  room.on(sdk.RoomEvent.TrackUnsubscribed, (track) => detach(track));
  room.on(sdk.RoomEvent.AudioPlaybackStatusChanged, () => checkReady());
  room.on(sdk.RoomEvent.Reconnecting, () => {
    if (!current()) return;
    reportedReady = false;
    callbacks.reconnecting("Finding the connection again.");
  });
  room.on(sdk.RoomEvent.Reconnected, () => checkReady());
  room.on(sdk.RoomEvent.ParticipantDisconnected, (participant) => {
    if (current() && participant.identity === options.expectedParticipant) {
      reportedReady = false;
      callbacks.reconnecting("Waiting for the other person to reconnect.");
    }
  });
  room.on(sdk.RoomEvent.Disconnected, () => { if (current()) callbacks.disconnected(); });
  room.on(sdk.RoomEvent.LocalTrackPublished, () => { if (current()) callbacks.muted(!room.localParticipant.isMicrophoneEnabled); });
  room.on(sdk.RoomEvent.TrackMuted, (_publication, participant) => {
    if (current() && participant === room.localParticipant) callbacks.muted(!room.localParticipant.isMicrophoneEnabled);
  });
  room.on(sdk.RoomEvent.TrackUnmuted, (_publication, participant) => {
    if (current() && participant === room.localParticipant) callbacks.muted(!room.localParticipant.isMicrophoneEnabled);
  });
  room.on(sdk.RoomEvent.ConnectionQualityChanged, (quality, participant) => {
    if (current() && participant === room.localParticipant) callbacks.quality(quality === "poor" || quality === "lost");
  });
  // May run again after an in-flight SDK connect/capture resolves. A previous
  // disconnect cannot stop tracks that the SDK has not created yet.
  function forceCleanup() {
    for (const track of [...elements.keys()]) detach(track);
    room.localParticipant.trackPublications.forEach((publication) => publication.track?.stop());
    void room.disconnect(true).catch(() => {});
  }
  function dispose() {
    if (disposed) return;
    disposed = true;
    room.removeAllListeners();
    forceCleanup();
    releaseLease();
  }
  return {
    async connect() {
      try {
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
      if (!current()) throw new Error("This call has ended.");
      try { await room.localParticipant.setMicrophoneEnabled(!muted); }
      catch (error) { if (!current()) forceCleanup(); throw error; }
      if (!current()) { forceCleanup(); throw new Error("This call has ended."); }
      const actual = !room.localParticipant.isMicrophoneEnabled;
      callbacks.muted(actual);
      return actual;
    },
    async resumeAudio() {
      if (!current()) return;
      await room.startAudio();
      await Promise.all([...elements].map(async ([track, element]) => {
        await element.play();
        if (current() && elements.has(track)) { playable.add(track); rejectedPlayback.delete(track); }
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
      if (!current()) throw new Error("This call has ended.");
      const changed = await room.switchActiveDevice("audiooutput", id);
      if (!current()) return;
      if (!changed) throw new Error("This browser could not change the audio output.");
    },
  };
}
