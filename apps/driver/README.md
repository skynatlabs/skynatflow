# Driver app (Phase 6 scaffold)

One screen — today's deliveries, mark-delivered with GPS/photo/signature
capture as the next additions — talking to the main platform's
`/api/mobile/*` routes. Same Business Graph API as the web app; no separate
backend.

## Honest scope of what's here

This is a real, typechecked scaffold, not a placeholder — but it is
genuinely the *foundation*, not the finished field app described in the
strategic report (Section 8):

- **Built:** delivery list, mark-delivered action, dark-theme UI matching
  the web dashboard, wired to real API routes in the main project.
- **Not yet built:** photo/signature capture (needs `expo-image-picker` +
  upload to the object storage checkpoint), offline-first local queueing
  (needs a local DB like `expo-sqlite` or WatermelonDB — non-negotiable
  before this goes to a real driver per Section 9 of the strategic report),
  real per-driver login (blocked on the Auth.js checkpoint), and the sales
  rep / technician screens.
- **Not run/tested live** — this was verified with `tsc --noEmit`, not by
  launching it in a simulator or on a device, since that needs Expo Go or
  a configured simulator this session doesn't have attached.

## Running it

```bash
cd apps/driver
npm install
npx expo start
```

Set `EXPO_PUBLIC_API_BASE_URL` to wherever the main platform is running
(defaults to `http://localhost:3000`), and set `DEMO_TENANT_ID` in
`src/DeliveriesScreen.tsx` to a real seeded tenant id to test end to end.
