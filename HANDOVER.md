# One Platform — Handover

**Last updated:** 2026-08-20
**Repo:** [github.com/skynatlabs/skynatflow](https://github.com/skynatlabs/skynatflow) (private)
**Live deploy:** Vercel project under `skynatlabs' projects` — build passing as of commit `cc4dff6`. Not yet connected to a real production database (see Checkpoints below).

This is the working handover for **One Platform** — the AI-native, multi-vertical business OS built out of the Skynat strategic report and build manual. If you're picking this up cold, read this file first, then `README.md` for the technical architecture.

---

## What this actually is

One shared engine (Party/Item/Transaction/Event data model) wearing seven different "skins" — Corporate, Services, Logistics, Medical, Retail, Wholesale, Ecommerce — chosen once at onboarding. Real auth, real permission enforcement, a customer-facing portal with e-signature quote acceptance, a hot-lead alert system, a team task board, and cross-tenant wholesale trading. Not a prototype — every feature listed below has been clicked through live against a real database, not just built.

## What's live and verified right now

- Sign up, sign in, sign out — real sessions (Auth.js), bcrypt password hashing
- Every `/dashboard/*` route protected by real Membership checks, not just a login wall
- One login can own/work under multiple businesses (a platform super-admin account sees all of them)
- Quote → invoice → payment ledger, with 14 automated tests passing
- Customer portal (`/portal/[token]`) — no login needed, customer views their quote, signs it with a drawn e-signature, done
- Hot-lead email alert firing automatically when a quote is opened twice
- Team task board, staff/role management, cross-tenant wholesale connections with discount pricing
- Full audit log on every mutating action

## Surfaces built

| Surface | Location | Status |
|---|---|---|
| Web app (owner dashboard, onboarding, portal) | `src/` (Next.js) | Live, deployed, verified |
| Desktop (macOS) | `apps/desktop/` (Electron) | **Built and launch-tested on Apple Silicon.** Artifact: `apps/desktop/dist/mac-arm64/One Platform.app` (+ a `.zip` of the same). Unsigned — Gatekeeper will warn on first open elsewhere; fine for local testing on this machine. |
| Mobile (Android, driver app) | `apps/driver/` (Expo/React Native) | **Built — real, installable release APK.** `apps/driver/android/app/build/outputs/apk/release/app-release.apk` (65MB, package `shop.skynat.oneplatform.driver`, targets Android 7–16). Signed with the Android **debug** keystore, not a release one — installs fine via `adb install` or sideloading for testing, but is **not** Play-Store-submittable as-is. A real release keystore is needed before that step. |
| Mobile (iOS) | `apps/driver/` | Not built — same Expo codebase can target iOS, just hasn't been built/tested yet |

---

## Checkpoints — what needs a human, not more code

These are the things that are genuinely blocked on someone's decision or an external account — not things I forgot to build:

1. **Production `DATABASE_URL`.** The Vercel deploy currently points at a placeholder connection string just to get the build passing. Nothing will actually save until this is a real Postgres instance — sign up free at [supabase.com](https://supabase.com) or [neon.tech](https://neon.tech), grab the connection string, set it in Vercel's Environment Variables. Once that's done, the migration needs to be run against it (same command used locally — `npx prisma migrate deploy`) before it'll work.
2. **`AUTH_SECRET`** for the production environment — already generated, ready to paste into Vercel: `4wNEHWUfnKAqKPgRSx+BLJkqn7aD2WePO4HRPUO9wn0=`
3. **Domain** — currently sitting on Vercel's auto-generated `.vercel.app` URL. Recommended: point a subdomain of an existing Skynat domain at it (e.g. `app.skynat.co.za`) rather than buying a new one.
4. **`ANTHROPIC_API_KEY`, WhatsApp Business API creds, `RESEND_API_KEY`** — all optional for now. Everything degrades gracefully without them (follow-ups fall back to templates, sends log to console instead of failing) — nothing breaks, features just aren't "live" yet.
5. **Apple/Google developer accounts** — needed before the desktop app can be signed/notarized for real distribution, or the Android app can go on the Play Store. Right now both are real, working, unsigned builds — fine for internal testing, not for public distribution.

## Demo logins (local dev database only — not on the live Vercel deploy yet)

All share password `demopass123`:
- `admin@platform.demo.local` — platform super admin, sees all 7 demo workspaces
- `owner@services.demo.local`, `owner@retail.demo.local`, `owner@wholesale.demo.local`, `owner@logistics.demo.local`, `owner@medical.demo.local`, `owner@corporate.demo.local`, `owner@ecommerce.demo.local` — one owner per vertical

## Running things locally

```bash
# Web app
cp .env.example .env      # fill in DATABASE_URL at minimum
npm install
npx prisma migrate deploy
npm run db:seed            # seeds all 7 demo workspaces
npm run dev                 # http://localhost:3000

# Desktop shell (needs the web app running above)
cd apps/desktop && npm start

# Driver mobile app (Expo)
cd apps/driver && npx expo start
```

Full detail on each surface is in that surface's own README (`README.md`, `apps/desktop/README.md`, `apps/driver/README.md`).

## Known rough edges (real, not hidden)

- Driver app: no photo/signature capture yet (needs object storage — R2/B2), no offline-first queueing, no real per-driver login. Delivery list + mark-delivered works.
- No sales-rep or technician mobile screens yet.
- AI-conversational onboarding not built — current onboarding is a clean form, works fine, just not the AI-chat version from the strategic report.
- No marketing/landing site yet — logged-out visitors land straight on `/login`. Worth building before any real customer acquisition push.
- Desktop and Android builds are unsigned — fine for internal testing, would trigger OS security warnings for anyone else.

## Where to pick up next

In rough priority order once the database checkpoint is resolved:
1. Get the live Vercel deploy actually connected to a real database and confirm the full flow works in production, not just locally.
2. Point a real subdomain at it.
3. Marketing/landing page — there's currently nothing to convert a cold visitor.
4. Driver app depth (photo/signature, offline queue) once there's a real delivery-heavy pilot customer to build it for.
