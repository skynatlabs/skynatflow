# Driver app

One screen — today's deliveries, mark-delivered with GPS/photo/signature
capture as the next additions — talking to the main platform's
`/api/mobile/*` routes. Same Business Graph API as the web app; no separate
backend.

## Real build status

A real, installable **Android release APK has been built** from this code:
`android/app/build/outputs/apk/release/app-release.apk` (65MB, package
`shop.skynat.oneplatform.driver`, targets Android 7 through 16). Generated
via `npx expo prebuild --platform android` + `./gradlew assembleRelease`.

It's signed with the Android **debug** keystore (Expo's default when no
release keystore is configured) — installs fine for sideloading/testing via
`adb install app-release.apk`, but is **not** ready for Play Store
submission as-is. That needs a real release keystore generated and
configured in `android/app/build.gradle` first.

**Not yet done:** actually launching it on a device/emulator and clicking
through the delivery flow live — the build itself is verified real and
valid (correct package name, permissions, signing), but end-to-end UI
testing on a running Android device hasn't happened yet.

## Honest scope of what's here

This is a real foundation, not the finished field app described in the
strategic report (Section 8):

- **Built:** delivery list, mark-delivered action, theme matching the web
  dashboard, wired to real API routes in the main project, and now a real
  installable Android build.
- **Not yet built:** photo/signature capture (needs `expo-image-picker` +
  upload to the object storage checkpoint), offline-first local queueing
  (needs a local DB like `expo-sqlite` or WatermelonDB — non-negotiable
  before this goes to a real driver per Section 9 of the strategic report),
  real per-driver login (blocked on the Auth.js checkpoint — the main web
  app now has real auth, this app hasn't been wired to it yet), and the
  sales rep / technician screens.
- **iOS build** — same codebase can target it, hasn't been built yet.

## Running it in dev (Expo Go / simulator)

```bash
cd apps/driver
npm install
npx expo start
```

Set `EXPO_PUBLIC_API_BASE_URL` to wherever the main platform is running
(defaults to `http://localhost:3000`), and set `DEMO_TENANT_ID` in
`src/DeliveriesScreen.tsx` to a real seeded tenant id to test end to end.

## Building a real Android release APK

```bash
# needs a JDK (tested with Homebrew's openjdk@17) and the Android SDK
export JAVA_HOME=/opt/homebrew/opt/openjdk@17
export ANDROID_HOME="$HOME/Library/Android/sdk"
export PATH="$JAVA_HOME/bin:$ANDROID_HOME/platform-tools:$PATH"

npx expo prebuild --platform android   # generates android/, only needed once
cd android
./gradlew assembleRelease
# output: android/app/build/outputs/apk/release/app-release.apk
```

This is a genuinely resource-heavy build (Gradle's first run took ~10
minutes on an M-series MacBook Air) — don't run it alongside other heavy
processes.
