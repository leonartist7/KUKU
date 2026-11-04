# Android standalone preview build

Status: cloud build pipeline prepared; a successful Actions run and APK artifact are required before claiming a build exists. Physical-device acceptance remains open.

## What the preview is

KUKU can be compiled into an installable Android APK on a GitHub-hosted runner. No Android SDK, Gradle distribution, native toolchain, dependency installation or build cache is added to Leonardo's computer.

The preview has a separate identity:

| Field | Value |
|---|---|
| App name | KUKU Preview |
| Application ID | com.leonartist7.kuku.preview |
| Deep-link scheme | kuku-preview |
| Platform | Android arm64-v8a |
| API | https://kuku-api-staging.onrender.com |
| Native calls | Disabled |
| Native push | Disabled |
| JavaScript | Embedded production Hermes bytecode |
| Signing | Public Android debug TEST key |
| Distribution | Actions artifact, retained seven days |

A normal assembleDebug build typically skips the embedded JavaScript bundle and expects a running Metro development server. That would not meet the goal of sending a usable APK to a family member. This pipeline instead uses the release Gradle variant with the Expo template's public debug test signing configuration. The release variant embeds Hermes and disables developer support; the signing remains test-only.

No Expo account, EAS credential, private signing secret, Google Play account or paid build service is needed for this build. GitHub Actions usage remains subject to the repository's existing allowance. Do not add a paid runner or billing change automatically.

## Pipeline integration

The job fragment is in docs/ci/android-preview-job.yml. Append its android_preview entry under jobs in .github/workflows/release.yml, after reviewing the current workflow. The fragment is documentation, not a second independent workflow.

The job needs both backend and frontend checks to succeed. It runs for same-repository pull requests whose branch begins codex/kuku-. Pull-request triggers work on the review branch without requiring a workflow_dispatch file to exist on main.

1. Check out the exact pull-request head.
2. Use Node 22 and Eclipse Temurin JDK 17 through pinned official actions.
3. Run npm ci against the committed lockfile on the cloud runner.
4. Generate existing branding and validate the HTTPS API origin.
5. Run prepare-android-preview.cjs config to change app identity only in the ephemeral build workspace.
6. Generate Android sources with Expo prebuild --platform android --no-install.
7. Verify the generated package, embedded-bundle configuration and public test signing.
8. Install Android API 36, Build Tools 36.0.0, NDK 27.1.12297006 and CMake 3.22.1 on the cloud runner.
9. Assemble the arm64 release variant with bounded Gradle workers and memory.
10. Verify the APK signature, separate package, target SDK, architecture, non-debuggable manifest and embedded Hermes header.
11. Publish the APK, SHA-256 checksum, source/run provenance and static evidence as an Actions artifact.

Nothing generated under frontend/android is committed. The helper changes frontend/app.json only during CI; the source app retains its production package and name.

## What a successful run proves

A successful job proves the current source can compile and package a standalone APK with its own JS bundle, the documented test identity and a verifiable signature/checksum. Its build.json records the exact source commit, workflow run, API origin and disabled feature gates.

It does not prove physical-phone startup, microphone quality, account restoration, download behavior, native image picking, playback synchronization, push delivery or background-call behavior. Automated browser and backend tests remain separate evidence.

The preview uses the existing invitation-only API and real accounts. It does not seed demo users or include passwords/tokens. Installing the APK alone does not create an account.

## Installing the test build

After the Android job succeeds:

1. Open that exact GitHub Actions run.
2. Download the kuku-android-preview-test-signed artifact.
3. Extract KUKU-Preview-arm64-TEST-SIGNED.apk.
4. Transfer the APK to the Android phone, open it and allow installation from that source when Android asks.
5. Open KUKU Preview and sign in with the person's own verified account.

Use the artifact from the trusted repository/run. The public debug test key is not a production trust or signing boundary. Do not distribute this as an official production release.

This artifact is for arm64 devices; an older 32-bit phone or x86 emulator needs a separately built architecture. Confirm the actual phone architecture and Android version before stating compatibility. The package metadata in the artifact records the build's minimum/target SDK.

## Updates and signing

KUKU Preview installs beside the future production app because its application ID and URL scheme differ. Its data and Android secure storage are separate from the production package.

A later preview with the same package and certificate can update it; changing certificates requires uninstall/reinstall and can remove local drafts/settings. Accounts and shared server data remain on the API. Moving from this preview package to the production app requires a separate install and sign-in.

Before a trusted wider release, configure an owner-controlled signing key and recovery/backup process, define version upgrades and retention, and test real phones. Do not silently promote the public test certificate to production signing.

Native push still needs Expo/FCM configuration and physical background-notification checks. Native calls still need the React Native LiveKit integration and Android call lifecycle/notification handling. Those are separate gates; this APK does not claim them.

## Sources checked on 4 November 2026

- [Expo SDK 54](https://expo.dev/changelog/sdk-54): React Native 0.81, Android API 36 and minimum Node 20.19.4.
- [Expo build infrastructure](https://docs.expo.dev/build-reference/infrastructure/): SDK 54 reference image uses Java 17 and NDK 27.1.12297006.
- [Expo SDK 54 Android template](https://github.com/expo/expo/blob/sdk-54/templates/expo-template-bare-minimum/android/app/build.gradle): production bundling and default public debug signing.
- [Expo SDK 54 Gradle wrapper](https://github.com/expo/expo/blob/sdk-54/templates/expo-template-bare-minimum/android/gradle/wrapper/gradle-wrapper.properties): Gradle 8.14.3.
- [React Native 0.81 environment](https://reactnative.dev/docs/0.81/set-up-your-environment): JDK 17 and Node requirements.
- [Expo APK build guidance](https://docs.expo.dev/build-reference/apk/).
- [Official setup-java v6.1.0](https://github.com/actions/setup-java/releases/tag/v6.1.0): pin b843ebf9b913146b38da2eaa7aeddf76074ae1ad.
