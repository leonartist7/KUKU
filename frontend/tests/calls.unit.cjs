const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { EventEmitter } = require("node:events");
const ts = require("typescript");

function load(file, globals = {}, requireModule = require) {
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText;
  vm.runInNewContext(source, { exports, require: requireModule, Date, Map, Set, Promise, Error, Number, ...globals });
  return exports;
}
function harness(options = {}) {
  let current = true, room, attached = 0, removed = 0, stopped = 0, released = 0;
  const callbacks = { ready: 0, reconnecting: [], disconnected: 0, blocked: [], muted: [], quality: [] };
  const events = Object.fromEntries(["TrackSubscribed", "TrackUnsubscribed", "AudioPlaybackStatusChanged", "Reconnecting", "Reconnected", "ParticipantDisconnected", "Disconnected", "LocalTrackPublished", "TrackMuted", "TrackUnmuted", "ConnectionQualityChanged"].map(x => [x, x]));
  class FakeRoom extends EventEmitter {
    constructor() {
      super(); room = this;
      this.state = "disconnected"; this.canPlaybackAudio = !options.blocked;
      this.remoteParticipants = new Map();
      this.localParticipant = {
        isMicrophoneEnabled: false,
        trackPublications: new Map([["mic", { track: { stop: () => stopped++ } }]]),
        setMicrophoneEnabled: async enabled => {
          if (this.failMute) throw new Error("Device unavailable");
          if ((options.microphoneWait || this.microphoneWait) && enabled) {
            await (options.microphoneWait || this.microphoneWait);
            this.localParticipant.trackPublications.set("late-mic", { track: { stop: () => { this.lateMicrophoneStopped = true; } } });
          }
          this.localParticipant.isMicrophoneEnabled = enabled;
        }
      };
    }
    async connect() {
      if (options.connectWait) await options.connectWait;
      this.state = "connected";
    }
    async startAudio() {
      if (options.blocked && !this.unlocked) throw new Error("Autoplay blocked");
      this.canPlaybackAudio = true;
      this.emit(events.AudioPlaybackStatusChanged);
    }
    async disconnect() { this.disconnected = (this.disconnected || 0) + 1; this.state = "disconnected"; }
    async switchActiveDevice(kind, id) {
      assert.equal(kind, "audiooutput"); this.selected = id;
      return !this.failOutput;
    }
    static async getLocalDevices(kind, requestPermissions) {
      assert.equal(kind, "audiooutput"); assert.equal(requestPermissions, false);
      return [{ deviceId: "speaker", label: "Desk speakers" }];
    }
  }
  class MediaElement {}
  if (!options.noOutput) MediaElement.prototype.setSinkId = async () => {};
  const element = () => ({
    style: {}, setAttribute() {}, pause() {}, srcObject: {},
    remove() { if (!this.removed) { this.removed = true; removed++; } },
    async play() { if ((options.blocked || options.rejectElement) && !room.unlocked) throw new Error("Autoplay blocked"); }
  });
  const makeTrack = (kind = "audio") => {
    const node = element();
    return { kind, node, attach() { return node; }, detach() { return [node]; } };
  };
  const navigator = options.locked ? { locks: { request: async (_key, _opts, fn) => fn(null) } } :
    { locks: { request: async (_key, _opts, fn) => { await fn({ name: "kuku-call-media" }); released++; } } };
  const module = load("src/callMedia.ts", {
    navigator, HTMLMediaElement: MediaElement,
    document: { body: { appendChild() { attached++; } } }
  });
  const handlers = {
    ready: () => callbacks.ready++,
    reconnecting: message => callbacks.reconnecting.push(message),
    disconnected: () => callbacks.disconnected++,
    playbackBlocked: value => callbacks.blocked.push(value),
    muted: value => callbacks.muted.push(value),
    quality: value => callbacks.quality.push(value)
  };
  return {
    callbacks, events, makeTrack, room: () => room, counts: () => ({ attached, removed, stopped, released }),
    invalidate: () => { current = false; },
    create: () => module.createCallMedia({ url: "wss://rtc.example.test", token: "test-token", room: "test-room" }, handlers, {
      expectedParticipant: "sister", isCurrent: () => current,
      loadSdk: async () => ({ Room: FakeRoom, RoomEvent: events })
    })
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("accepted signaling alone never starts the connected media state", async () => {
  const h = harness(), media = await h.create();
  await media.connect();
  assert.equal(h.callbacks.ready, 0);
  const wrong = h.makeTrack();
  h.room().emit(h.events.TrackSubscribed, wrong, {}, { identity: "outsider" });
  h.room().emit(h.events.TrackSubscribed, h.makeTrack("video"), {}, { identity: "sister" });
  await settle();
  assert.equal(h.counts().attached, 0);
  h.room().emit(h.events.TrackSubscribed, h.makeTrack(), {}, { identity: "sister" });
  await settle();
  assert.equal(h.callbacks.ready, 1);
  assert.equal(h.counts().attached, 1);
  media.dispose();
});

test("blocked browser playback requires successful gesture recovery before media-ready", async () => {
  const h = harness({ blocked: true }), media = await h.create();
  await media.connect();
  h.room().emit(h.events.TrackSubscribed, h.makeTrack(), {}, { identity: "sister" });
  await settle();
  assert.equal(h.callbacks.ready, 0);
  assert.ok(h.callbacks.blocked.includes(true));
  h.room().unlocked = true;
  await media.resumeAudio();
  assert.equal(h.callbacks.ready, 1);
  assert.equal(h.callbacks.blocked.at(-1), false);
  media.dispose();
});

test("microphone and output controls acknowledge actual SDK success and preserve failed state", async () => {
  const h = harness(), media = await h.create();
  await media.connect();
  h.room().failMute = true;
  const previous = h.callbacks.muted.at(-1);
  await assert.rejects(media.mute(true), /Device unavailable/);
  assert.equal(h.callbacks.muted.at(-1), previous);
  h.room().failMute = false;
  assert.equal(await media.mute(true), true);
  assert.equal(h.room().localParticipant.isMicrophoneEnabled, false);
  assert.equal(h.callbacks.muted.at(-1), true);
  const outputs = await media.outputs();
  assert.equal(outputs[0].id, "speaker");
  await media.output("speaker");
  assert.equal(h.room().selected, "speaker");
  h.room().failOutput = true;
  await assert.rejects(media.output("headphones"), /could not change/);
  media.dispose();
  await assert.rejects(media.mute(false), /ended/);
});

test("unsupported output selection does not request extra device permission", async () => {
  const h = harness({ noOutput: true }), media = await h.create();
  await media.connect();
  assert.equal((await media.outputs()).length, 0);
  media.dispose();
});

test("media cleanup is idempotent, stops capture, detaches audio and releases the tab lease", async () => {
  const h = harness(), media = await h.create();
  await media.connect();
  const track = h.makeTrack();
  h.room().emit(h.events.TrackSubscribed, track, {}, { identity: "sister" });
  await settle();
  media.dispose(); media.dispose();
  await settle();
  assert.equal(h.counts().stopped, 1);
  assert.equal(h.counts().removed, 1);
  assert.equal(h.counts().released, 1);
  assert.equal(h.room().disconnected, 1);
  assert.equal(h.room().eventNames().length, 0);
  h.room().emit(h.events.Disconnected);
  assert.equal(h.callbacks.disconnected, 0);
});

test("a stale account connection never enables the microphone", async () => {
  let release; const connectWait = new Promise(resolve => { release = resolve; });
  const h = harness({ connectWait }), media = await h.create();
  const pending = media.connect();
  h.invalidate(); release();
  await pending;
  assert.equal(h.room().localParticipant.isMicrophoneEnabled, false);
  assert.equal(h.room().disconnected, 1);
  assert.equal(h.callbacks.ready, 0);
});

test("late microphone capture after disposal is stopped and disconnected again", async () => {
  let release; const microphoneWait = new Promise(resolve => { release = resolve; });
  const h = harness({ microphoneWait }), media = await h.create();
  const pending = media.connect();
  await settle();
  media.dispose();
  release();
  await pending;
  assert.equal(h.room().lateMicrophoneStopped, true);
  assert.equal(h.room().disconnected, 2);
  assert.equal(h.callbacks.ready, 0);
  await settle();
  assert.equal(h.counts().released, 1);
});

test("element-level playback rejection stays visible even when the room reports audio allowed", async () => {
  const h = harness({ rejectElement: true }), media = await h.create();
  await media.connect();
  h.room().emit(h.events.TrackSubscribed, h.makeTrack(), {}, { identity: "sister" });
  await settle();
  h.room().emit(h.events.AudioPlaybackStatusChanged);
  assert.equal(h.room().canPlaybackAudio, true);
  assert.equal(h.callbacks.blocked.at(-1), true);
  assert.equal(h.callbacks.ready, 0);
  h.room().unlocked = true;
  await media.resumeAudio();
  assert.equal(h.callbacks.blocked.at(-1), false);
  assert.equal(h.callbacks.ready, 1);
  media.dispose();
});

test("a late unmute cannot recreate capture after hangup", async () => {
  const h = harness(), media = await h.create();
  await media.connect();
  await media.mute(true);
  let release;
  h.room().microphoneWait = new Promise(resolve => { release = resolve; });
  const pending = media.mute(false);
  media.dispose(); release();
  await assert.rejects(pending, /ended/);
  assert.equal(h.room().lateMicrophoneStopped, true);
  assert.equal(h.room().disconnected, 2);
});

test("reconnect and removed remote tracks leave the ready state until a playable path returns", async () => {
  const h = harness(), media = await h.create();
  await media.connect();
  const track = h.makeTrack();
  h.room().emit(h.events.TrackSubscribed, track, {}, { identity: "sister" });
  await settle();
  assert.equal(h.callbacks.ready, 1);
  h.room().state = "reconnecting";
  h.room().emit(h.events.Reconnecting);
  assert.equal(h.callbacks.reconnecting.length, 1);
  h.room().state = "connected";
  h.room().emit(h.events.Reconnected);
  assert.equal(h.callbacks.ready, 2);
  h.room().emit(h.events.TrackUnsubscribed, track);
  assert.equal(h.callbacks.reconnecting.length, 2);
  media.dispose();
});

test("a second tab cannot acquire a held media lease", async () => {
  const h = harness({ locked: true });
  await assert.rejects(h.create(), /another KUKU tab/);
  assert.equal(h.room(), undefined);
});

test("call time uses media timestamps and formats zero or invalid timestamps safely", () => {
  const state = load("src/callState.ts");
  assert.equal(state.callDuration(null, 10000), "0:00");
  assert.equal(state.callDuration(NaN, 10000), "0:00");
  assert.equal(state.callDuration(10000, 9000), "0:00");
  assert.equal(state.callDuration(1000, 126000), "2:05");
  assert.equal(state.mediaTimestamp({ accepted_at: "2026-11-04T00:00:00Z" }), null);
  assert.equal(state.mediaTimestamp({ media_ready_at: "invalid" }), null);
  assert.equal(state.mediaTimestamp({ media_ready_at: "2026-11-04T00:00:00Z" }), Date.parse("2026-11-04T00:00:00Z"));
  assert.equal(state.callIsTerminal({ status: "active" }), false);
  assert.equal(state.callIsTerminal({ status: "missed" }), true);
  assert.equal(state.callHistoryLabel({ status: "active", media_ready_at: null }), "Connecting audio");
  assert.equal(state.callHistoryLabel({ status: "completed", end_reason: "declined" }), "Declined");
  assert.equal(state.callHistoryLabel({ status: "completed", media_ready_at: null, duration_sec: 50 }), "Ended before audio connected");
  assert.equal(state.callHistoryLabel({ status: "completed", media_ready_at: "2026-11-04T00:00:00Z", duration_sec: 125 }), "2:05");
});

test("call API and socket tickets always retain the expected account scope", async () => {
  const requests = [];
  class FakeSocket { constructor(url) { this.url = url; } }
  const calls = load("src/calls.ts", { WebSocket: FakeSocket }, name => name === "./config" ? { API_ORIGIN: "https://api.example.test" } : {
    api: {
      getAs: async (uid, path) => { requests.push({ uid, path }); return {}; },
      postAs: async (uid, path, body) => { requests.push({ uid, path, body }); return { ticket: "a ticket" }; }
    }
  });
  await calls.callsApi.start("sister", "alice");
  await calls.callsApi.get("call/id", "alice");
  await calls.callsApi.heartbeat("call/id", "alice", true);
  const socket = await calls.openCallSocket("alice", () => {});
  assert.ok(requests.every(request => request.uid === "alice"));
  assert.equal(requests[1].path, "/calls/call%2Fid");
  assert.equal(requests[2].body.media_ready, true);
  assert.equal(socket.url, "wss://api.example.test/api/ws/calls?ticket=a%20ticket");
});
