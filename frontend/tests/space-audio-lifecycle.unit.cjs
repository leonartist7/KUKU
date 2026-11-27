const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript');
const tick = async () => {for (let i = 0; i < 20; i++) await Promise.resolve();};
const deferred = () => {let resolve, reject; const promise = new Promise((yes, no) => {resolve = yes; reject = no;}); return {promise, resolve, reject};};
const compile = file => ts.transpileModule(fs.readFileSync(file, 'utf8'), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React}}).outputText;
function harness({platform = 'web', download} = {}) {
  let cursor = 0, props, tree, component;
  const cells = [], effects = [], cleanups = new Map(), audio = [], intervals = new Map();
  const same = (a, b) => a && b && a.length === b.length && a.every((value, i) => Object.is(value, b[i]));
  const react = {
    createElement: (type, props, ...children) => ({type, props: props || {}, children}),
    useRef: initial => {const i = cursor++; if (!(i in cells)) cells[i] = {current: initial}; return cells[i];},
    useState: initial => {const i = cursor++; if (!(i in cells)) cells[i] = initial; return [cells[i], update => {cells[i] = typeof update === 'function' ? update(cells[i]) : update;}];},
    useEffect: (effect, deps) => {const i = cursor++; if (!same(cells[i], deps)) {cells[i] = deps; effects.push({i, effect});}},
  };
  function makeAudio(uri) {
    const value = {uri, duration: 60, currentTime: 0, readyState: 1, isLoaded: true, paused: true, playing: false, ended: false, plays: 0, pauses: 0, removed: 0, released: 0,
      play() {this.plays++; if (this.playResult) return this.playResult; this.paused = false; this.playing = true; return Promise.resolve();},
      pause() {this.pauses++; this.paused = true; this.playing = false;}, removeAttribute() {this.removed++;}, load() {this.released++;},
      remove() {this.released++;}, seekTo() {return Promise.resolve();}, addListener() {return {remove() {if (value.listenerFails) throw new Error('listener failure');}};},
    }; audio.push(value); return value;
  }
  const playback = {}, exports = {};
  vm.runInNewContext(compile('src/spacePlayback.ts'), {exports: playback, Date, performance, Map, Number, Math, String});
  const modules = {
    react: {default: react, ...react}, 'react-native': {Platform: {OS: platform}, View: 'View', Text: 'Text', Pressable: 'Pressable', ActivityIndicator: 'ActivityIndicator'},
    '@expo/vector-icons/Ionicons': {default: 'Ionicons'}, 'expo-audio': {createAudioPlayer: value => makeAudio(value.uri), setAudioModeAsync: async () => {}},
    './ThemeContext': {useTheme: () => ({c: {}, f: {}})}, './spacePlayback': playback,
    './spaces': {privateAudioUrl: value => value, spacesApi: {audioDownload: async () => download ? download() : {url: 'https://audio.example.test/private'}}},
  };
  let timerId = 0;
  vm.runInNewContext(compile('src/SpaceAudio.tsx'), {exports, require: name => {if (!modules[name]) throw new Error('Unexpected module ' + name); return modules[name];},
    Audio: function(uri) {return makeAudio(uri);}, Error, Number,
    setInterval: callback => {const id = ++timerId; intervals.set(id, callback); return id;}, clearInterval: id => intervals.delete(id),
    setTimeout: () => ++timerId, clearTimeout() {},
  }); component = exports.default;
  function render(next = props) {
    props = next; cursor = 0; tree = component(props);
    for (const {i, effect} of effects.splice(0)) {cleanups.get(i)?.(); const cleanup = effect(); if (cleanup) cleanups.set(i, cleanup); else cleanups.delete(i);}
    return tree;
  }
  function find(node, predicate) {if (!node || typeof node !== 'object') return; if (predicate(node)) return node; for (const child of node.children || []) {for (const value of Array.isArray(child) ? child : [child]) {const result = find(value, predicate); if (result) return result;}}}
  const state = {is_playing: true, position_sec: 0, updated_at: new Date().toISOString(), host_id: 'alice', version: 1};
  render({content: {type: 'audio', audio_id: 'one', title: 'Synthetic audio', url: 'https://audio.example.test/one'}, state, offsetMs: 0, uid: 'alice'});
  return {audio, render: () => render(), replace: () => render({...props, content: {type: 'audio', audio_id: 'two', title: 'Next synthetic audio', url: 'https://audio.example.test/two'}}),
    pause: () => render({...props, state: {...props.state, is_playing: false, version: 2}}),
    private: () => render({...props, content: {...props.content, upload_id: 'private', source: 'upload'}}),
    ready: (index = audio.length - 1) => audio[index].onloadedmetadata(),
    interval: () => {for (const callback of intervals.values()) callback();},
    join: () => {render(); return find(tree, node => node.props.testID === 'space-resume-audio').props.onPress();},
    text: () => {render(); return JSON.stringify(tree);},
    dispose: () => {for (const cleanup of cleanups.values()) cleanup(); cleanups.clear();},
  };
}
async function blocked(h) {const error = new Error('blocked'); error.name = 'NotAllowedError'; h.audio.at(-1).playResult = Promise.reject(error); h.ready(); await tick(); assert.match(h.text(), /Join playback/);}

test('late Join playback success cannot mark a replacement Space track as playing', async () => {
  const h = harness(); await tick(); await blocked(h); const old = deferred(); h.audio[0].playResult = old.promise; h.join();
  h.replace(); await tick(); old.resolve(); await tick(); assert.match(h.text(), /Opening audio/); assert.doesNotMatch(h.text(), /Listening together/); h.dispose();
});
test('late Join playback rejection cannot block a replacement Space track', async () => {
  const h = harness(); await tick(); await blocked(h); const old = deferred(); h.audio[0].playResult = old.promise; h.join();
  h.replace(); await tick(); old.reject(new Error('old track')); await tick(); assert.match(h.text(), /Opening audio/); assert.doesNotMatch(h.text(), /Join playback/); h.dispose();
});
test('host pause while Join playback is pending pauses the acquired player on completion', async () => {
  const h = harness(); await tick(); await blocked(h); const old = deferred(), audio = h.audio[0]; audio.playResult = old.promise; h.join();
  h.pause(); const before = audio.pauses; old.resolve(); await tick(); assert.ok(audio.pauses > before); assert.match(h.text(), /Playback paused/); h.dispose();
});
test('host pause while automatic playback is pending does not leave audio running', async () => {
  const h = harness(); await tick(); const pending = deferred(), audio = h.audio[0]; audio.playResult = pending.promise; h.ready(); h.pause();
  pending.resolve(); await tick(); assert.ok(audio.pauses > 0); assert.match(h.text(), /Playback paused/); h.dispose();
});
test('old synchronization completion cannot unlock a replacement player busy with its own play request', async () => {
  const h = harness(); await tick(); const old = deferred(); h.audio[0].playResult = old.promise; h.ready();
  h.replace(); await tick(); const next = deferred(), replacement = h.audio[1]; replacement.playResult = next.promise; h.ready();
  old.resolve(); await tick(); h.interval(); assert.equal(replacement.plays, 1); next.resolve(); await tick(); h.dispose();
});
test('web Space cleanup still clears the media source when pause fails', async () => {
  const h = harness(); await tick(); const audio = h.audio[0]; audio.pause = () => {throw new Error('detached');};
  assert.doesNotThrow(() => h.dispose()); assert.equal(audio.removed, 1); assert.equal(audio.released, 1); assert.equal(audio.onplaying, null);
});
test('native Space cleanup releases player even when listener removal and pause fail', async () => {
  const h = harness({platform: 'android'}); await tick(); const audio = h.audio[0]; audio.listenerFails = true;
  audio.pause = () => {throw new Error('pause failure');}; assert.doesNotThrow(() => h.dispose()); assert.equal(audio.released, 1);
});
test('private Space audio failures do not expose provider links or credentials', async () => {
  const h = harness({download: async () => {throw new Error('https://private.example.test?ticket=SECRET');}}); h.private(); await tick();
  assert.match(h.text(), /This audio could not be opened/); assert.doesNotMatch(h.text(), /SECRET|private.example/); h.dispose();
});
test('private audio resolved after content replacement cannot create a stale player', async () => {
  const pending = deferred(), h = harness({download: () => pending.promise}); h.private(); await tick(); const before = h.audio.length;
  h.replace(); await tick(); const replacementCount = h.audio.length; pending.resolve({url: 'https://private.example.test?ticket=SECRET'}); await tick();
  assert.equal(h.audio.length, replacementCount); assert.equal(replacementCount, before + 1); h.dispose();
});
