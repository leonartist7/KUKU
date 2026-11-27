const {test} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function pureModule(file, cache = new Map()) {
  const location = path.resolve(file);
  if (cache.has(location)) return cache.get(location);
  const exports = {}; cache.set(location, exports);
  const source = ts.transpileModule(fs.readFileSync(location, "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(source, {exports, Date, require: specifier => pureModule(path.resolve(path.dirname(location), specifier + ".ts"), cache)});
  return exports;
}

test("every shipped palette keeps small text and accent controls readable on its real surfaces", () => {
  const {palettes, contrastRatio} = pureModule("src/theme.ts");
  assert.equal(Object.keys(palettes).length, 15);
  for (const [name, palette] of Object.entries(palettes)) {
    for (const role of ["text", "textSecondary", "textTertiary", "primary", "primaryDark", "success"]) {
      for (const surface of ["bg", "surface", "surfaceElevated"]) {
        assert.ok(contrastRatio(palette[role], palette[surface]) >= 4.5, name + "." + role + " on " + surface);
      }
    }
    assert.ok(contrastRatio(palette.textInverse, palette.primary) >= 4.5, name + " accent button label");
    assert.ok(contrastRatio(palette.error, palette.errorBg) >= 4.5, name + " inline error");
    assert.ok(contrastRatio(palette.primaryDark, palette.primaryBgSubtle) >= 4.5, name + " subtle action");
  }
  assert.equal(contrastRatio("#000000", "#ffffff"), 21);
});

test("appearance timers land on the next local minute boundary without changing their input", () => {
  const {nextThemeTransitionDelay} = pureModule("src/appearanceClock.ts");
  const time = new Date(2026, 10, 4, 6, 59, 59, 750);
  const original = time.getTime();
  assert.equal(nextThemeTransitionDelay(time, "07:00", "19:00"), 250);
  assert.equal(time.getTime(), original);
  assert.equal(nextThemeTransitionDelay(new Date(2026, 10, 4, 7, 0), "07:00", "19:00"), 12 * 3600000);
  assert.equal(nextThemeTransitionDelay(new Date(2026, 10, 4, 23, 0), "07:00", "19:00"), 8 * 3600000);
  assert.equal(nextThemeTransitionDelay(new Date(2026, 10, 4, 8, 30), "17:00", "09:00"), 30 * 60000);
  assert.equal(nextThemeTransitionDelay(time, "not-a-time", "19:00"), 60000);
  assert.equal(nextThemeTransitionDelay(time, "07:00", "07:00"), 60000);
});

test("scheduled transitions follow calendar time through daylight-saving changes", () => {
  const previous = process.env.TZ;
  process.env.TZ = "Europe/Paris";
  try {
    const {nextThemeTransitionDelay} = pureModule("src/appearanceClock.ts");
    assert.equal(nextThemeTransitionDelay(new Date(2026, 9, 24, 20), "07:00", "19:00"), 12 * 3600000);
    assert.equal(nextThemeTransitionDelay(new Date(2026, 2, 28, 20), "07:00", "19:00"), 10 * 3600000);
  } finally {
    if (previous === undefined) delete process.env.TZ; else process.env.TZ = previous;
  }
});

test("a foreground timezone change updates the rendered theme even when old Date objects resolve in the new zone", () => {
  const previousTimezone = process.env.TZ; process.env.TZ = "UTC";
  const timestamp = Date.UTC(2026, 10, 4, 18, 30);
  class ClockDate extends Date {constructor(value) {super(value === undefined ? timestamp : value);}}
  const cells = [], pendingEffects = [], cleanups = [], timers = new Map();
  let cursor = 0, updates = 0, nextTimer = 0;
  const react = {
    createContext: () => ({Provider: "Provider"}), createElement: (_, props) => props,
    useState: initial => {const index = cursor++; if (!(index in cells)) cells[index] = typeof initial === "function" ? initial() : initial;
      return [cells[index], update => {const next = typeof update === "function" ? update(cells[index]) : update; if (!Object.is(next, cells[index])) {cells[index] = next; updates++;}}];},
    useRef: initial => {const index = cursor++; return cells[index] || (cells[index] = {current: initial});},
    useMemo: compute => {cursor++; return compute();}, useCallback: callback => {cursor++; return callback;},
    useEffect: (effect, deps) => {const index = cursor++, before = cells[index];
      if (!before || deps.some((value, i) => !Object.is(value, before[i]))) {cells[index] = deps; pendingEffects.push(effect);}},
  };
  const modules = {
    react: {default: react, ...react},
    "react-native": {Platform: {OS: "web"}, AppState: {currentState: "active", addEventListener: () => ({remove() {}})}, useColorScheme: () => "light"},
    "@react-native-async-storage/async-storage": {default: {getItem: async () => null, setItem: async () => {}}},
    "./theme": pureModule("src/theme.ts"), "./appearance": pureModule("src/appearance.ts"), "./appearanceClock": pureModule("src/appearanceClock.ts"),
  };
  const exports = {};
  const source = ts.transpileModule(fs.readFileSync("src/ThemeContext.tsx", "utf8"), {compilerOptions: {module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2020}}).outputText;
  vm.runInNewContext(source, {exports, Date: ClockDate, require: name => modules[name],
    setTimeout: callback => {const id = ++nextTimer; timers.set(id, callback); return id;}, clearTimeout: id => timers.delete(id),
    document: {visibilityState: "visible", addEventListener() {}, removeEventListener() {}, documentElement: {style: {}}, querySelector: () => null},
    window: {addEventListener() {}, removeEventListener() {}},
  });
  function render() {cursor = 0; const value = exports.ThemeProvider({children: null}).value; for (const effect of pendingEffects.splice(0)) {const cleanup = effect(); if (cleanup) cleanups.push(cleanup);} return value;}
  try {
    assert.equal(render().c.isDark, false);
    const before = updates;
    const tick = Array.from(timers.values())[0]; assert.equal(typeof tick, "function");
    tick(); assert.equal(updates, before, "An unchanged minute must not update React state");
    process.env.TZ = "Europe/Paris";
    Array.from(timers.values())[0]();
    assert.equal(updates, before + 1, "18:30 UTC becomes 19:30 locally and must cause a render");
    assert.equal(render().c.isDark, true);
  } finally {
    cleanups.forEach(cleanup => cleanup());
    if (previousTimezone === undefined) delete process.env.TZ; else process.env.TZ = previousTimezone;
  }
});

