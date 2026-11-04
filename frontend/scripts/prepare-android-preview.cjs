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
  // Expo's generated Groovy may use either quote style or an explicit '='.
  // Compare the parsed value exactly; accepting formatting must not accept a
  // production package or a second applicationId override.
  const identities = [...gradle.matchAll(/\bapplicationId\s*(?:=\s*)?(['"])([^'"\r\n]+)\1/g)].map(match => match[2]);
  assert.deepEqual(identities, [PACKAGE], "Native package must remain separate from production. Observed applicationId values: " + JSON.stringify(identities));
  const release = gradle.match(/\brelease\s*\{([\s\S]*?)\n\s*\}/);
  assert.ok(release, "Generated release variant was not found.");
  assert.match(release[1], /\bsigningConfig\s*(?:=\s*)?signingConfigs\.debug\b/, "Preview may only use the public debug test signing configuration.");
  assert.doesNotMatch(release[1], /\b(?:debuggable|isDebuggable)\s*(?:=\s*)?true\b/, "Standalone preview must not require developer support.");
  const bundleCommands = [...gradle.matchAll(/\bbundleCommand\s*(?:=\s*)?(['"])([^'"\r\n]+)\1/g)].map(match => match[2]);
  assert.deepEqual(bundleCommands, ["export:embed"], "Use Expo's embedded JS bundling.");
  return { applicationId: identities[0], bundleCommand: bundleCommands[0] };
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
    const evidenceRoot = path.join(root, "android-preview");
    fs.mkdirSync(evidenceRoot, { recursive: true });
    // Explicit allowlist: never dump arbitrary app config/extra/env values.
    fs.writeFileSync(path.join(evidenceRoot, "config-summary.json"), JSON.stringify({
      name: next.expo.name, slug: next.expo.slug, scheme: next.expo.scheme,
      version: next.expo.version, application_id: next.expo.android.package,
      version_code: next.expo.android.versionCode,
      api_origin: API_ORIGIN, calls_enabled: false, native_push_enabled: false,
      expo_version: lock.packages["node_modules/expo"].version,
      react_native_version: lock.packages["node_modules/react-native"].version,
    }, null, 2) + "\n");
    console.log("Prepared " + next.expo.android.package + " " + next.expo.version + "; native calls and push disabled.");
  } else if (mode === "verify-native") {
    verifyGeneratedNative(fs.readFileSync(path.join(root, "android/app/build.gradle"), "utf8"));
    console.log("Verified standalone release bundling and PUBLIC TEST debug signing.");
  } else throw new Error("Choose config or verify-native.");
}
module.exports = { previewConfig, verifyGeneratedNative, API_ORIGIN, PACKAGE };
if (require.main === module) main();
