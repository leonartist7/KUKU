const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const ts = require("typescript");

function hookHarness({platform = "web", matches = true, legacy = false, pending} = {}) {
  let value, initialized = false, installed = false, cleanup, listener, removed = 0;
  const updates = [], queries = [];
  const query = {matches};
  const listen = (name, callback) => {assert.equal(name, "change"); listener = callback;};
  const unlisten = (name, callback) => {assert.equal(name, "change"); assert.equal(callback, listener); removed++;};
  if (legacy) {query.addListener = callback => listen("change", callback); query.removeListener = callback => unlisten("change", callback);}
  else {query.addEventListener = listen; query.removeEventListener = unlisten;}
  const react = {
    useState: initial => {if (!initialized) {value = typeof initial === "function" ? initial() : initial; initialized = true;}
      return [value, next => {value = next; updates.push(next);}];},
    useEffect: effect => {if (!installed) {installed = true; cleanup = effect();}},
  };
  const native = {Platform: {OS: platform}, AccessibilityInfo: {
    addEventListener: (name, callback) => {assert.equal(name, "reduceMotionChanged"); listener = callback; return {remove: () => {removed++;}};},
    isReduceMotionEnabled: () => pending || Promise.resolve(false),
  }};
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync("src/useReducedMotion.ts", "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(code, {exports, require: name => name === "react" ? react : native,
    window: {matchMedia: name => {queries.push(name); return query;}}});
  return {read: () => exports.useReducedMotion(), change: matches => listener({matches}), nativeChange: enabled => listener(enabled),
    updates, queries, dispose: () => cleanup?.(), removed: () => removed};
}

test("reduced-motion preference applies before a web modal first renders and follows live changes", () => {
  const h = hookHarness({matches: true});
  assert.equal(h.read(), true);
  assert.ok(h.queries.every(query => query === "(prefers-reduced-motion: reduce)"));
  h.change(false); assert.equal(h.read(), false);
  h.change(true); assert.equal(h.read(), true);
  h.dispose(); assert.equal(h.removed(), 1);
  const before = h.updates.length; h.change(false);
  assert.equal(h.updates.length, before, "Unmounted modal must ignore late preference events");
});

test("older WebKit media-query listeners are removed on cleanup", () => {
  const h = hookHarness({matches: false, legacy: true});
  assert.equal(h.read(), false); h.change(true); assert.equal(h.read(), true);
  h.dispose(); assert.equal(h.removed(), 1);
});

test("native preference starts quiet and a newer OS change wins over a delayed initial read", async () => {
  let finish;
  const h = hookHarness({platform: "android", pending: new Promise(resolve => {finish = resolve;})});
  assert.equal(h.read(), true, "Do not animate while the OS preference is unknown");
  h.nativeChange(false); assert.equal(h.read(), false);
  finish(true); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.read(), false, "The stale initial read must not overwrite the OS change");
  h.nativeChange(true); assert.equal(h.read(), true); h.dispose(); assert.equal(h.removed(), 1);
});

test("native async preference completion cannot update an unmounted modal", async () => {
  let finish;
  const h = hookHarness({platform: "ios", pending: new Promise(resolve => {finish = resolve;})});
  h.read(); h.dispose(); finish(false); await Promise.resolve(); await Promise.resolve();
  assert.equal(h.updates.length, 0);
});

test("EmotePicker disables its modal transition for reduced motion and retains fade otherwise", () => {
  let reduced = true;
  const react = {createElement: (type, props, ...children) => ({type, props, children}), useState: initial => [initial, () => {}]};
  const modules = {
    react: {default: react, ...react},
    "react-native": Object.fromEntries(["ActivityIndicator", "Modal", "Pressable", "ScrollView", "Text", "View"].map(name => [name, name])),
    "react-native-safe-area-context": {SafeAreaView: "SafeAreaView"}, "@expo/vector-icons": {Ionicons: "Ionicons"},
    "./emotes": {EMOTES: []}, "./EmoteImage": {default: "EmoteImage"},
    "./ThemeContext": {useTheme: () => ({c: {}, f: {}})}, "./useReducedMotion": {useReducedMotion: () => reduced},
  };
  const exports = {};
  const code = ts.transpileModule(fs.readFileSync("src/EmotePicker.tsx", "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(code, {exports, require: name => modules[name]});
  const render = () => exports.default({onClose() {}, onSend: async () => true});
  assert.equal(render().props.animationType, "none");
  reduced = false; assert.equal(render().props.animationType, "fade");
});
