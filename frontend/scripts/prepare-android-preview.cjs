// CI-only preparation for a standalone APK signed with Android's PUBLIC TEST key.
// This never generates native sources or installs dependencies on the user's PC.
const fs = require("node:fs");
const path = require("node:path");
const assert = require("node:assert/strict");
const API_ORIGIN = "https://kuku-api-staging.onrender.com";
const PACKAGE = "com.leonartist7.kuku.preview";

function previewConfig(config, env, versions) {
  assert.equal(env.CI, "true", "Android preview preparation is restricted to CI.");
  assert.equal(env.KUKU_ANDROID_PREVIEW, "true", "Explicit preview mode is required.");
  assert.equal(env.EXPO_PUBLIC_BACKEND_URL, API_ORIGIN, "Use the approved HTTPS KUKU beta API.");
  assert.equal(env.EXPO_PUBLIC_ENABLE_CALLS, "false", "Native calls must remain gated.");
  assert.equal(env.EXPO_PUBLIC_ENABLE_PUSH, "false", "Native push must remain gated.");
  assert.match(versions.expo, /^54\./, "Review the native template before changing Expo SDK.");
  assert.match(versions.reactNative, /^0\.81\./, "Review the native template before changing React Native.");
  assert.equal(config.expo?.android?.package, "com.leonartist7.kuku", "Unexpected source application ID.");
  assert.match(env.KUKU_SOURCE_SHA || "", /^[a-f0-9]{40}$/i, "Record the immutable source commit.");
  const run = Number(env.GITHUB_RUN_NUMBER), attempt = Number(env.GITHUB_RUN_ATTEMPT || 1);
  assert.ok(Number.isSafeInteger(run) && run > 0 && run < 100000000, "Invalid workflow run number.");
  assert.ok(Number.isSafeInteger(attempt) && attempt > 0 && attempt < 1000, "Invalid workflow attempt.");
  const next = JSON.parse(JSON.stringify(config));
  next.expo.name = "KUKU Preview";
  next.expo.slug = "kuku-preview";
  next.expo.scheme = "kuku-preview";
  next.expo.version = "1.0.0-preview." + run + "." + attempt;
  next.expo.android.package = PACKAGE;
  next.expo.android.versionCode = 1000000 + run;
  next.expo.updates = { ...(next.expo.updates || {}), enabled: false };
  next.expo.extra = { ...(next.expo.extra || {}), previewBuild: {
    sourceSha: env.KUKU_SOURCE_SHA, run, attempt, signing: "public-android-debug-test-key",
    callsEnabled: false, pushEnabled: false,
  } };
  return next;
}

function verifyGeneratedNative(gradle) {
  assert.ok(gradle.includes('applicationId "' + PACKAGE + '"'), "Native package must remain separate from production.");
  const release = gradle.match(/\brelease\s*\{([\s\S]*?)\n\s*\}/);
  assert.ok(release, "Generated release variant was not found.");
  assert.match(release[1], /\bsigningConfig\s+signingConfigs\.debug\b/, "Preview may only use the public debug test signing configuration.");
  assert.doesNotMatch(release[1], /\bdebuggable\s+(true|=\s*true)/, "Standalone preview must not require developer support.");
  assert.match(gradle, /bundleCommand\s*=\s*"export:embed"/, "Use Expo's embedded JS bundling.");
}

function main() {
  const root = path.resolve(__dirname, "..");
  const mode = process.argv[2];
  assert.equal(process.env.CI, "true", "Run native preparation in the cloud workflow only.");
  if (mode === "config") {
    const source = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
    const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
    const next = previewConfig(source, process.env, {
      expo: lock.packages["node_modules/expo"].version,
      reactNative: lock.packages["node_modules/react-native"].version,
    });
    fs.writeFileSync(path.join(root, "app.json"), JSON.stringify(next, null, 2) + "\n");
    console.log("Prepared " + next.expo.android.package + " " + next.expo.version + "; native calls and push disabled.");
  } else if (mode === "verify-native") {
    verifyGeneratedNative(fs.readFileSync(path.join(root, "android/app/build.gradle"), "utf8"));
    console.log("Verified standalone release bundling and PUBLIC TEST debug signing.");
  } else throw new Error("Choose config or verify-native.");
}
module.exports = { previewConfig, verifyGeneratedNative, API_ORIGIN, PACKAGE };
if (require.main === module) main();
