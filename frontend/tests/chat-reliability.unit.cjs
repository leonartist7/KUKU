const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const tick = () => new Promise(resolve => setImmediate(resolve));
function transpile(file) {
  return ts.transpileModule(fs.readFileSync(file, "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}
  }).outputText;
}
function apiHarness(fetch, {native = false, files = {}, secure = {}} = {}) {
  const exports = {};
  vm.runInNewContext(transpile("src/api.ts"), {
    exports, __DEV__: false, Response, AbortController, setTimeout, clearTimeout, Set, Promise, Error,
    fetch,
    require: name => name === "react-native" ? {Platform: {OS: native ? "android" : "web"}}
      : name === "./config" ? {API_ORIGIN: "https://api.example"}
      : name === "expo-file-system/legacy" ? files : secure,
  });
  return exports;
}
function pureModule(file) {
  const exports = {};
  vm.runInNewContext(transpile(file), {exports, Math, Number});
  return exports;
}

test("late private response and decoded body cannot escape their original account", async () => {
  let resolveFetch;
  const api = apiHarness(() => new Promise(resolve => { resolveFetch = resolve; }));
  await api.acceptSession({token: "alice-access", user: {id: "alice"}});
  const read = api.api.getAs("alice", "/chats/private");
  await tick();
  await api.setToken(null);
  await api.acceptSession({token: "bob-access", user: {id: "bob"}});
  resolveFetch(new Response(JSON.stringify({private: "alice"})));
  await assert.rejects(read, /Account changed/);
  assert.equal(api.getSessionUserId(), "bob");

  let resolveBody;
  const second = apiHarness(async () => ({ok: true, status: 200, json: () => new Promise(resolve => { resolveBody = resolve; })}));
  await second.acceptSession({token: "first", user: {id: "alice"}});
  const bodyRead = second.api.getAs("alice", "/chats/private");
  await tick();
  await second.setToken(null);
  await second.acceptSession({token: "second", user: {id: "bob"}});
  resolveBody({private: "alice"});
  await assert.rejects(bodyRead, /Account changed/);
});

test("request deadline aborts a stalled request without discarding the account", async () => {
  const api = apiHarness(() => { throw new Error("No network expected"); });
  await api.acceptSession({token: "still-valid", user: {id: "alice"}});
  let signal;
  const pending = api.withRequestDeadline(value => { signal = value; return new Promise(() => {}); }, 5);
  await assert.rejects(pending, error => error.status === 408 && /try again/i.test(error.message));
  assert.equal(signal.aborted, true);
  assert.equal(api.getSessionUserId(), "alice");
  assert.equal(await api.getToken(), "still-valid");
});

test("401 refresh rotates the same account and retries its read exactly once", async () => {
  let reads = 0, refreshes = 0;
  const api = apiHarness(async url => {
    if (url.endsWith("/auth/refresh")) {
      refreshes++;
      return new Response(JSON.stringify({token: "rotated", user: {id: "alice"}}));
    }
    reads++;
    return reads === 1 ? new Response("{}", {status: 401}) : new Response(JSON.stringify({ok: true}));
  });
  await api.acceptSession({token: "expired", user: {id: "alice"}});
  const epoch = api.getSessionEpoch();
  assert.equal((await api.api.getAs("alice", "/chats")).ok, true);
  assert.equal(api.getSessionEpoch(), epoch);
  assert.equal(reads, 2); assert.equal(refreshes, 1);
});

test("a cross-account refresh cookie cannot silently adopt another person's session", async () => {
  const api = apiHarness(async () => new Response(JSON.stringify({token: "bob", user: {id: "bob"}})));
  await api.acceptSession({token: "alice", user: {id: "alice"}});
  let expired = 0;
  api.onSessionExpired(() => expired++);
  assert.equal(await api.refreshSession(), null);
  assert.equal(api.getSessionUserId(), null);
  assert.equal(expired, 1);
});

test("late refresh cannot restore logout or clear a newer refresh flight", async () => {
  const pending = [];
  const api = apiHarness(() => new Promise(resolve => pending.push(resolve)));
  const first = api.refreshSession();
  await tick();
  await api.setToken(null);
  const second = api.refreshSession();
  await tick();
  pending[0](new Response(JSON.stringify({token: "old", user: {id: "alice"}})));
  assert.equal(await first, null);
  const shared = api.refreshSession();
  assert.equal(pending.length, 2);
  pending[1](new Response(JSON.stringify({token: "new", user: {id: "bob"}})));
  assert.equal(await second, "new"); assert.equal(await shared, "new");
  assert.equal(api.getSessionUserId(), "bob");
});

test("native upload checks the account again after asynchronous file inspection", async () => {
  let inspect, uploads = 0;
  const api = apiHarness(() => { throw new Error("No HTTP expected"); }, {
    native: true,
    files: {getInfoAsync: () => new Promise(resolve => { inspect = resolve; }), FileSystemUploadType: {BINARY_CONTENT: 0},
      createUploadTask: () => { uploads++; return {uploadAsync: async () => ({status: 200, body: "{}"})}; }},
  });
  await api.acceptSession({token: "alice", user: {id: "alice"}});
  const upload = api.uploadAttachment("private-chat", "file:///photo.jpg", "photo.jpg", "alice");
  await tick();
  await api.acceptSession({token: "bob", user: {id: "bob"}});
  inspect({exists: true, isDirectory: false, size: 100});
  await assert.rejects(upload, /Account changed/);
  assert.equal(uploads, 0);
});

test("realtime frames reject malformed cursors and discard unexpected private fields", () => {
  const {parseChatFrame, reconnectDelay} = pureModule("src/chatRealtimeCore.ts");
  const good = {type: "chat_changed", cursor: 4, chat_id: "chat", message_id: "message", sender_id: "alice", live: true, text: "never forwarded"};
  const frame = parseChatFrame(good);
  assert.equal(frame.live, true);
  assert.equal(frame.text, undefined);
  for (const bad of [null, {...good, cursor: -1}, {...good, cursor: 1.5}, {...good, sender_id: ""}, {...good, message_id: null}, {type: "unknown", cursor: 2}]) {
    assert.equal(parseChatFrame(bad), null);
  }
  assert.equal(parseChatFrame({type: "replay_complete", cursor: 5}).cursor, 5);
  assert.equal(parseChatFrame({type: "cursor", cursor: 6}).type, "cursor");
  assert.equal(reconnectDelay(0, 0), 800);
  assert.equal(reconnectDelay(10, 1), 36_000);
});

function connectionHarness() {
  const core = pureModule("src/chatRealtimeCore.ts"), exports = {};
  const sockets = [], statuses = [], requests = [];
  let currentUser = "alice";
  class Socket {
    constructor(url) { this.url = url; this.readyState = 0; sockets.push(this); }
    open() { this.readyState = 1; this.onopen?.({}); }
    receive(value) { this.onmessage?.({data: JSON.stringify(value)}); }
    send() {}
    close() { this.readyState = 3; }
  }
  vm.runInNewContext(transpile("src/chatRealtime.ts"), {
    exports, WebSocket: Socket, Set, Map, Math, Number, Date, Error, JSON,
    setTimeout, clearTimeout, setInterval, clearInterval,
    require: name => name === "./chatRealtimeCore" ? core
      : name === "./config" ? {API_ORIGIN: "https://api.example"}
      : {getSessionUserId: () => currentUser, api: {
        postAs: async (uid, path, body) => { requests.push({uid, path, body}); return {ticket: "single-use"}; },
        getAs: async () => ({events: [], cursor: 0, reset: false})
      }},
  });
  return {exports, sockets, statuses, requests, setUser: uid => { currentUser = uid; }};
}

test("one realtime owner replays once, advances filtered cursors and resumes by account cursor", async () => {
  const h = connectionHarness(), alice = [], bob = [];
  const stopAlice = h.exports.subscribeChatEvents("alice", event => alice.push(event));
  const stopBob = h.exports.subscribeChatEvents("bob", event => bob.push(event));
  const connection = h.exports.createChatConnection("alice", status => h.statuses.push(status));
  try {
    connection.setActive(true); connection.setActive(true); await tick();
    assert.equal(h.sockets.length, 1);
    const socket = h.sockets[0]; socket.open();
    socket.receive({type: "ready", cursor: 10, reset: true});
    const message = {type: "chat_changed", chat_id: "chat", message_id: "one", sender_id: "bob", cursor: 11, live: false};
    socket.receive(message); socket.receive(message);
    socket.receive({type: "replay_complete", cursor: 12});
    socket.receive({...message, message_id: "filtered", cursor: 12, live: true});
    socket.receive({...message, message_id: "new", cursor: 13, live: true});
    assert.deepEqual(alice.map(event => event.type), ["ready", "chat_changed", "chat_changed"]);
    assert.equal(alice[1].live, false); assert.equal(alice[2].live, true);
    assert.equal(bob.length, 0);
    connection.setActive(false);
    assert.equal(socket.readyState, 3);
    connection.setActive(true); await tick();
    assert.match(h.sockets[1].url, /after=13/);
    assert.ok(h.requests.every(request => request.uid === "alice" && request.body.scope === "messages"));
  } finally { connection.stop(); stopAlice(); stopBob(); }
});

test("a pending connection ticket cannot open after its owner switches accounts", async () => {
  const h = connectionHarness();
  const connection = h.exports.createChatConnection("alice", () => {});
  try {
    connection.setActive(true);
    h.setUser("bob");
    await tick();
    assert.equal(h.sockets.length, 0);
  } finally { connection.stop(); }
});

