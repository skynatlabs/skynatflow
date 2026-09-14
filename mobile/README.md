# flow for Android

A native shell over the live flow workspace.

## Why a shell, not a rewrite

The web app is 63 pages deep and still moving weekly. A parallel native
client would be behind from the day it shipped — which is precisely the
complaint people make about the mobile apps in this category: *missing
features, clunky, less reliable than desktop.*

What makes this an app rather than a bookmark is everything around the web
view, and all of it is native: launcher icon, splash, hardware back, App
Links, an offline screen that isn't Chrome's dinosaur, and — next — push
notifications, the camera, and offline capture.

## Pointing it somewhere

`capacitor.config.ts` reads `FLOW_URL`, defaulting to `https://skynatflow.com`.

```bash
FLOW_URL=https://staging.skynatflow.com npm run sync
```

Anything not in `server.allowNavigation` opens in the system browser instead
of taking over the app window — so a link in a customer note can never
hijack the session.

## Building

Needs Android Studio (or a JDK 17+ and the Android SDK). Neither is installed
on the machine this was scaffolded on, so the project is generated but has
never been compiled here — expect the first Gradle sync to download
dependencies.

```bash
npm install
npm run sync            # copy config + plugins into the native project
npm run open            # opens Android Studio
```

Command line instead:

```bash
npm run build:debug     # android/app/build/outputs/apk/debug/app-debug.apk
npm run build:release   # an .aab for Play, needs signing configured
```

## Before it goes to Play

1. **Signing key.** Create a release keystore and wire it into
   `android/app/build.gradle`. Keep it somewhere you cannot lose it —
   a replaced key means a replaced listing.
2. **App Links.** Take the release key's SHA-256 fingerprint:
   ```bash
   keytool -list -v -keystore release.keystore -alias flow | grep SHA256
   ```
   Set it as `ANDROID_CERT_FINGERPRINTS` on the web app (comma-separated if
   more than one). It is served at `/.well-known/assetlinks.json`, which is
   what lets a flow link open the app directly instead of a browser.
3. **Push.** Add `@capacitor/push-notifications` and a Firebase project, then
   drop `google-services.json` into `android/app/`.

## What it does today

- Opens the live workspace, signed in, with cookies and OAuth behaving
  exactly as they do in a browser (`androidScheme: https` — a custom scheme
  is the first thing that breaks auth).
- Dark canvas end to end: splash, status bar and navigation bar all
  `#0B1120`, so there is no white flash before the first paint.
- An offline screen that reloads itself the moment connectivity returns.
- Opens flow links from email, WhatsApp and notifications on the right screen.

## What it does not do yet

Push notifications, camera capture, offline queueing, and the field-mode UI.
Those are phases 48–52 of the build plan — each one native, each one a reason
this is an app.
