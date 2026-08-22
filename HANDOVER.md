# flow — Handover

**Last updated:** 2026-08-22
**Repo:** [github.com/skynatlabs/skynatflow](https://github.com/skynatlabs/skynatflow) (private)
**Live deploy:** Vercel project under `skynatlabs' projects` — connected to a real production Supabase database, SSL issue resolved (see "Production DB — SSL gotcha" below), login/signup verified live. **Pushed to `main` and all 16 migrations applied to production as of 2026-08-22.**

## 2026-08-22 update — multi-page marketing site + super-admin CMS

Built out the marketing site from one hardcoded homepage into 13 pages, all editable by a super-admin through a structured section editor (not a free block builder) — no code changes needed to update copy/images going forward.

- **New Prisma models:** `PageContent`, `PageSection` (migration `20260822201311_marketing_cms`, applied locally only — **not yet on production**, needs the same `prisma migrate deploy` treatment as above before this ships).
- **13 pages, all CMS-backed:** Home, About Us, AI & Agents, Case Studies, Benefits, Integrations, plus one landing page per industry (`/industries/[skin]`, all 7 `NicheSkin`s) — each pulling industry-specific copy from `NICHE_CONFIGS` and rendering a live pipeline preview.
- **Template system:** `src/lib/cms/pageTemplates.ts` is the single source of truth for what sections exist on each page and their type (hero/richText/imageText/grid/testimonials/logos/cards/cta) — drives both the public renderer (`src/components/marketing/sections/SectionRenderer.tsx`) and the admin editor form.
- **Super-admin editor at `/admin`** — guarded by a new `requireSuperAdmin()` (`src/lib/auth/tenant-access.ts`), same 404-not-leak pattern as tenant access. Structured per-section editor: text fields + image upload + add/remove repeatable items (testimonials, case study cards, integration logos, etc), saves via server action, reflects on the public page immediately.
- **Image storage — Cloudflare R2, checkpoint, not yet configured.** `src/lib/storage/r2.ts` wraps `@aws-sdk/client-s3` against R2's S3-compatible API. `STORAGE_ENDPOINT`/`STORAGE_ACCESS_KEY_ID`/`STORAGE_SECRET_ACCESS_KEY`/`STORAGE_BUCKET`/`STORAGE_PUBLIC_BASE_URL` are all still empty in `.env` — the upload endpoint returns a clear "storage not configured" error until a free Cloudflare R2 account + bucket is created and the credentials are supplied. Everything else (all page content, text editing) works today without it.
- **Seed script:** `npm run db:seed:marketing` (`prisma/seed-marketing.ts`) populates real starter copy for all 52 sections across all 13 pages — idempotent, safe to re-run.
- Deliberately **not per-tenant** — this is the flow/Skynat marketing site only. A semi-whitelabeled customer-facing landing page per tenant business was discussed but is explicitly out of scope for this build (only documents like quotes/invoices are fully whitelabeled today).
- Verified end-to-end in-browser: all 13 public pages render, admin editor saves and reflects live, non-super-admin gets 404 on `/admin`, image-upload endpoint fails clearly when storage is unconfigured. Existing 14-test suite still passes.

## 2026-08-22 update — push + production migrations done

- All local commits pushed to `origin/main` (including the Phase 2.1 API/webhooks schema, which had been sitting uncommitted).
- Production DB had drifted from the migration history: only migrations 1–3 (`init`, `add_auth_and_tasks`, `customer_portal_and_quote_tracking`) were actually applied, and there was no `_prisma_migrations` ledger table at all — earlier sessions had applied a few migrations by hand via `psql` rather than through Prisma. Verified this column-by-column against the live schema before touching anything.
- Fix applied: baselined migrations 1–3 as applied (`prisma migrate resolve --applied <name>`), then ran `prisma migrate deploy` for the remaining 13. All 16 applied cleanly; `prisma migrate status` now reports "Database schema is up to date!" against production.
- **Lesson for future sessions:** don't apply individual `migration.sql` files by hand against production — it silently breaks Prisma's migration ledger and causes exactly this kind of drift. Always use `prisma migrate deploy` (with `DATABASE_URL` pointed at the session-pooler connection string) so the ledger stays authoritative.

> **Session note:** this session took the product from "solid MVP" to feature-parity-plus against GoHighLevel/ClickUp/Monday/Zoho — 20 shipped features (Phase 1 of a researched 70-item competitive roadmap), each built, migrated, and verified live in a real browser against a real Postgres database, not just written. Full detail in "Phase 1 complete" below. Start a fresh session from this file, not from scratch.

This is the working handover for **flow** (by Skynat) — the AI-native, multi-vertical business OS built out of the Skynat strategic report and build manual. If you're picking this up cold, read this file first, then `README.md` for the technical architecture.

## Immediate next action

1. Commit + push the marketing CMS work (see "2026-08-22 update — multi-page marketing site" above) — as of writing it's built, tested, and verified in-browser but **not yet committed**.
2. Run migration `20260822201311_marketing_cms` against **production** via `prisma migrate deploy` (session-pooler `DATABASE_URL`, same approach as the rest of this session's migrations — see "Production DB — SSL gotcha" below).
3. Create a free Cloudflare R2 account + bucket, enable public access, and supply `STORAGE_ENDPOINT`/`STORAGE_ACCESS_KEY_ID`/`STORAGE_SECRET_ACCESS_KEY`/`STORAGE_BUCKET`/`STORAGE_PUBLIC_BASE_URL` so CMS image uploads work (currently returns a clear "not configured" error).
4. Confirm the Vercel deploy builds clean with all of today's code before calling it done.

## Production DB — SSL gotcha (read this before touching prod DATABASE_URL)

Two real bugs, now fixed, worth knowing about if the connection ever breaks again:
- **Direct connection** (`db.<ref>.supabase.co:5432`) needs IPv6 — unreachable from most networks/CI. Use the **session pooler** connection string instead (`aws-0-<region>.pooler.supabase.com:5432`, username `postgres.<project-ref>`).
- **`pg` (and Prisma's adapter) now treats `sslmode=require` in the connection string as `verify-full`**, which rejects Supabase's pooler cert even when you also pass an explicit `ssl` override — the query-string value wins. Fix, already applied in `src/lib/db.ts`: strip `sslmode` from the URL before it reaches the pool config, and pass `ssl: { rejectUnauthorized: false }` explicitly instead.

## Just finished this session (rebrand)

Renamed the product from "One Platform" to **flow**, everywhere: marketing
site, dashboard sidebar, login/signup/onboarding, email templates, desktop
app (window title, menu, bundle id `shop.skynat.flow`), driver app config
(`app.json` renamed to package `shop.skynat.flow.driver` — **not yet
rebuilt**, the already-built/sent APK still carries the old
`shop.skynat.oneplatform.driver` package name). Added a real SVG logo
(`src/components/FlowMark.tsx`, gradient infinity mark) and a richer
3-stop coral→magenta→violet gradient system across buttons/text/tiles —
also fixed a previously washed-out pale-orange tile color, now a
richer rose/magenta. A real marketing homepage was also built this
session (`src/components/marketing/MarketingHome.tsx`), inspired by
ClickUp/Monday's design language, shown to logged-out visitors at `/`
(logged-in visitors still redirect straight to `/dashboard`) — **updated
again in the Phase 1 session below** to reflect the 20 new features.

---

## Phase 1 complete (Aug 2026) — 20 shipped features, competitive-parity push

Every item below was built, database-migrated, and manually verified live
in a real browser against a real Postgres database this session — not
just written. Full research/rationale behind the 70-item list this drew
from: see "Competitive roadmap" further down, and the published artifact
from that research pass.

**Money & documents**
- **Product/service catalog** — `Item` extended into a real reusable catalog (cost, tax, category, image, active toggle); New Quote now autocompletes from it instead of creating a fresh throwaway item every time.
- **CSV migration importer** — guided upload → column mapping → preview → commit, with presets for Zoho Invoice, QuickBooks, FreshBooks, Wave, Xero.
- **CSV data export** — one-click full export of customers/products/transactions — the "leave anytime" trust move.
- **Pipeline/deal board** — Kanban over the quote lifecycle (Draft/Awaiting/Won/Lost).
- **Recurring invoices** — standing schedule (weekly/monthly/quarterly), line-item snapshot so later catalog price edits don't reprice an existing subscription, cron-generated (`/api/cron/recurring-invoices`).
- **Credit notes/refunds** — `recordRefund()` as a first-class ledger entry (REFUND was in the schema enum, never had a function); also filled in the previously-missing "Convert to invoice" and "Record payment" dashboard UI.
- **Proposal e-sign audit trail** — SHA-256 hash binding amount+signature+timestamp+IP, verified against the RFC 4226 test vector.

**Trust & operations**
- **Roles & permissions matrix** — read-only page surfacing the fixed capability map.
- **Searchable/exportable audit log** — filter by capability, search by actor/target, CSV export.
- **TOTP 2FA** — RFC 6238 implemented directly on Node crypto (no dependency), Google Authenticator/Authy/1Password-compatible via `otpauth://`, opt-in at `/account/security`.
- **Booking page** — public link (`/book/[tenantId]`), owner sets working hours, bookings land as normal Events.
- **Photo proof of delivery/install** — stored as a data URL (same pattern as e-signatures, no object storage needed yet), visible on the customer portal.
- **Internal comments with @mentions** — polymorphic `Comment` model, works on any record.

**Growth & AI**
- **Review request automation** — fires once, the moment an invoice first reaches PAID, via WhatsApp.
- **Proposal templates** — reusable intro/scope text blocks, picker on the New Quote form.
- **Guided setup checklist + trial value nudge** — self-hiding onboarding checklist; past day 6, a banner showing real tracked value (quotes, customers, hot leads).
- **Cash-sale quick capture** — one-step already-PAID invoice for a walk-in, no quote stage, shared "Walk-in customer" Party when no name given.
- **Made the confirm-before-send guardrail real** — the code had *claimed* this existed for months (see comments in `src/lib/ai/followUp.ts`), but the cron job actually sent WhatsApp messages straight with zero review. Now every AI-drafted follow-up lands as a pending `AiDraft` with visible reasoning; nothing reaches a customer until the owner clicks Approve (editable first) or Skip, at `/dashboard/[tenantId]/ai-drafts`.
- **Collections tone dial** — Gentle/Standard/Firm setting shifts the whole escalation curve (both the AI prompt and the no-API-key template fallback), not just one message's wording.
- **Dispute/complaint flow** — customer flags "this isn't right" from the portal, owner resolves it with a note at `/dashboard/[tenantId]/disputes`. Most CRMs have zero structured path for this.

**New Prisma models this session:** `RecurringInvoice`, `Comment`, `ProposalTemplate`, `AiDraft`, `Dispute`. **Extended:** `Item` (catalog fields), `Transaction` (`QuoteKind`, acceptance audit fields, `reviewRequestSentAt`), `Tenant` (`bookingConfig`, `googleReviewUrl`, `collectionsTone`), `User` (`totpSecret`, `totpEnabled`), `Event` (`scheduledAt`).

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
| Desktop (macOS) | `apps/desktop/` (Electron) | **Built and launch-tested on Apple Silicon.** Artifact: `apps/desktop/dist/mac-arm64/flow.app` (+ a `.zip` of the same). Unsigned — Gatekeeper will warn on first open elsewhere; fine for local testing on this machine. |
| Mobile (Android, driver app) | `apps/driver/` (Expo/React Native) | **Built — real, installable release APK.** `apps/driver/android/app/build/outputs/apk/release/app-release.apk` (65MB, targets Android 7–16). Built under package `shop.skynat.oneplatform.driver` — `app.json` has since been renamed to `shop.skynat.flow.driver` as part of the Flow rebrand, so a fresh `expo prebuild` + Gradle build is needed to get an APK with the new package id (not done yet — that's a ~10 min resource-heavy build, deferred until needed). Signed with the Android **debug** keystore either way — installs fine via `adb install`/sideloading for testing, **not** Play-Store-submittable as-is. |
| Mobile (iOS) | `apps/driver/` | Not built — same Expo codebase can target iOS, just hasn't been built/tested yet |

---

## Checkpoints — what needs a human, not more code

These are the things that are genuinely blocked on someone's decision or an external account — not things I forgot to build:

1. ~~Production `DATABASE_URL`~~ — **resolved.** Real Supabase Postgres connected, `AUTH_SECRET` set, login/signup verified live. See "Production DB — SSL gotcha" above if the connection ever breaks. **Still outstanding: this session's ~10 new migrations haven't been applied to production yet** (only run locally) — that's the current blocker, see "Immediate next action" at the top.
2. **Domain** — currently sitting on Vercel's auto-generated `.vercel.app` URL. Recommended: point a subdomain of an existing Skynat domain at it (e.g. `app.skynat.co.za`) rather than buying a new one.
3. **`ANTHROPIC_API_KEY`, WhatsApp Business API creds, `RESEND_API_KEY`, `CRON_SECRET`** — all optional for now. Everything degrades gracefully without them (AI follow-ups fall back to templates, WhatsApp sends log to console instead of failing, cron endpoints work fine hit manually) — nothing breaks, features just aren't "live" yet. Needed before real users: at minimum WhatsApp creds (booking confirmations, review requests, follow-ups all currently no-op on the actual send) and an actual cron schedule (Hostinger Cron Jobs per the code comments) hitting `/api/cron/follow-ups` and `/api/cron/recurring-invoices`.
4. **Apple/Google developer accounts** — needed before the desktop app can be signed/notarized for real distribution, or the Android app can go on the Play Store. Right now both are real, working, unsigned builds — fine for internal testing, not for public distribution.

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

- Driver app: no photo/signature capture yet (needs object storage — R2/B2), no offline-first queueing, no real per-driver login. Delivery list + mark-delivered works. (Note: the *web* dashboard's photo-proof feature, shipped this session, stores photos as data URLs directly in Postgres — fine at current scale, but genuinely needs object storage once photo volume grows; that's the natural moment to also wire up the driver app's photo capture.)
- No sales-rep or technician mobile screens yet.
- AI-conversational onboarding not built — current onboarding is a clean form, works fine, just not the AI-chat version from the strategic report.
- Desktop and Android builds are unsigned — fine for internal testing, would trigger OS security warnings for anyone else.
- WhatsApp Business API, Google Calendar, IMAP mail, accounting sync (Xero/QuickBooks), and Zapier are all scoped (Phase 2) but not built — need real provider credentials first, see Checkpoints above.
- The booking settings page (`/dashboard/[tenantId]/settings/booking`) has become a small grab-bag (booking config + review link + collections tone) — fine functionally, worth splitting into a proper Settings section with sub-pages once there are more of these.

## Where to pick up next

1. Push this session's work and apply its migrations to the production database — see "Immediate next action" at the top.
2. **Public API + webhooks** (Phase 2.1/2.2, see "Competitive roadmap" below) — the one Phase 2 item that's genuinely unblocked right now (no external credentials needed). Schema's migrated, application code is not written yet.
3. Phase 2 from the competitive roadmap — payment rails, Google Calendar, IMAP inbox, accounting sync, Zapier, WhatsApp two-way inbox — once the relevant provider credentials are available.
4. Driver app depth (photo/signature, offline queue) once there's a real delivery-heavy pilot customer to build it for.

## Next pipeline features — gap vs. ClickUp/Monday

Reviewed both competitors' marketing sites directly (screenshots in
`inspiration images/`, gitignored). What they have that we don't yet, in
priority order:

1. **Custom AI agents (highest priority)** — ClickUp's "Super Agents" and
   Monday's "AI Agents" let an owner define their own automation in plain
   language ("when a quote goes unanswered 5 days AND is over R10,000, do
   X"), not just use our one fixed follow-up job. **How to build it:**
   `src/lib/ai/tools.ts` already exposes Business Graph functions as
   AI-callable tools — add a `CustomAgent` model (trigger type + plain-
   language instructions + allowed tools) and a simple builder UI. This is
   the single highest-leverage gap and the most on-brand for "AI-first."
2. **Persistent AI chat/assistant** (ClickUp Brain², Monday Sidekick) — an
   always-available chat answering "what's overdue this week?" on demand,
   not just the automatic follow-up engine. Smaller lift than #1 — same
   tool layer, just a streaming chat UI via the Vercel AI SDK.
3. **Docs/Wiki** — internal notes/SOPs living next to the business data.
   New `Document` model + simple rich-text editor. Medium scope.
4. **Generic visual automations builder** — really the same underlying
   need as #1; build one system that serves both framings rather than two.
5. **Time tracking / Sprints / Goals / Dependencies / Milestones** —
   deliberately NOT built, on purpose (per the "must be easy to use"
   instruction that shaped the Task board). Only worth adding if real
   customers ask for it — adding it preemptively risks recreating the
   bloat we were explicitly avoiding.
6. **Whiteboards/Mind Maps** — low priority, doesn't map to any pain point
   from the strategic report's research; ClickUp chasing "replace all
   software," not solving an SME-specific problem.
7. **Native internal team chat** — low priority; our WhatsApp-native
   positioning already covers this better for our target market than
   another internal chat tool would.
8. **SSO, granular custom fields, integrations marketplace** — real, but
   correctly sequenced later, once there are customers big enough to need
   enterprise readiness (maps to the existing Phase 8 hardening track).

## Competitive roadmap (Aug 2026) — what's building, what's parked

Full research doc (70 researched items, GoHighLevel/ClickUp/Monday/Zoho
benchmarking): see the published artifact from that session. Summary of
what got triaged out of active build and why:

**Deferred — needs a real business/banking partnership before any code is
useful, not just missing an API key:**
- Invoice financing ("get paid today for tomorrow's invoice") — needs a
  lending partner or our own credit facility; building the UI first
  would just be vaporware.
- Same-day payout on card/EFT — needs a settlement/banking relationship
  with the payment processor, not something we control from app code.
- White-label reseller program — needs a pricing/legal/support model for
  resellers before it's a feature, not a form.
- Voice AI for inbound calls — needs a telephony contract (Twilio-class
  provider + numbers per market) and per-market compliance; revisit once
  there's a signal customers actually want it, not before.

**Deprioritized — real ideas, but not where the value is for this stage:**
- Franchise/multi-branch rollup — near-zero demand until we have
  customers who actually run multiple branches; premature to build.
- Data residency choice (EU/US/ZA) — only matters once a regulated
  customer actually asks; building it speculatively is enterprise-tier
  work with no current buyer.
- Referral/affiliate program — a growth-marketing feature, not a product
  one; revisit post-launch once there's a real user base to refer from.
- Landing page/funnel builder — scope creep toward "replace all
  software" (the ClickUp trap called out above); WhatsApp + the customer
  portal already cover lead capture for our niches.
- Natural-language search across the whole business — nice, but the
  daily-briefing + leakage report already answer the questions owners
  actually ask; revisit once usage data shows people want more.
- Voice-to-quote in the field — cool, low daily-use value versus build
  cost; the field app's photo/form capture already covers the job.
- Unified inbox across every channel (WhatsApp + SMS + email + IG/FB DM)
  — right direction, wrong order: build the two-way WhatsApp inbox and
  the mail client first (both already scoped in Phase 2), then unify
  once each channel actually works on its own.

**Phase 1 (all 20 "Now" items — no external dependencies) is done** — see
"Phase 1 complete" near the top of this file for the full list, each
verified live.

**Phase 2 — next up, but blocked on the user supplying real provider
credentials, not on more engineering:** payment rails (PayFast/Yoco/
Stripe), Google Calendar sync, IMAP mail client (inbox half — the
send-only Resend scaffold already exists), Xero/QuickBooks two-way sync,
Zapier connector, WhatsApp Business API two-way inbox. Code can be
scoped/built ahead of the credentials arriving, but can't be verified
live without them.

**Phase 2.1/2.2 — Public API + outbound webhooks (the one Phase 2 item
that needs no external credentials, only "us"):** schema-only so far.
`ApiKey`, `WebhookEndpoint`, `WebhookDelivery` models added to
`prisma/schema.prisma` and migrated locally (migration
`20260822175544_public_api_webhooks`) — **not yet applied to
production**, and no application code exists yet: no `src/lib/core/
apiKeys.ts`, no `/api/v1/*` REST routes, no key-management or webhook
settings UI, no dispatch function. This is the correct next pickup point
whenever building resumes — genuinely unblocked, doesn't need any
partner integration or provider account. Planned shape:
- `src/lib/core/apiKeys.ts` — `createApiKey`/`listApiKeys`/`revokeApiKey`/
  `resolveApiKey(rawKey)`, SHA-256 hash stored, plaintext key shown once
  at creation only (`flow_<hex>` prefix).
- `/api/v1/*` — REST routes (customers, products, quotes, invoices)
  authenticated via `Authorization: Bearer <key>`.
- Settings page for API key management.
- Webhook dispatch wired into `quote.created`, `quote.accepted`,
  `invoice.paid`, `dispute.raised`, plus a settings page for endpoint
  management.
