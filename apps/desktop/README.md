# One Platform Desktop

A thin Electron shell around the web dashboard — not a separate codebase
with its own logic. The dashboard needs the Next.js server + Postgres
behind it regardless of surface (web, desktop), so this just opens a real
native window pointed at wherever that's running.

## Run it against your local dev server

```bash
cd ../..              # back to the main Next.js project
npm run dev            # starts it on http://localhost:3000
cd apps/desktop
npm start               # opens the desktop shell pointed at localhost:3000
```

## Point it at production instead

```bash
ONE_PLATFORM_URL=https://your-deployed-url.vercel.app npm start
```

## Build a distributable Mac (Apple Silicon) app

```bash
npm run build:mac
```

Output lands in `apps/desktop/dist/` — a `.dmg` and a `.zip`, both arm64.
This is unsigned (no Apple Developer certificate configured), so macOS
Gatekeeper will warn on first open — right-click the app → Open, or run
`xattr -cr "One Platform.app"` to clear the quarantine flag for local
testing. Signing/notarizing for real distribution is a separate step that
needs an Apple Developer account.

## Honest scope

This is genuinely just a window — no offline mode, no native menu bar
shortcuts beyond the OS defaults, no auto-update wiring. It's the
"desktop app" checkbox from the strategic report satisfied simply and
correctly, not a from-scratch native app. If deeper desktop-specific
behavior (system notifications, tray icon, offline cache) is wanted later,
that's real additional scope, not included here.
