const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs"), vm = require("node:vm"), ts = require("typescript");
function moduleSource(path, mocks = {}, globals = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(path, "utf8"), { fileName: path, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX } }).outputText, {
    exports, require: name => { if (name in mocks) return mocks[name]; throw new Error("Unexpected import " + name); },
    Date, Map, Set, Math, Number, String, URL, setTimeout, clearTimeout, ...globals
  });
  return exports;
}
const playback = moduleSource("src/spacePlayback.ts");
test("Space clock compensates a skewed device and prefers recent low-latency samples", () => {
  const first = playback.sampleServerClock("2026-11-04T12:00:00.000Z", 1000, 1200);
  assert.equal(first.offsetMs, Date.parse("2026-11-04T12:00:00.000Z") - 1100);
  assert.equal(playback.sampleServerClock("bad", 1200, 1400, first), first);
  assert.equal(playback.sampleServerClock("2026-11-04T12:00:01.000Z", 1300, 3000, first), first);
  const expired = playback.sampleServerClock("2026-11-04T12:01:10.000Z", 71000, 71400, first);
  assert.notEqual(expired, first);
  assert.equal(playback.sampleServerClock("2026-11-04T12:00:00.000Z", 500, 12000, first), first);
});
test("Space position extrapolates only playing state and clamps malformed, future and ended media", () => {
  const state = { is_playing: true, position_sec: 10, updated_at: "2026-11-04T12:00:00.000Z" };
  const now = Date.parse(state.updated_at) + 4000;
  assert.equal(playback.playbackPosition(state, now, 1000), 15);
  assert.equal(playback.playbackPosition({ ...state, is_playing: false }, now, 1000), 10);
  assert.equal(playback.playbackPosition(state, now, -10000), 10);
  assert.equal(playback.playbackPosition(state, now, 0, 12), 12);
  assert.equal(playback.playbackPosition({ ...state, updated_at: "bad", position_sec: NaN }, now), 0);
});
test("Stale Space commands cannot roll playback or host session back", () => {
  const state = { version: 9, session_id: "current", is_playing: true, position_sec: 20, updated_at: "2026-11-04T12:00:00Z" };
  assert.equal(playback.acceptsPlayback(state, { ...state, version: 8, updated_at: "2026-11-05T12:00:00Z" }), false);
  assert.equal(playback.acceptsPlayback(state, { ...state, version: 10, session_id: "next" }), true);
  assert.equal(playback.acceptsPlayback(state, { ...state, session_id: "old", updated_at: "2026-11-03T12:00:00Z" }), false);
});
test("Drift correction has a tolerance and reconnect backoff remains bounded", () => {
  assert.equal(playback.playbackCorrection(10, 10.1), "none");
  assert.equal(playback.playbackCorrection(10, 10.6, true), "seek");
  assert.equal(playback.playbackCorrection(10, 11), "seek");
  assert.equal(playback.playbackCorrection(NaN, 11), "none");
  assert.equal(playback.reconnectDelay(0, 0), 1000);
  assert.equal(playback.reconnectDelay(100, 1), 20500);
});
test("Room replay merges once, remains ordered and bounds retained history", () => {
  const data = playback.mergeSpaceMessages([{ id: "b", created_at: "2", text: "old" }, { id: "a", created_at: "1" }], [{ id: "b", created_at: "2", text: "new" }, { id: "c", created_at: "3" }], 2);
  assert.deepEqual(JSON.parse(JSON.stringify(data)), [{ id: "b", created_at: "2", text: "new" }, { id: "c", created_at: "3" }]);
});
function client({ fetch, getUid = () => "alice" }) {
  class ApiError extends Error { constructor(message, status) { super(message); this.status = status; } }
  return moduleSource("src/spaces.ts", { "react-native": { Platform: { OS: "web" } }, "./config": { API_ORIGIN: "https://api.kuku.test" }, "./api": { api: {}, ApiError, getToken: async () => "token", getSessionUserId: getUid } }, { fetch, location: { origin: "https://kuku.test" }, AbortController });
}
test("Space private audio URLs reject provider links, credentials and unrelated paths", () => {
  const api = client({});
  assert.equal(api.privateAudioUrl("/api/audio/stream?ticket=opaque"), "https://kuku.test/api/audio/stream?ticket=opaque");
  assert.equal(api.privateAudioUrl("https://api.kuku.test/api/audio/stream"), "https://api.kuku.test/api/audio/stream");
  for (const link of ["https://evil.test/api/audio/stream", "data:audio/wav;base64,YQ==", "javascript:alert(1)", "/other", "https://kuku.test@evil.test/api/audio/stream", "https://user:password@api.kuku.test/api/audio/stream", "/api/audio/stream#private"]) assert.throws(() => api.privateAudioUrl(link));
});
test("Space upload sends bounded raw bytes, never a base64 JSON payload", async () => {
  const bytes = new Blob(["audio"]), requests = [];
  const api = client({ fetch: async (url, options) => {
    if (!options) return { blob: async () => bytes };
    requests.push({ url, options });
    return { status: 200, json: async () => ({ id: "upload" }) };
  } });
  assert.equal((await api.uploadSpaceAudio({ uri: "blob:local", name: "family.wav", size: bytes.size }, "alice")).id, "upload");
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.body, bytes);
  assert.equal(requests[0].options.headers.Authorization, "Bearer token");
  assert.equal(requests[0].options.headers["Content-Type"], "application/octet-stream");
  assert.match(requests[0].url, /audio\/uploads\/binary\?name=family.wav/);
  await assert.rejects(api.uploadSpaceAudio({ uri: "blob:x", name: "large.wav", size: 10 * 1024 * 1024 + 1 }, "alice"), /10 MB/);
});
test("Switching account while audio bytes load prevents an upload under the wrong account", async () => {
  let uid = "alice", posted = 0;
  const api = client({ getUid: () => uid, fetch: async (url, options) => {
    if (options) { posted++; throw new Error("Unexpected POST"); }
    return { blob: async () => { uid = "bob"; return new Blob(["audio"]); } };
  } });
  await assert.rejects(api.uploadSpaceAudio({ uri: "blob:local", name: "a.wav" }, "alice"), /Account changed/);
  assert.equal(posted, 0);
});
test("A late upload response is not returned to a switched account", async () => {
  let uid = "alice";
  const api = client({ getUid: () => uid, fetch: async (url, options) => {
    if (!options) return { blob: async () => new Blob(["audio"]) };
    return { status: 200, json: async () => { uid = "bob"; return { id: "private-audio" }; } };
  } });
  await assert.rejects(api.uploadSpaceAudio({ uri: "blob:local", name: "a.wav" }, "alice"), /Account changed/);
});
test("Native YouTube bridge validates IDs, escapes embedded origins and contains valid executable JavaScript", () => {
  const module = moduleSource("src/SpaceYouTube.tsx", {
    react: {}, "react/jsx-runtime": {}, "react-native": { Platform: { OS: "web" } }, "react-native-webview": {},
    "./ThemeContext": {}, "./spaces": {}, "./spacePlayback": playback, "./config": { API_ORIGIN: "https://api.kuku.test" }
  });
  const html = module.youtubeHtml("dQw4w9WgXcQ");
  const inline = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.doesNotThrow(() => new vm.Script(inline));
  assert.match(inline, /enablejsapi:1/);
  assert.match(inline, /KukuSync/);
  const hostile = module.youtubeHtml("</script><script>alert(1)", "https://test/</script><script>alert(1)");
  assert.equal((hostile.match(/<script>/g) || []).length, 1);
  assert.doesNotThrow(() => new vm.Script(hostile.match(/<script>([\s\S]*?)<\/script>/)[1]));
});
