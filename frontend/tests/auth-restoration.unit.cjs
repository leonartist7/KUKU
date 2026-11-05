const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

const alice = {id: "alice", name: "Alice", email: "alice@example.test", email_verified: true, onboarding_complete: true};
const bob = {...alice, id: "bob", name: "Bob", email: "bob@example.test"};
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const compile = (file, jsx = false) => ts.transpileModule(fs.readFileSync(file, "utf8"), {compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, ...(jsx ? {jsx: ts.JsxEmit.React} : {}),
}}).outputText;
function cacheModule() {const exports = {}; vm.runInNewContext(compile("src/cachedProfile.ts"), {exports, Date}); return exports;}

function authHarness({cached = alice, serverUser = alice} = {}) {
  const storage = new Map(cached === null ? [] : [["kuku_profile", JSON.stringify(cached)]]);
  storage.set("connect_token", "legacy");
  const token = deferred(), calls = [], paints = [], expired = new Set();
  let epoch = 0, actualUser = null, expectedUser = null, contextValue, renderedTree;
  let tokenCalls = 0, mounted = true, queued = false, rendering = false, cursor = 0;
  const cells = [], pendingEffects = [], cleanups = new Map();
  const same = (a, b) => a && b && a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  function queueRender() {if (queued || !mounted) return; queued = true; queueMicrotask(() => {queued = false; if (mounted) render();});}
  const Provider = {};
  const react = {
    createContext: () => ({Provider}), useContext: () => contextValue,
    createElement: (type, props, ...children) => {if (type === Provider) contextValue = props.value;
      if (typeof type === "function") return type({...props, children});
      return {type, props, children};},
    useState: initial => {
      const index = cursor++;
      if (!(index in cells)) cells[index] = typeof initial === "function" ? initial() : initial;
      return [cells[index], update => {
        const next = typeof update === "function" ? update(cells[index]) : update;
        if (Object.is(next, cells[index])) return;
        cells[index] = next;
        if (index === 0 && next?.id) paints.push({uid: next.id, expectedUser, actualUser});
        queueRender();
      }];
    },
    useRef: initial => {const index = cursor++; if (!(index in cells)) cells[index] = {current: initial}; return cells[index];},
    useCallback: (callback, deps) => {const index = cursor++, before = cells[index]; if (before && same(before.deps, deps)) return before.callback;
      cells[index] = {callback, deps}; return callback;},
    useEffect: (effect, deps) => {const index = cursor++, before = cells[index]; if (!before || !same(before.deps, deps)) {cells[index] = {deps}; pendingEffects.push({index, effect});}},
  };
  class ApiError extends Error {constructor(message, status) {super(message); this.status = status;}}
  const api = {
    get: async route => {calls.push(["GET", route]); return serverUser;},
    getAs: async (uid, route) => {calls.push(["GETAS", route, uid]); if (uid !== actualUser) throw new ApiError("Account changed", 401); return serverUser;},
    post: async (route) => {calls.push(["POST", route]); return {token: "bob-access", user: bob};},
    postAs: async (uid, route) => {calls.push(["POSTAS", route, uid]); return {ok: true};},
  };
  const session = {
    api, ApiError,
    getToken: async () => {
      tokenCalls++; const started = epoch;
      const result = await token.promise;
      if (started === epoch && result) actualUser = serverUser.id;
      return result;
    },
    setToken: async value => {calls.push(["TOKEN", value]); if (!value) {actualUser = null; expectedUser = null; epoch++;}},
    acceptSession: async data => {calls.push(["ACCEPT", data.user.id]); actualUser = data.user.id; expectedUser = null; epoch++;},
    getSessionEpoch: () => epoch,
    setExpectedRestoredUser: (uid, expectedEpoch) => {if (epoch !== expectedEpoch) return false; expectedUser = uid; calls.push(["EXPECT", uid]); return true;},
    onSessionExpired: listener => {expired.add(listener); return () => expired.delete(listener);},
  };
  const mocks = {
    react: {default: react, ...react}, "react-native": {Platform: {OS: "web"}, View: "View", Text: "Text", Pressable: "Pressable", ActivityIndicator: "ActivityIndicator"},
    "react-native-safe-area-context": {SafeAreaView: "SafeAreaView"},
    "@react-native-async-storage/async-storage": {default: {
      getItem: async key => storage.get(key) || null,
      setItem: async (key, value) => {storage.set(key, value);},
      removeItem: async key => {storage.delete(key);},
    }},
    "./api": session, "./outbox": {clearOutbox: async uid => calls.push(["OUTBOX", uid])},
    "./browserPush": {setBrowserPushAccount: async uid => calls.push(["PUSH", uid])},
    "./cachedProfile": cacheModule(), "./ThemeContext": {useTheme: () => ({c: {}, f: {}})},
  };
  const exports = {};
  vm.runInNewContext(compile("src/AuthContext.tsx", true), {exports, require: name => {if (!mocks[name]) throw new Error("Unexpected import " + name); return mocks[name];}});
  function render() {
    if (rendering) throw new Error("Recursive render");
    rendering = true; cursor = 0;
    const result = exports.AuthProvider({children: "children"}); renderedTree = result;
    rendering = false;
    for (const {index, effect} of pendingEffects.splice(0)) {cleanups.get(index)?.(); const cleanup = effect(); if (cleanup) cleanups.set(index, cleanup);}
    return result;
  }
  render();
  return {token, api, ApiError, storage, calls, paints,
    get value() {return contextValue;}, get tree() {return renderedTree;}, get tokenCalls() {return tokenCalls;}, get actualUser() {return actualUser;},
    expire() {epoch++; actualUser = null; expectedUser = null; expired.forEach(listener => listener());},
    unmount() {mounted = false; for (const cleanup of cleanups.values()) cleanup();},
  };
}
async function settle() {for (let i = 0; i < 45; i++) await Promise.resolve();}

function actualApiHarness(responseUser = bob) {
  const calls = [];
  const exports = {}, response = deferred();
  const mocks = {
    "react-native": {Platform: {OS: "web"}}, "expo-secure-store": {},
    "./config": {API_ORIGIN: "https://api.example.test"},
  };
  vm.runInNewContext(compile("src/api.ts"), {exports, require: name => mocks[name], __DEV__: false,
    setTimeout, clearTimeout, AbortController, navigator: {},
    fetch: async (url, options) => {calls.push({url, options}); if (url === "/api/auth/refresh") return response.promise;
      return new Response(JSON.stringify({user: exports.getSessionUserId()}), {headers: {"content-type": "application/json"}});},
  });
  return {api: exports, calls, respond: () => response.resolve(new Response(JSON.stringify({token: responseUser.id + "-access", user: responseUser}), {headers: {"content-type": "application/json"}}))};
}

test("cache parsing bounds identity/flags and strips credentials and external avatar URLs", () => {
  const {readCachedProfile, canShowCachedShell} = cacheModule();
  const parsed = readCachedProfile(JSON.stringify({...alice, token: "SECRET", avatar: "https://tracking.example.test/avatar.jpg"}));
  assert.equal(parsed.id, "alice"); assert.equal(parsed.token, undefined); assert.equal(parsed.avatar, null); assert.equal(canShowCachedShell(parsed), true);
  for (const value of [null, "bad JSON", "x".repeat(150001), JSON.stringify({...alice, id: "../bob"}), JSON.stringify({...alice, name: []}), JSON.stringify({...alice, email_verified: "true"})]) assert.equal(readCachedProfile(value), null);
  assert.equal(canShowCachedShell({...alice, email_verified: false}), false);
  assert.equal(canShowCachedShell({...alice, onboarding_complete: false}), false);
});

test("valid saved profile paints before unresolved refresh, with no client authentication proof", async () => {
  const h = authHarness(); await settle();
  assert.equal(h.value.user.id, "alice"); assert.equal(h.value.restoring, true); assert.equal(h.actualUser, null);
  assert.match(h.value.connectionNotice, /saved profile.*check your account/i);
  assert.equal(h.tokenCalls, 1); assert.equal(h.calls.some(call => call[0] === "GETAS"), false);
  assert.deepEqual(h.paints[0], {uid: "alice", expectedUser: "alice", actualUser: null});
  await assert.rejects(h.value.updateProfile("New name", ""), /reconnecting/i);
  h.unmount();
});

test("same-account server restore replaces cached metadata and ends restoration", async () => {
  const h = authHarness({serverUser: {...alice, name: "Alice, refreshed"}}); await settle();
  h.token.resolve("alice-access"); await settle();
  assert.equal(h.value.user.name, "Alice, refreshed"); assert.equal(h.value.restoring, false); assert.equal(h.value.connectionNotice, null);
  assert.equal(JSON.parse(h.storage.get("kuku_profile")).name, "Alice, refreshed");
  assert.equal(h.storage.has("connect_token"), false); h.unmount();
});

test("invalid and disabled sessions clear cached identity and never become authenticated", async () => {
  for (const status of [401, 403]) {
    const h = authHarness(); await settle(); h.token.reject(new h.ApiError("Session unavailable", status)); await settle();
    assert.equal(h.value.user, null); assert.equal(h.value.restoring, false); assert.equal(h.storage.has("kuku_profile"), false);
    assert.equal(h.actualUser, null); h.unmount();
  }
});

test("network failure keeps a cached shell unproven until a successful retry", async () => {
  const h = authHarness(); await settle(); h.token.reject(new Error("offline")); await settle();
  assert.equal(h.value.user.id, "alice"); assert.equal(h.value.restoring, true); assert.match(h.value.connectionNotice, /verify your account/i);
  assert.equal(h.storage.has("kuku_profile"), true); h.unmount();
});

test("fresh web visits and malformed saved profiles reach sign-in without waking the API", async () => {
  for (const cached of [null, {...alice, email_verified: "yes"}]) {
    const h = authHarness({cached}); await settle();
    assert.equal(h.value.user, null); assert.equal(h.value.restoring, false); assert.equal(h.tokenCalls, 0);
    assert.equal(h.calls.some(call => call[0].startsWith("GET")), false); assert.equal(h.storage.has("kuku_profile"), false); h.unmount();
  }
});

test("cached verification/onboarding workflows wait for server proof", async () => {
  const h = authHarness({cached: {...alice, email_verified: false, onboarding_complete: false}}); await settle();
  assert.equal(h.value.user, undefined); assert.equal(h.value.restoring, true); h.unmount();
});

test("a late restore failure cannot overwrite a newer explicit account login", async () => {
  const h = authHarness(); await settle();
  await h.value.signIn("bob@example.test", "passphrase"); await settle();
  h.token.reject(new Error("late offline failure")); await settle();
  assert.equal(h.value.user.id, "bob"); assert.equal(h.value.restoring, false); assert.equal(h.value.connectionNotice, null);
  assert.equal(JSON.parse(h.storage.get("kuku_profile")).id, "bob"); h.unmount();
});

test("successful logout cannot be undone by a late restore response", async () => {
  const h = authHarness(); await settle();
  await h.value.signOut(); await settle(); h.token.resolve("alice-access"); await settle();
  assert.equal(h.value.user, null); assert.equal(h.value.restoring, false); assert.equal(h.storage.has("kuku_profile"), false);
  assert.ok(h.calls.some(call => call[0] === "OUTBOX" && call[1] === "alice")); h.unmount();
});

test("failed sign-out leaves cached identity unproven and makes its reconnect retry usable", async () => {
  const h = authHarness(); await settle();
  h.api.postAs = async () => {throw new Error("offline logout");};
  await assert.rejects(h.value.signOut(), /offline logout/); await settle();
  assert.equal(h.value.user.id, "alice"); assert.equal(h.value.restoring, true);
  function find(node, id) {
    if (!node || typeof node !== "object") return undefined;
    if (node.props?.testID === id) return node;
    for (const child of node.children || []) {if (Array.isArray(child)) {for (const item of child) {const found = find(item, id); if (found) return found;}}
      else {const found = find(child, id); if (found) return found;}}
  }
  const retry = find(h.tree, "session-restore-retry"); assert.ok(retry, "Do not leave a cancelled restore spinner blocking Retry");
  retry.props.onPress(); await settle(); h.token.resolve("alice-access"); await settle();
  assert.equal(h.value.user.id, "alice"); assert.equal(h.value.restoring, false); h.unmount();
});

test("session expiration clears an immediate cached shell and ignores its later response", async () => {
  const h = authHarness(); await settle(); h.expire(); await settle();
  h.token.resolve("alice-access"); await settle();
  assert.equal(h.value.user, null); assert.equal(h.value.restoring, false); assert.equal(h.storage.has("kuku_profile"), false); h.unmount();
});

test("already validated refresh remains proven while pending or offline", async () => {
  const h = authHarness(); await settle(); h.token.resolve("alice-access"); await settle();
  assert.equal(h.value.restoring, false);
  const pending = deferred(); h.api.getAs = () => pending.promise;
  const refreshing = h.value.refresh(); await settle();
  assert.equal(h.value.restoring, false, "A pending profile refresh must not stop active session consumers");
  pending.reject(new Error("offline")); await refreshing; await settle();
  assert.equal(h.value.user.id, "alice"); assert.equal(h.value.restoring, false); assert.match(h.value.connectionNotice, /current session has been kept/i); h.unmount();
});

test("a mismatched account response is never adopted from a cached profile", async () => {
  const h = authHarness(); await settle(); h.api.getAs = async () => bob;
  h.token.resolve("alice-access"); await settle();
  assert.equal(h.value.user, null); assert.equal(h.storage.has("kuku_profile"), false); h.unmount();
});

test("API constraint rejects cookie Bob before storing credentials or dispatching generic private requests", async () => {
  const h = actualApiHarness(bob);
  assert.equal(h.api.setExpectedRestoredUser("alice", h.api.getSessionEpoch()), true);
  assert.equal(h.api.getSessionUserId(), null, "Expected cached ID is not authentication proof");
  const get = h.api.api.get("/chats"), post = h.api.api.post("/invites", {});
  h.respond(); const results = await Promise.allSettled([get, post]);
  assert.ok(results.every(result => result.status === "rejected" && result.reason.status === 401));
  assert.equal(h.api.getSessionUserId(), null);
  assert.deepEqual(h.calls.map(call => call.url), ["/api/auth/refresh"]);
});

test("stale restoration cannot rebind an explicitly logged-in or logged-out session", async () => {
  const h = actualApiHarness(alice), before = h.api.getSessionEpoch();
  h.api.setExpectedRestoredUser("alice", before);
  const privateRead = h.api.api.get("/chats");
  await h.api.acceptSession({token: "bob-access", user: bob});
  assert.equal(h.api.setExpectedRestoredUser("alice", before), false);
  h.respond(); await assert.rejects(privateRead, error => error.status === 401);
  assert.equal(h.api.getSessionUserId(), "bob");
  assert.equal(h.calls.some(call => call.url === "/api/chats"), false);
  await h.api.setToken(null);
  assert.equal(h.api.setExpectedRestoredUser("alice", before), false); assert.equal(h.api.getSessionUserId(), null);
});

