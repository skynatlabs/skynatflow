# One Platform

AI-native, unified business OS for SMEs — CRM, quoting, invoicing, AR-chasing,
inventory, delivery, cross-tenant wholesale trading, and a customer-facing
portal, all on one shared core, one WhatsApp-native channel. Companion build
to the strategic report and build manual produced alongside this repo.

Seven verticals live side by side on the same engine — Corporate, Services,
Logistics, Medical, Retail, Wholesale, Ecommerce — chosen at onboarding, so
performance can be compared across industries before committing to one.

**New here?** Read [`HANDOVER.md`](./HANDOVER.md) first — current live status,
demo logins, and what's genuinely still open, in one place.

## Surfaces

- **Web** (this repo) — the owner dashboard, onboarding, and the customer
  portal. Deployed on Vercel.
- **Desktop** (`apps/desktop/`) — a thin Electron shell around the web app,
  built and launch-tested on Apple Silicon. See its own README.
- **Mobile / driver app** (`apps/driver/`) — Expo/React Native, Android
  native project builds via Gradle. See its own README.

## Stack

Next.js (App Router) + TypeScript, Prisma 7 (driver-adapter pattern) +
Postgres, **Auth.js (email+password, real sessions)**, Vercel AI SDK
(Claude), Tailwind (light/dark theme, pastel accent design), WhatsApp
Business API via a BSP (360dialog), Resend for email. A separate Expo React
Native app (`apps/driver`) is the field-app foundation.

## Core architecture

One data model, not separate modules: `Party` (people — customers, patients,
suppliers, staff), `Item`, `Transaction` (append-only ledger — quotes/
invoices/payments, with quote-open tracking and e-signature capture),
`Event` (deliveries, visits, follow-ups sent), `WholesaleConnection`
(cross-tenant trading links), `Task` (team task board), `AuditLog`, `User` /
`Membership` (one login, any number of businesses, per-business roles). All
in `prisma/schema.prisma`.

The **Business Graph API** (`src/lib/core/*.ts`) is the only code allowed to
write these tables. The owner UI, the mobile field app, the customer portal,
and the AI layer all call the exact same functions — no separate code path
per surface, which is what keeps every action auditable.

Every mutating server action is protected by `requireTenantAccess()` +
`assertCan()` (`src/lib/auth/tenant-access.ts`, `src/lib/core/access.ts`) —
confirms the signed-in session actually has a real Membership on the tenant
being acted on, then checks that role's capability, before anything runs.

The **niche-config layer** (`src/lib/niches/config.ts`) is what "one engine,
seven skins" means in code: every vertical shares the same tables; only
vocabulary and pipeline-stage labels change per niche, selected once at
onboarding.

```
src/auth.ts                    Auth.js config — credentials provider, JWT sessions
src/lib/auth/tenant-access.ts  the real enforcement point: session -> Membership -> role
src/lib/core/money.ts          quote -> invoice -> payment, customer balance, leakage query, quote-open tracking, e-signature acceptance
src/lib/core/movement.ts       deliveries, follow-up-sent logging
src/lib/core/parties.ts        customers/patients/suppliers/staff, customer history, portal token issuance
src/lib/core/connections.ts    wholesaler-retailer cross-tenant trading, discount pricing
src/lib/core/tasks.ts          team task board
src/lib/core/access.ts         role -> capability permission checks
src/lib/core/audit.ts          audit log writer
src/lib/core/notifications.ts  hot-lead alert on quote-open threshold
src/lib/niches/config.ts       the 7 niche skins: vocabulary + pipeline stages
src/lib/ai/tools.ts            AI tool-calling wrappers around the Business Graph API
src/lib/ai/followUp.ts         AI-drafted follow-up messages, escalating by touch number
src/lib/whatsapp/client.ts     WhatsApp send (stubs out safely with no API key)
src/lib/email/client.ts        email send (stubs out safely with no API key)
src/app/login/, signup/        real auth pages
src/app/onboarding/            niche picker + tenant creation (requires a signed-in session)
src/app/dashboard/[tenantId]/  tenant-scoped owner UI, access-controlled by the layout
src/app/portal/[token]/        customer-facing portal — token login, quote view, e-signature accept
src/app/api/whatsapp/webhook/  inbound WhatsApp messages
src/app/api/cron/follow-ups/   hit by a scheduled cron job, sends due follow-ups (AI-drafted, template fallback)
src/app/api/cron/daily-briefing/ daily WhatsApp cash-position summary per tenant owner
src/app/api/mobile/deliveries/ field-app endpoints (list + complete)
apps/driver/                   Expo React Native driver app (foundation — see its own README for honest scope)
tests/core/                    money ledger, tasks, connections — 14 tests, run against a real Postgres instance
prisma/seed.ts                 seeds one demo tenant per vertical + a platform super-admin account
```

## Local setup

```bash
cp .env.example .env      # then fill in DATABASE_URL at minimum
npm install
npx prisma generate
npx prisma migrate deploy   # applies existing migrations (use `migrate dev` only if you're changing the schema locally — needs SHADOW_DATABASE_URL too)
npm run db:seed             # seeds one demo tenant per vertical, password: demopass123
npm run dev
npm run test                 # runs all 14 tests against DATABASE_URL
```

Local dev here runs against Postgres 16 via Homebrew
(`brew services start postgresql@16`) — no external account needed for
local iteration. Production should point `DATABASE_URL` at a managed
Postgres (Supabase/Neon) instead.

## Verified so far

Every change in this repo has been checked with `tsc --noEmit`, `eslint`,
a full `next build`, and the test suite — all currently pass clean. Beyond
static checks, the following has been verified **live in a browser against
a real database**, not just built:

- Sign up, sign in, sign out — real sessions, real password hashing (bcrypt)
- Unauthenticated visits to any `/dashboard/*` route correctly redirect to `/login`
- A logged-in user only sees workspaces they have a real Membership on
- Creating a quote, generating a customer portal link, opening that link
  with no login, drawing an e-signature, and accepting the quote — full
  round trip, confirmed in the database
- The hot-lead alert firing exactly once when a quote's open count crosses 2
- Permission enforcement: a non-owner cannot see the staff-invite form

The `apps/driver` mobile app has been typechecked but not run in a
simulator — see its own README for exactly what's built vs. still scaffold.

## Checkpoint — what needs your input before this runs live in production

Everything above is buildable, testable, and has been run for real, locally,
without external accounts. These four things need real credentials before
a **deployed** instance can run end-to-end for real customers:

1. **`DATABASE_URL`** (production) — a managed Postgres instance. Free
   options: [supabase.com](https://supabase.com) or [neon.tech](https://neon.tech).
2. **`ANTHROPIC_API_KEY`** — from [console.anthropic.com](https://console.anthropic.com),
   for AI-drafted follow-ups. Without it, the follow-up cron falls back to a
   plain template automatically — nothing breaks, it's just less personalized.
3. **WhatsApp Business API credentials** — a 360dialog (or Twilio) account and
   a registered WhatsApp Business number. Until this is set, `sendWhatsAppMessage`
   safely logs to console instead of failing.
4. **`RESEND_API_KEY`** — for staff invite emails and hot-lead alerts to
   actually deliver. Until set, `sendEmail` safely logs to console.

`AUTH_SECRET` does NOT need an external account — generate one yourself
with `openssl rand -base64 32` and set it per environment.

## Not done — real scope, not hidden

- Photo/signature capture on the **driver app** (distinct from the customer
  portal's signature, which is built) — needs object storage (R2/B2).
- Offline-first local queueing on the driver app.
- Sales-rep and technician mobile screens.
- Conversational AI onboarding (form-based onboarding works now; the AI
  version replaces it once `ANTHROPIC_API_KEY` is live).
- Real pilot customers — not a coding task.
- Legal/compliance/tax-filing features discussed are not started.
- No migration off local/Hostinger hosting — correctly so, no real scaling
  trigger has been hit yet.
