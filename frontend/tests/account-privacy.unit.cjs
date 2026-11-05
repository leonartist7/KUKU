const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function harness({page, platform = "web", share = async () => ({action: "sharedAction"})} = {}) {
  let uid = "alice";
  const calls = [], downloads = [], urls = [], revoked = [], timers = [];
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync("src/accountExport.ts", "utf8"), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022},
  }).outputText;
  const api = {getAs: async (account, path) => {
    calls.push({account, path});
    const query = new URL("https://example.test" + path).searchParams;
    return page ? page(query, () => {uid = "bob";}) : {schema_version: 1, section: query.get("section"), items: [{mine: true}], next_cursor: null};
  }};
  vm.runInNewContext(source, {
    exports, Set, Date, JSON, Blob, Error, Promise,
    setTimeout: fn => {timers.push(fn); return 1;},
    URL: {createObjectURL: blob => {urls.push(blob); return "blob:synthetic-export";}, revokeObjectURL: url => revoked.push(url)},
    document: {body: {appendChild() {}}, createElement: () => {
      const link = {click: () => downloads.push({href: link.href, download: link.download}), remove() {}};
      return link;
    }},
    require: name => name === "react-native" ? {Platform: {OS: platform}, Share: {share, dismissedAction: "dismissedAction"}} : {api, getSessionUserId: () => uid},
  });
  return {module: exports, calls, downloads, urls, revoked, timers, setUser: value => {uid = value;}};
}

test("account export follows scoped pages without persisting cursor credentials", async () => {
  const h = harness({page: query => ({
    schema_version: 1, section: query.get("section"),
    items: [{id: query.get("cursor") ? "second" : "first"}],
    next_cursor: query.get("section") === "messages" && !query.get("cursor") ? "signed.cursor" : null,
  })});
  const data = await h.module.collectAccountExport("alice");
  assert.equal(data.sections.messages.length, 2);
  assert.ok(h.calls.every(call => call.account === "alice"));
  assert.equal(h.calls.length, 8);
  assert.ok(!JSON.stringify(data).includes("signed.cursor"));
});

test("account switch aborts export before any download", async () => {
  const h = harness({page: (query, change) => {
    change();
    return {schema_version: 1, section: query.get("section"), items: [], next_cursor: null};
  }});
  await assert.rejects(h.module.collectAccountExport("alice"), /account changed/i);
  assert.equal(h.calls.length, 1);
  assert.equal(h.downloads.length, 0);
});

test("invalid or looping export pages fail safely", async () => {
  const looping = harness({page: query => ({schema_version: 1, section: query.get("section"), items: [], next_cursor: "same"})});
  await assert.rejects(looping.module.collectAccountExport("alice"), /could not advance/i);
  const malformed = harness({page: query => ({schema_version: 1, section: query.get("section"), items: [], next_cursor: 12})});
  await assert.rejects(malformed.module.collectAccountExport("alice"), /could not be read/i);
});

test("cancelling an export stops pagination and prevents a later download", async () => {
  let active = true;
  const h = harness({page: query => {
    active = false;
    return {schema_version: 1, section: query.get("section"), items: [], next_cursor: "more"};
  }});
  await assert.rejects(h.module.collectAccountExport("alice", undefined, () => active), /cancelled/i);
  assert.equal(h.calls.length, 1);
  assert.equal(h.downloads.length, 0);
});

test("export enforces byte bounds using UTF-8 content", async () => {
  const h = harness({page: query => ({
    schema_version: 1, section: query.get("section"),
    items: [{text: "界".repeat(1_500_000)}], next_cursor: null,
  })});
  await assert.rejects(h.module.collectAccountExport("alice"), /beta export limit/i);
  assert.equal(h.downloads.length, 0);
});

test("web export downloads actual JSON and revokes its object URL", async () => {
  const h = harness();
  const data = await h.module.collectAccountExport("alice");
  assert.equal(await h.module.saveAccountExport("alice", data), "downloaded");
  assert.equal(h.downloads.length, 1);
  assert.match(h.downloads[0].download, /^kuku-personal-data-.*\.json$/);
  assert.equal(JSON.parse(await h.urls[0].text()).schema_version, 1);
  assert.equal(h.revoked.length, 0);
  h.timers.forEach(fn => fn());
  assert.deepEqual(h.revoked, ["blob:synthetic-export"]);
});

test("native export shares real JSON and reports cancellation honestly", async () => {
  let shared;
  const h = harness({platform: "android", share: async value => {shared = value; return {action: "dismissedAction"};}});
  const data = await h.module.collectAccountExport("alice");
  assert.equal(await h.module.saveAccountExport("alice", data), "cancelled");
  assert.equal(JSON.parse(shared.message).schema_version, 1);
  assert.equal(h.downloads.length, 0);
});

test("native share rejects oversized text and stale account identity", async () => {
  const h = harness({platform: "android"});
  await assert.rejects(h.module.saveAccountExport("alice", {sections: {messages: ["a".repeat(210 * 1024)]}}), /browser/i);
  h.setUser("bob");
  await assert.rejects(h.module.saveAccountExport("alice", {sections: {}}), /account changed/i);
});

