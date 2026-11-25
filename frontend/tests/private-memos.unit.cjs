const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const tick = async () => {for (let index = 0; index < 20; index++) await Promise.resolve();};
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
function compile(file, jsx = false) {return ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions: {
  module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, ...(jsx ? {jsx: ts.JsxEmit.React} : {}),
}}).outputText;}
function leaseModule() {
  const exports = {}; vm.runInNewContext(compile('src/privateMemoLease.ts'), {exports, AbortController, Set}); return exports;
}
function harness({platform = 'web', download, get, fetchBody} = {}) {
  let uid = 'alice', epoch = 1, focused = true, restoring = false, cursor = 0, currentProps, component, tree;
  const cells = [], effects = [], cleanups = new Map(), boundaries = new Set();
  const calls = [], audio = [], revoked = [], objectUrls = [], removedFiles = [], alerts = [], opened = [];
  const same = (one, two) => one && two && one.length === two.length && one.every((value, index) => Object.is(value, two[index]));
  const react = {
    createElement: (type, props, ...children) => ({type, props: props || {}, children}),
    useRef: initial => {const index = cursor++; if (!(index in cells)) cells[index] = {current: initial}; return cells[index];},
    useState: initial => {const index = cursor++; if (!(index in cells)) cells[index] = initial; return [cells[index], update => {cells[index] = typeof update === 'function' ? update(cells[index]) : update;}];},
    useEffect: (effect, deps) => {const index = cursor++; if (!same(cells[index], deps)) {cells[index] = deps; effects.push({index, effect});}},
  };
  function makeAudio(source) {
    const value = {source, paused: 0, released: 0, loaded: 0, played: 0, ended: false, currentTime: 0,
      pause() {this.paused++;}, release() {this.released++;}, play() {this.played++; return Promise.resolve();},
      removeAttribute() {}, load() {this.loaded++;}, addListener() {return {remove() {}};}, seekTo() {return Promise.resolve();},
    }; audio.push(value); return value;
  }
  const files = {cacheDirectory: 'file:///cache/', downloadAsync: async (url, path) => download ? download(url, path) : {status: 200, uri: path},
    deleteAsync: async path => {removedFiles.push(path);}};
  const modules = {
    'react': react, '@react-navigation/native': {useIsFocused: () => focused},
    'react-native': {Platform: {OS: platform}, View: 'View', Text: 'Text', Pressable: 'Pressable', StyleSheet: {create: value => value}, Alert: {alert: (...args) => alerts.push(args)}},
    '@expo/vector-icons/Ionicons': {default: 'Ionicons'}, 'expo-audio': {createAudioPlayer: makeAudio},
    './ThemeContext': {useTheme: () => ({c: {}, f: {}})}, './theme': {radius: {}, spacing: {}},
    './AuthContext': {useAuth: () => ({user: {id: uid}, restoring})}, './privateMemoLease': leaseModule(),
    './downloads': {openPrivateDownload: async url => {opened.push(url);}},
    './api': {getSessionEpoch: () => epoch, getSessionUserId: () => uid, onSessionBoundary: callback => {boundaries.add(callback); return () => boundaries.delete(callback);},
      api: {getAs: async (account, route) => {calls.push(['get', account, route]); return get ? get(account, route) : {url: 'https://files.example.test/memo?ticket=secret', media_type: 'audio/webm'};},
        deleteAs: async (account, route) => {calls.push(['delete', account, route]); return {};}}},
    'expo-file-system/legacy': files,
  };
  const exports = {};
  vm.runInNewContext(compile('src/MessageParts.tsx', true), {
    exports, React: react, require: name => {if (!modules[name]) throw new Error('Unexpected module ' + name); return modules[name];},
    AbortController, Date, Error, Blob, URL: {createObjectURL: () => {const value = 'blob:memo-' + objectUrls.length; objectUrls.push(value); return value;}, revokeObjectURL: url => revoked.push(url)},
    Audio: function(source) {return makeAudio(source);}, window: {confirm: () => true},
    fetch: async () => ({ok: true, arrayBuffer: async () => fetchBody ? fetchBody() : new ArrayBuffer(16)}),
  });
  function render(props = currentProps) {
    currentProps = props; cursor = 0; tree = component(currentProps);
    for (const {index, effect} of effects.splice(0)) {cleanups.get(index)?.(); const cleanup = effect(); if (cleanup) cleanups.set(index, cleanup); else cleanups.delete(index);}
    return tree;
  }
  function find(node, predicate) {if (!node) return; if (predicate(node)) return node; for (const child of node.children || []) {if (Array.isArray(child)) {for (const item of child) {const found = find(item, predicate); if (found) return found;}} else if (typeof child === 'object') {const found = find(child, predicate); if (found) return found;}}}
  return {calls, audio, revoked, objectUrls, removedFiles, alerts, opened,
    voice(props = {durationMs: 1000, outgoing: false, attachmentId: 'memo'}) {component = exports.VoiceMessageBubble; return render(props);},
    file(props = {attachmentId: 'file', canDelete: true, type: 'file'}) {component = exports.FilePreviewCard; return render(props);},
    render, button: () => find(tree, node => node.type === 'Pressable'), text: () => JSON.stringify(tree),
    blur() {focused = false; render();}, revoke() {render({...currentProps, unavailable: true});},
    account(next = 'bob') {uid = next; epoch++; boundaries.forEach(listener => listener());},
    dispose() {for (const cleanup of cleanups.values()) cleanup(); cleanups.clear();},
  };
}

test('private memo leases dispose late resources and continue through a failed cleanup', () => {
  let active = true; const lease = leaseModule().createPrivateMemoLease(() => active), cleaned = [];
  lease.own(() => {cleaned.push('first'); throw new Error('cleanup failure');});
  lease.own(() => cleaned.push('second'));
  active = false; const late = lease.own(() => cleaned.push('late')); late(); lease.close(); lease.close();
  assert.equal(lease.current(), false); assert.equal(lease.signal.aborted, true);
  assert.deepEqual(cleaned.sort(), ['first', 'late', 'second']);
});

test('late memo bytes after unmount cannot create an object URL or player', async () => {
  const body = deferred(), h = harness({fetchBody: () => body.promise}); h.voice();
  const pending = h.button().props.onPress(); await tick(); h.dispose(); body.resolve(new ArrayBuffer(16)); await pending; await tick();
  assert.equal(h.objectUrls.length, 0); assert.equal(h.audio.length, 0);
});

test('navigation, attachment revocation and session loss stop and release private playback', async () => {
  for (const boundary of ['blur', 'revoke', 'account']) {
    const h = harness(); h.voice(); h.button().props.onPress(); await tick();
    assert.equal(h.audio[0].played, 1); h[boundary]();
    assert.ok(h.audio[0].paused > 0); assert.equal(h.audio[0].loaded, 1);
    assert.deepEqual(h.revoked, h.objectUrls); h.dispose(); assert.equal(h.revoked.length, 1);
  }
});

test('late native downloads are removed again after cancellation and never start a player', async () => {
  const transfer = deferred(); let target;
  const h = harness({platform: 'android', download: (url, path) => {target = path; return transfer.promise;}});
  h.voice(); h.button().props.onPress(); await tick(); assert.ok(target); h.dispose();
  transfer.resolve({status: 200, uri: target}); await tick();
  assert.equal(h.audio.length, 0); assert.ok(h.removedFiles.filter(path => path === target).length >= 2);
});

test('a native file-delete confirmation cannot dispatch after an account change', async () => {
  const h = harness({platform: 'android'}); h.file(); h.button().props.onLongPress();
  const confirm = h.alerts[0][2].find(item => item.text === 'Delete').onPress;
  h.account(); confirm(); await tick(); assert.equal(h.calls.length, 0); h.dispose();
});

test('a file download resolved after navigation cannot open a signed private URL', async () => {
  const ticket = deferred(), h = harness({get: () => ticket.promise}); h.file();
  const pending = h.button().props.onPress(); h.blur(); ticket.resolve({url: 'https://files.example.test/private?ticket=secret'});
  await pending; assert.equal(h.opened.length, 0); assert.equal(h.calls[0][1], 'alice'); h.dispose();
});

test('a failing signed memo fetch shows controlled guidance without provider URLs or tokens', async () => {
  const h = harness({fetchBody: async () => {throw new Error('https://files.example.test/private?token=SECRET');}});
  h.voice(); h.button().props.onPress(); await tick(); h.render();
  assert.match(h.text(), /Could not open this memo/); assert.ok(!h.text().includes('SECRET')); h.dispose();
});

test('repeated memo taps share one pending request instead of creating overlapping playback', async () => {
  const ticket = deferred(), h = harness({get: () => ticket.promise}); h.voice();
  h.button().props.onPress(); h.button().props.onPress(); assert.equal(h.calls.length, 1);
  ticket.resolve({url: 'https://files.example.test/memo'}); await tick(); assert.equal(h.audio.length, 1); h.dispose();
});
