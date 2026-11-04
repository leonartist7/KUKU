const { test } = require("node:test");
const assert = require("node:assert/strict");
const { previewConfig, verifyGeneratedNative, API_ORIGIN, PACKAGE } = require("../scripts/prepare-android-preview.cjs");
const config = { expo: { name: "KUKU", scheme: "kuku", plugins: ["expo-router"], android: { package: "com.leonartist7.kuku" } } };
const env = { CI: "true", KUKU_ANDROID_PREVIEW: "true", EXPO_PUBLIC_BACKEND_URL: API_ORIGIN, EXPO_PUBLIC_ENABLE_CALLS: "false", EXPO_PUBLIC_ENABLE_PUSH: "false", KUKU_SOURCE_SHA: "a".repeat(40), GITHUB_RUN_NUMBER: "35", GITHUB_RUN_ATTEMPT: "1" };
const versions = { expo: "54.0.36", reactNative: "0.81.5" };

test("Android preview separates application identity without mutating production source config", () => {
  const next = previewConfig(config, env, versions);
  assert.equal(next.expo.android.package, PACKAGE);
  assert.equal(next.expo.name, "KUKU Preview");
  assert.equal(next.expo.scheme, "kuku-preview");
  assert.equal(next.expo.updates.enabled, false);
  assert.equal(next.expo.android.versionCode, 1000035);
  assert.equal(next.expo.extra.previewBuild.sourceSha, env.KUKU_SOURCE_SHA);
  assert.equal(config.expo.android.package, "com.leonartist7.kuku");
  assert.deepEqual(next.expo.plugins, ["expo-router"]);
});
test("Android preview refuses local execution, wrong API and enabled unverified native features", () => {
  for (const override of [
    { CI: undefined }, { KUKU_ANDROID_PREVIEW: undefined },
    { EXPO_PUBLIC_BACKEND_URL: "http://localhost:8000" },
    { EXPO_PUBLIC_BACKEND_URL: "https://different-api.example.test" },
    { EXPO_PUBLIC_ENABLE_CALLS: "true" }, { EXPO_PUBLIC_ENABLE_PUSH: "true" }
  ]) assert.throws(() => previewConfig(config, { ...env, ...override }, versions));
});
test("Android preview refuses SDK drift and incomplete build provenance", () => {
  assert.throws(() => previewConfig(config, env, { ...versions, expo: "55.0.0" }));
  assert.throws(() => previewConfig(config, env, { ...versions, reactNative: "0.82.0" }));
  assert.throws(() => previewConfig(config, { ...env, KUKU_SOURCE_SHA: "main" }, versions));
  assert.throws(() => previewConfig(config, { ...env, GITHUB_RUN_NUMBER: "NaN" }, versions));
});
test("Android generated release must bundle JS with public test signing and distinct package", () => {
  const native = 'android { defaultConfig { applicationId "' + PACKAGE + '" } buildTypes {\nrelease {\nsigningConfig signingConfigs.debug\n}\n}\n}\nreact { bundleCommand = "export:embed" }';
  assert.doesNotThrow(() => verifyGeneratedNative(native));
  assert.throws(() => verifyGeneratedNative(native.replace("signingConfigs.debug", "signingConfigs.production")));
  assert.throws(() => verifyGeneratedNative(native.replace(PACKAGE, "com.leonartist7.kuku")));
  assert.throws(() => verifyGeneratedNative(native.replace("signingConfig signingConfigs.debug", "debuggable true\nsigningConfig signingConfigs.debug")));
  assert.throws(() => verifyGeneratedNative(native.replace('bundleCommand = "export:embed"', "")));
});
