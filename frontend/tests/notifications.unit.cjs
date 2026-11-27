const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function browserHarness() {
  let uid = "alice", epoch = 1, subscription;
  const calls = {api: [], subscribe: 0, unsubscribe: 0, permission: 0, shown: [], accounts: []};
  const notification = {permission: "granted", requestPermission: async () => {calls.permission++; return "granted";}};
  const reg = {
    active: {postMessage: (payload, ports) => {calls.accounts.push(payload.userId); queueMicrotask(() => ports[0].peer.onmessage?.({data: {ok: true}}));}},
    installing: null, waiting: null,
    pushManager: {
      getSubscription: async () => subscription || null,
      subscribe: async () => {calls.subscribe++; subscription = {toJSON: () => ({endpoint: "https://fcm.googleapis.com/synthetic", keys: {p256dh: "synthetic", auth: "synthetic"}}),
        unsubscribe: async () => {calls.unsubscribe++; subscription = null; return true;}}; return subscription;},
    },
    showNotification: async (title, options) => {calls.shown.push({title, ...options});},
  };
  const worker = {register: async () => reg, ready: Promise.resolve(reg), getRegistration: async () => reg};
  const api = {
    getAs: async (user, route) => {calls.api.push({method: "GET", user, route}); return {available: true, public_key: "AQ"};},
    postAs: async (user, route) => {calls.api.push({method: "POST", user, route});},
    deleteAs: async (user, route) => {calls.api.push({method: "DELETE", user, route});},
  };
  class Channel {constructor() {this.port1 = {close() {}}; this.port2 = {peer: this.port1};}}
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync("src/browserPush.ts", "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(source, {exports, setTimeout, clearTimeout, queueMicrotask, Uint8Array, atob,
    MessageChannel: Channel, Notification: notification, navigator: {serviceWorker: worker},
    window: {isSecureContext: true, Notification: notification, PushManager: {}},
    require: () => ({api, getSessionUserId: () => uid, getSessionEpoch: () => epoch})});
  return {exports, calls, api, notification, reg, setAccount: next => {uid = next; epoch++;}};
}

test("notification diagnostics read support and server state without requesting permission or enrolling", async () => {
  const h = browserHarness();
  h.notification.permission = "default";
  const status = await h.exports.browserPushStatus("alice");
  assert.equal(status.permission, "default"); assert.equal(status.subscribed, false); assert.equal(status.serverAvailable, true);
  assert.equal(h.calls.permission, 0); assert.equal(h.calls.subscribe, 0);
  assert.deepEqual(h.calls.api.map(call => call.method), ["GET"]);
});

test("a delayed permission grant cannot register a different account", async () => {
  const h = browserHarness(); let allow;
  h.notification.permission = "default";
  h.notification.requestPermission = () => {h.calls.permission++; return new Promise(resolve => {allow = resolve;});};
  const pending = h.exports.enableBrowserPush("alice", true);
  assert.equal(h.calls.permission, 1, "Permission is requested directly before any network work");
  h.setAccount("bob"); allow("granted");
  await assert.rejects(pending, /account changed/i);
  assert.equal(h.calls.api.length, 0); assert.equal(h.calls.subscribe, 0);
});

test("notification disable is account-bound and cannot unsubscribe a newly switched account", async () => {
  const h = browserHarness();
  await h.exports.enableBrowserPush("alice", true);
  h.api.deleteAs = async (uid, route) => {h.calls.api.push({method: "DELETE", user: uid, route}); h.setAccount("bob");};
  await assert.rejects(h.exports.disableBrowserPush("alice"), /account changed/i);
  assert.equal(h.calls.unsubscribe, 0);
  assert.ok(h.calls.api.some(call => call.method === "DELETE" && call.user === "alice"));
});

test("local notification test does not contact the push API or expose conversation content", async () => {
  const h = browserHarness();
  await h.exports.testBrowserNotification("alice");
  assert.equal(h.calls.shown.length, 1); assert.equal(h.calls.api.length, 0); assert.equal(h.calls.subscribe, 0);
  assert.equal(h.calls.shown[0].data.localTest, true);
  assert.equal(h.calls.shown[0].data.chatId, undefined);
  assert.match(h.calls.shown[0].body, /local notification test/);
});

test("device test never requests permission and rejects a blocked device", async () => {
  const h = browserHarness(); h.notification.permission = "denied";
  await assert.rejects(h.exports.testBrowserNotification("alice"), /Allow notifications/);
  assert.equal(h.calls.permission, 0); assert.equal(h.calls.shown.length, 0);
});

test("offline server status stays unknown rather than reporting notification delivery ready", async () => {
  const h = browserHarness();
  h.api.getAs = async () => {throw new Error("offline");};
  const status = await h.exports.browserPushStatus("alice");
  assert.equal(status.serverAvailable, null); assert.match(status.note, /couldn't be checked/);
  assert.equal(status.subscribed, false);
});

