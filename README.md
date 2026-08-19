# One Platform

AI-native, unified business OS for SMEs — CRM, quoting, invoicing, AR-chasing,
inventory, delivery, and cross-tenant wholesale trading on one shared core,
one WhatsApp-native channel. Companion build to the strategic report and
build manual produced alongside this repo.

Seven verticals live side by side on the same engine — Corporate, Services,
Logistics, Medical, Retail, Wholesale, Ecommerce — chosen at onboarding, so
performance can be compared across industries before committing to one.

## Stack

Next.js (App Router) + TypeScript, Prisma 7 (driver-adapter pattern) +
Postgres, Auth.js, Vercel AI SDK (Claude), Tailwind (dark/glassmorphic
brand theme), WhatsApp Business API via a BSP (360dialog). A separate Expo
React Native app (`apps/driver`) is the field-app foundation. See the build
manual for the full phase-by-phase plan.

## Core architecture

One data model, not separate modules: `Party` (people — customers, patients,
suppliers, staff), `Item`, `Transaction` (append-only ledger — quotes/
invoices/payments), `Event` (deliveries, visits, follow-ups sent),
`WholesaleConnection` (cross-tenant trading links), `AuditLog`. All in
`prisma/schema.prisma`.

The **Business Graph API** (`src/lib/core/*.ts`) is the only code allowed to
write these tables. The owner UI, the mobile field app, and the AI layer
(`src/lib/ai/tools.ts`) call the exact same functions — no separate code
path for AI or mobile actions, which is what keeps every action auditable.

The **niche-config layer** (`src/lib/niches/config.ts`) is what "one engine,
seven skins" means in code: every vertical shares the same tables; only
vocabulary and pipeline-stage labels change per niche, selected once at
onboarding.

```
src/lib/core/money.ts       quote -> invoice -> payment, customer balance, leakage query
src/lib/core/movement.ts    deliveries, follow-up-sent logging, touch counting
src/lib/core/parties.ts     customers/patients/suppliers/staff, customer history
src/lib/core/connections.ts wholesaler-retailer cross-tenant trading
src/lib/core/access.ts      role -> capability permission checks (Phase 8)
src/lib/core/audit.ts       audit log writer (Phase 8)
src/lib/niches/config.ts    the 7 niche skins: vocabulary + pipeline stages
src/lib/ai/tools.ts         AI tool-calling wrappers around the Business Graph API
src/lib/ai/followUp.ts      AI-drafted follow-up messages, escalating by touch number
src/lib/whatsapp/client.ts  WhatsApp send (stubs out safely with no API key)
src/app/onboarding/         niche picker + tenant creation
src/app/dashboard/[tenantId]/  tenant-scoped owner UI (dark/glass design)
src/app/api/whatsapp/webhook/   inbound WhatsApp messages
src/app/api/cron/follow-ups/    hit by a scheduled cron job, sends due follow-ups (AI-drafted, template fallback)
src/app/api/cron/daily-briefing/ daily WhatsApp cash-position summary per tenant
src/app/api/mobile/deliveries/  field-app endpoints (list + complete)
apps/driver/                 Expo React Native driver app (Phase 6 scaffold — see its own README for honest scope)
tests/core/money.test.ts    Phase 1's Definition of Done, as an actual test
prisma/seed.ts              seeds one demo tenant per vertical
```

## Local setup

```bash
cp .env.example .env
npm install
npx prisma generate
npx prisma migrate dev --name init   # needs DATABASE_URL — see checkpoint below
npm run db:seed                       # seeds one demo tenant per vertical
npm run dev
npm run test                          # needs DATABASE_URL — runs the money-ledger tests
```

## Verified so far

Every change in this repo has been checked with `tsc --noEmit`, `eslint`,
and a full `next build` — all currently pass clean, including all 13 routes
(owner dashboard, onboarding, connections, mobile API, cron jobs). The
`apps/driver` mobile app has been typechecked but not run in a simulator —
see its own README for exactly what's built vs. still scaffold.

## Checkpoint — what needs your input before this runs live

Everything above is buildable and testable without external accounts except
these four things, which need real credentials from you before the app can
actually run end-to-end:

1. **`DATABASE_URL`** — a real Postgres instance. Free options: [supabase.com](https://supabase.com)
   or [neon.tech](https://neon.tech). Create a project, copy the connection
   string into `.env`. Nothing that touches the database — including
   `npm run db:seed` and the money-ledger tests — can run without this.
2. **`ANTHROPIC_API_KEY`** — from [console.anthropic.com](https://console.anthropic.com),
   for AI-drafted follow-ups. Without it, the follow-up cron falls back to a
   plain template automatically — nothing breaks, it's just less personalized.
3. **WhatsApp Business API credentials** — a 360dialog (or Twilio) account and
   a registered WhatsApp Business number, needed for `WHATSAPP_API_KEY` /
   `WHATSAPP_PHONE_NUMBER_ID` / `WHATSAPP_WEBHOOK_VERIFY_TOKEN`. Until this is
   set, `sendWhatsAppMessage` safely logs to console instead of failing.
4. **Object storage** (Cloudflare R2 or Backblaze B2) — for delivery photos
   and e-signatures once the driver app's photo/signature capture is built.

Everything else — the schema, the Business Graph API, all seven niche
configs, the wholesale connection layer, the dashboard UI, the cron/webhook
route shapes, the AI tool definitions, and the mobile app scaffold — is
built and ready to run the moment #1 above is in place.

## Not done — real scope, not hidden

Being direct about what's still outstanding against the build manual's 8
phases:

- **Phase 5** (real pilot customers) isn't a coding task — needs you.
- **Phase 6** (field apps) has its foundation (driver app, delivery
  list/complete) but not photo/signature capture, offline-first local
  queueing, or the sales-rep/technician screens yet.
- **Phase 8** (scale/harden) has RBAC and audit-log primitives in place, but
  no real session-based auth yet (still the single biggest checkpoint item),
  and no migration off Hostinger — correctly so, since no real scaling
  trigger has been hit yet.
- The doctors/patient, legal/compliance/tax-filing, and end-customer-portal
  features discussed are not yet built — the `MEDICAL` niche skin exists
  (appointments, non-clinical), but compliance/filings and a second
  authentication tier for the tenant's own customers are real, separate
  pieces of scope not started.
