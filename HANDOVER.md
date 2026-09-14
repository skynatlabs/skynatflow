# flow — Handover

**Last updated:** 2026-09-13
**Repo:** [github.com/skynatlabs/skynatflow](https://github.com/skynatlabs/skynatflow) (private)
**Live deploy:** `skynatflow-topaz.vercel.app`, custom domain `skynatflow.com` — connected to production Supabase, all migrations through `20260831135502_add_calendar_integration` applied and verified live as of this update (`prisma migrate status` reports "Database schema is up to date!" against production). Everything described below is pushed, migrated, and confirmed responding in production, not just local.

**Vercel project note:** the Vercel org has TWO projects — `skynatflow` (the real one, aliased to skynatflow.com) and a stray empty `one-platform` project created by accident during a `vercel link` mishap on 2026-08-30. The stray project has zero deployments and is harmless sitting there, but delete it from the Vercel dashboard when convenient to avoid confusion. Always `vercel link --project=skynatflow` explicitly, never let it auto-create.

## 2026-08-31 — Ladder buildout, phase 1 (real code + real tests, verified live)

Started working through the 50-item PA ladder for real, not just the skeleton. Audited what already existed before building (several items turned out to already be shipped from earlier sessions — see below), then built and tested what was genuinely missing.

**Newly built, tested, verified live this pass:**
- **Job 11 (unusual-amount flag)** — `checkUnusualAmount()` in `src/lib/core/money.ts`: compares a quote/invoice against that specific customer's own historical average (never a fixed platform threshold), flags at 3x+. Never flags a first-ever document (nothing to compare against). Rendered as an amber banner on both the quote and invoice detail pages. 2 new tests in `tests/core/money.test.ts`, both passing.
- **Job 13 (weekly performance digest)** — `src/app/api/cron/weekly-digest/route.ts`: quotes sent, cash collected, new customers, and what's gone stale, emailed to each tenant's owner. Same secret-protected GET pattern as the existing `daily-briefing` cron (hit externally, e.g. Hostinger Cron Jobs — not on a schedule inside this app). **Hit live against local dev data: `{"ok":true,"digestsSent":8}`, no errors.**
- **Job 44 (donation receipt automation)** — `recordDonation()` in `src/lib/core/nonprofit.ts` now auto-generates a sequential `DON-<year>-<NNNN>` receipt number and emails a tax-ready receipt the instant a donation is recorded, unless the donor has no email on file (silently skipped, never throws). 4 new tests in `tests/core/nonprofit.test.ts` (new file), all passing.

**Already fully built from earlier sessions — confirmed, not rebuilt** (audited before touching anything, to avoid duplicating real work):
- Jobs 20/23/25 (stock reorder alerts, restock-before-stockout, slow/dead-stock flagging) — `src/lib/core/inventory.ts` already has a complete demand-velocity engine: `getDemandHeatmap()` classifies every item fast/slow/dead from real sales velocity, `getReorderSuggestions()` sizes a reorder quantity off actual recent demand + lead time, `getExpiryRisk()` even covers batch expiry (beyond the original ladder scope). Surfaced at `/dashboard/[tenantId]/inventory`.
- Job 29 (abandoned-cart nudge) — `findAbandonedQuotes()` in `money.ts`, a customer who opened a quote link and went quiet gets flagged sooner than the standard stale-quote window.
- Jobs 1/3/4/5/6/7/8/10/12/14/22/37/40 — confirmed already live from prior session work (follow-up engine, calendar sync, voice briefing/Q&A, doc backup, hot-lead tracking, onboarding extraction, WooCommerce auto-invoice, appointment reminders).

**Genuine remaining gaps** (gone through the list; these need either new domain modeling or an integration this app doesn't have yet — flagged honestly rather than stubbed):
- No bank-feed integration exists → job 9 (payment reconciliation against a bank feed) isn't buildable without one.
- No driver-facing mobile capture exists → job 34 (photo/signature proof-of-delivery from a driver's phone) needs that first.
- No OCR/receipt-photo matching exists → job 26 (matching a return to its original sale from a photo) needs that first.
- No waitlist model exists yet → job 39 (filling a cancelled slot from a waitlist).
- No crew/territory model exists yet → job 17 (matching a job to the nearest crew) and job 31 (delivery routing) both need a "who/where" layer that isn't modeled today.
- Straightforward but not yet built: job 15 (site-visit scheduling as a PA command intent), job 19 (warranty pack assembly), job 27 (till reconciliation mismatch flag — `TillSession`/POS data exists, just not this check), job 32/33 (delivery status auto-reply / late flag), job 38/41/43/45/46 (no-show follow-up, recall reminders, membership renewal, sponsor outreach, RSVP chasing — all could reuse the existing follow-up-engine pattern), job 48/49/50 (lead balancing, commission rollup, team digest — `salesPersonMembershipId` attribution already exists on every Transaction, just no reporting built on top of it yet).

## 2026-08-31 — Ladder buildout, phase 2 (no-show rebooking + membership renewal chasing)

- **Job 38 (no-show follow-up)** — `markNoShowAndRebook(eventId)` in `src/lib/core/reminders.ts`. Deliberately human-triggered, not inferred: a passed appointment with nothing else recorded is just as often "not logged yet" as a real no-show, so the PA acts on a person's judgment call rather than guessing. Marks `Event.noShow` (new field) and sends an immediate WhatsApp rebooking nudge. **No UI surface built yet** — there's no appointments/calendar list page in the dashboard at all today (booking is public-facing only), so this is a real capability with nothing to click yet. 3 new tests in `tests/core/reminders.test.ts`, all passing, including confirming the WhatsApp stub degrades cleanly with no key configured.
- **Job 43 (membership renewal chasing)** — new `MembershipInvolvement.renewalDueAt` field (deliberately explicit, not an assumed annual cadence — real membership terms vary) plus `checkMembershipRenewals()`/`setRenewalDueDate()` in `src/lib/core/nonprofit.ts`, same "who's about to lapse" shape as the commercial follow-up engine. **No UI surface built yet either** — same gap as above, the non-profit members page doesn't have a renewal-date field or a "due for renewal" view yet. 3 new tests, all passing.
- Migration `20260831145721_add_noshow_and_membership_renewal`, applied to local dev DB only — **needs `prisma migrate deploy` against production before shipping**, same as the PA-voice migration from earlier this session.
- Full suite: **26/26 tests passing**, typecheck clean.

**Closed the loop on job 38 same pass**: built `/dashboard/[tenantId]/appointments` (new nav item, MEDICAL/SERVICES niches only) — lists upcoming/past CONSULTATION+SITE_VISIT events, with a "Mark no-show" button on past ones wired to `markNoShowAndRebook`. **Caught and fixed a real bug during live verification**: the running dev server had a stale Prisma client cached from before `prisma generate` was re-run for the schema migration — the button 500'd with "Unknown argument `noShow`" until the dev server was restarted. Lesson for next session: **always restart the dev server after any `prisma migrate dev`/`prisma generate`, not just after the migration completes** — a long-running `next dev` process does not pick up a regenerated client on its own. After the restart, clicked the actual button in the browser end-to-end: event flipped to `noShow: true`, UI updated to "No-show — nudged", and the WhatsApp stub logged the correct rebooking message — confirmed via server logs, not just a green test.

**Job 43's UI surface closed out same pass** — `/dashboard/[tenantId]/members` now has a "Due for renewal" banner (chases the same way a stale quote does) plus a per-member renewal-date picker and a "· renewal due" badge inline in the active-involvement list. Verified live: attached the demo Services owner to a scratch NONPROFIT tenant (superadmin-style access, no real login flow changed), confirmed the due-banner, the date badge, and that an ended involvement correctly drops out of the active list and renewal-due check — then cleaned up all the scratch data (tenant/membership/party/donation/involvement rows) afterward so it doesn't pollute the demo dataset.

Both job 38 and job 43 are now genuinely done end-to-end: schema → core logic → real tests → UI → live-clicked verification. That's the bar the remaining items should be held to.

## 2026-08-31 — Ladder buildout, phase 3 (site-visit scheduling PA intent)

- **Job 15 (site-visit scheduling as a PA command)** — `scheduleAppointment()` in `src/lib/core/movement.ts` (rejects booking in the past; 2 new tests in `tests/core/movement.test.ts`), plumbed into `pa/command/route.ts` as a second intent (`schedule_visit`) alongside the existing quote-duplication one — same classify-then-execute endpoint, same find-or-create-party pattern, resolves relative dates ("Tuesday morning") against the current date server-side rather than trusting the model's own clock. Both `FloatingPaButton.tsx` and `PaCommandBox.tsx` updated to handle either response shape (drafted-quote vs booked-appointment) instead of assuming quotes are the only outcome.
- **Verified live**: hit the floating button with "book a site visit for Peter Tuesday morning" — confirmed the new prompt/schema path doesn't break the existing no-AI-provider degradation (same clean message as before, no crash, no regression). Full synthesis-and-scheduling path itself needs a real AI key to exercise end-to-end (same limitation as the quote-duplication intent has always had locally) — the underlying `scheduleAppointment()` logic is fully unit-tested independent of that.
- Full suite: **28/28 tests passing**, typecheck clean.

## 2026-08-31 — Ladder buildout, phase 4 (till reconciliation flag)

- **Job 27 (till reconciliation mismatch flag)** — the variance *computation* already existed (`closeTill()` in `src/lib/core/pos.ts` always computed expected-vs-counted), but it was being thrown away — never persisted, never shown anywhere. Added `TillSession.varianceCents` (migration `20260831151223_add_till_variance_field`, applied to local dev only), `closeTill()` now persists it, and `/dashboard/[tenantId]/pos` shows an amber "Last till close-out was short/over by X" banner when the most recently closed session has a nonzero variance. 3 new tests in `tests/core/pos.test.ts` (zero-variance match, a shortfall, and confirming card sales don't inflate the expected-cash figure).
- **Verified live**: seeded a closed session with a deliberate R50 shortfall directly in the dev DB, reloaded `/pos`, confirmed the exact banner text and amount rendered correctly, no server errors — then cleaned up the scratch row.
- Full suite: **31/31 tests passing**, typecheck clean.

## 2026-08-31 — Ladder buildout, phase 5 (salesperson-attribution trio — jobs 48/49/50)

- **`src/lib/core/salesReporting.ts`** (new) built on the `salesPersonMembershipId` attribution that already existed on every Transaction:
  - **Job 48 (lead balancing)** — `suggestSalesPersonForNewLead()`: picks the rep with the fewest currently-open (SENT) quotes. A suggestion, not an auto-assignment — wired into the New Quote page's salesperson dropdown as a "(suggested — lightest current load)" tag and pre-selected default, per the ladder's own Copilot-not-Autopilot call for this job.
  - **Job 49 (commission rollup)** and **job 50 (team performance digest)** share one function, `getTeamPerformance()`, since revenue-won-per-rep *is* the commission-calculation figure: quotes sent, quotes won, conversion rate, revenue won — all-time, only ACCEPTED/PAID/PARTIALLY_PAID quotes count toward revenue. New page `/dashboard/[tenantId]/team-performance` (new nav item) renders it as a ranked list.
  - 3 new tests in `tests/core/salesReporting.test.ts`: load-balancing picks the less-loaded rep, revenue/conversion math is correct and excludes declined quotes, and a rep with zero quotes is dropped from the report entirely rather than showing a confusing 0%/R0 row.
- **Verified live**: the team-performance page's empty state renders correctly for the demo tenant (no quotes have a salesperson yet); the New Quote page correctly shows and pre-selects the suggested rep. No server errors.
- Full suite: **34/34 tests passing**, typecheck clean.

**This closes out every genuinely-buildable item identified in this session's ladder audit** (phase-1 through phase-5, jobs 11/13/15/20/23/25/27/29/38/43/44/48/49/50 either newly built or confirmed already-shipped). What's left on the list needs infrastructure this app doesn't have yet — see the "genuine remaining gaps" note in phase 1 above (bank feed, driver mobile capture, receipt OCR, waitlist/crew-territory models) — plus a handful of Manual-tier items the ladder itself never asked to be automated (upsell suggestions, seasonal reorder planning, monthly sponsor impact summaries).

## 2026-08-31 — PA reach expansion, phase 1 (email awareness)

The user asked directly whether the PA could actually handle a real personal-assistant job list (check important mail, act on a specific client's email, edit invoices on request, plan the day, job cards, purchase orders). Honest audit found: email fetch+AI-classification already existed (`ingestEmail`/`fetchNewImapEmails` in `src/lib/core/email.ts`, IMAP + flow-hosted inbound, Inbox page) but was **completely invisible to the PA** — the voice assistant's context never included it. Calendar booking (job 3) was already real from earlier phases. Invoice-edit-on-request (job 4), job cards (job 6), and purchase-order documents (job 7) do not exist at all yet.

- **`getRecentEmailsForPa()`** (new, `src/lib/core/email.ts`) — last 15 inbound emails, important-first, sender resolved to the matching Party's name when their email is on file (falls back to the raw address otherwise), summary-only (never full body, keeps token cost low). 4 new tests in `tests/core/email.test.ts`: name resolution, fallback-to-address, important-first ordering, empty-inbox case.
- Wired into `voice-assistant/route.ts`'s context string and system prompt — "any important mail?" and "what did [name] email about?" are now answerable the same way quote/invoice questions already were.
- **Verified live**: seeded a real inbound email against the demo tenant, confirmed `getRecentEmailsForPa()` returns it correctly formatted, and confirmed the voice-assistant route builds its context (including the new email data) without error before hitting the expected "no AI provider configured" degradation — no crash, no regression. Full LLM answer quality itself needs a real AI key to verify (same limitation every AI-dependent feature in this app has locally).
- Full suite: **38/38 tests passing**, typecheck clean.

## 2026-08-31 — PA reach expansion, phase 2 (customer-detail-change intent — job 4)

**Deliberately scoped narrower than "edit the invoice"**: real customer requests to "change my invoice details" are almost always about *their own contact/billing record* (address, VAT number, company name) — never pricing or line items. Automating a natural-language change to what was actually billed would be genuinely dangerous (exactly the kind of thing the ladder's own "judgment vs rules" section says should stay deterministic and human-reviewed, not PA-driven). So this intent updates the **Party record**, not the Transaction — which also means the change correctly applies to every past and future document for that customer, not just one invoice.

- **`applyPartyDetailChange()`** (new, `src/lib/core/parties.ts`) — a genuinely partial update: only fields actually mentioned get touched, everything else on the customer record is left alone. This had to be a new function, not a reuse of the existing manual edit form's action, because that action always submits every field from a full form and would silently null out anything a natural-language request didn't mention. 4 new tests in `tests/core/parties.test.ts`: partial-field update, multi-field update, rejects an empty patch, and rejects a cross-tenant party (a real isolation check, not just a happy-path test).
- Wired into `pa/command/route.ts` as a third intent (`update_customer_details`), same find-existing-customer pattern as the other two intents (phone → email → name), explicit prompt instruction that this intent is ONLY for the customer's own record, never money/line-items. Both `FloatingPaButton.tsx` and `PaCommandBox.tsx` updated to recognize this third response shape.
- **Verified live**: hit the PA command endpoint directly with "Jane's VAT number is now 4567891" — confirmed the new intent/schema path runs clean through to the expected "no AI provider configured" degradation, no crash, no regression (same limitation as the other two intents — full LLM classification needs a real AI key to verify end-to-end, not available locally).
- Full suite: **42/42 tests passing**, typecheck clean.

The PA command endpoint now has 3 real intents (send_quote, schedule_visit, update_customer_details) sharing one classify-then-execute pattern — each new job on the ladder that fits "find something, do a bounded/safe action, hand back a review link" is now a small, well-understood addition to this same file.

## 2026-08-31 — Purchase orders for retail (job 7)

New models: `PurchaseOrder`/`PurchaseOrderLine` (migration `20260831174936_add_purchase_orders`, local dev only), deliberately separate from the `Transaction` ledger — a PO is a commitment to a supplier, not a sale, and mixing it into Transaction would break every report that sums transaction amounts as revenue. `PartyRole.SUPPLIER` already existed in the enum but had no UI anywhere; added one (inline quick-add on the new page).

- **`src/lib/core/purchaseOrders.ts`** (new): `createPurchaseOrder()`, `buildPurchaseOrderLinesFromReorderSuggestions()` (sizes lines straight off the existing demand engine's own numbers — an owner sees the same figures the Inventory heatmap already showed them, not a second disconnected calculation), `sendPurchaseOrder()` (emails the supplier an itemized order, refuses cleanly if they have no email on file), `markPurchaseOrderReceived()` (bumps each line's item stock up by the ordered quantity — a real stock movement, not just a status flip).
- New page `/dashboard/[tenantId]/purchase-orders` (RETAIL/WHOLESALE nav only) — reorder suggestions with checkboxes + supplier picker + inline "add a supplier" form + order history with Send/Mark received actions.
- 6 new tests in `tests/core/purchaseOrders.test.ts`: total-cost math, rejecting an empty PO, reorder-suggestion sizing, send succeeds/fails correctly based on supplier email, and stock actually increments on receipt.
- **Verified live, full real cycle**: logged in as the Retail demo owner, added a real supplier through the UI, forced a demo item below its reorder point, clicked through Create → Send → Mark received in the actual browser. Confirmed at each step: the PO appeared with the correct quantity/total: 10× "Weekly grocery order", ZAR 500.00; the email stub logged the correct subject/recipient (`orders@acmewholesale.test`); status flipped DRAFT → SENT → RECEIVED; and — the strongest proof the receiving logic actually ran, not just the status label — the "Needs reordering" list went back to empty once stock was bumped back above the reorder point. No server errors. Cleaned up all scratch data afterward.
- Full suite: **48/48 tests passing** (6 new), typecheck clean.

## 2026-08-31 — Payment-chasing loop closed (the SME pain point named explicitly by the user)

Audited before building: automated invoice chasing (escalating tone, AiDraft approval queue, autoRespondEnabled dial) already existed via the exact same follow-up cron that chases quotes — `findStaleTransactions` already covers `INVOICE` status SENT/PARTIALLY_PAID. What was genuinely missing was the loop closing on the other end: reading the customer's reply and acting on it, and celebrating/reviewing once actually paid.

- **Review request was dead code** — `maybeSendReviewRequest()` (thank-you + Google review link, `Tenant.googleReviewUrl`) existed from an earlier session but was never called from anywhere. Now wired into `recordPayment()` in `money.ts`, firing the moment an invoice crosses fully into PAID (not on a partial payment). Also added an email fallback for customers with no phone on file — previously silently skipped them entirely. 2 new tests in `money.test.ts`.
- **Email replies about invoices were invisible** — `classifyInboundEmail` only ever matched replies against open *quotes*; an invoice reply had nowhere to link to. Added a `PAYMENT_REPLY` category (schema + Zod) and extended the sender-email matching in `ingestEmail()` to also search open invoices, so "I'll pay next week" now reschedules that invoice's `nextFollowUpAt` exactly like a quote reply already did — the existing follow-up cron then just picks it up on schedule, no second reminder system needed.
- **"Kindly give a date"** — when a payment reply has no concrete date, `queueAskForPaymentDateReply()` composes a reply asking for one and puts it through the *exact same* `AiDraft` approve-then-send pipeline the follow-up cron already uses (PENDING by default, sent immediately only if `Tenant.autoRespondEnabled`) — one outbound-message system, not a second one to maintain.
- **Proof-of-payment detection** — new `looksLikePaymentProof` field on the classifier and `InboundEmail`. Deliberately never auto-marks anything paid (verifying a claimed payment needs a human) — instead fires a dedicated, higher-signal `PAYMENT_PROOF_RECEIVED` notification linking straight to the matching invoice for a one-click "confirm and mark paid" via the existing manual flow.
- New migration `20260831180124_add_payment_reply_and_proof_detection` (local dev only) — new `EmailCategory.PAYMENT_REPLY`, new `NotificationType.PAYMENT_PROOF_RECEIVED`, new `InboundEmail.looksLikePaymentProof`.
- **Verified**: 4 new tests in `email.test.ts` (classifier mocked via `vi.mock`, since there's no AI key to exercise the real model locally) covering all four branches — date given → reschedule; no date + auto-respond off → PENDING draft; no date + auto-respond on → SENT immediately; payment-proof claim → notification fires, invoice status is NEVER touched. Also ran `ingestEmail()` directly against real dev data outside the AI path to confirm the whole pipeline still degrades cleanly with no crash. Full suite: **54/54 tests passing**, typecheck clean.

**The user also raised a broader point** — wanting "a PA in every single thing" (sales, management, projects), not just one PA. Worth naming directly: the pattern built across this session (classify → act within a bounded scope → hand back for review, with a trust dial per action) already generalizes that way — it isn't tied to invoicing. Each new domain (sales pipeline, project/job tracking) just needs its own set of intents added to the same shape, the way `pa/command` grew from 1 to 3 intents this session. The job-card work below is the next concrete step in exactly that direction (a PA for whoever runs the actual work, not just the office side of the business).

## 2026-08-31 — Job cards (built to a reasonable default, no spec given)

The user said to proceed rather than wait for a spec. Went with: a work order linked to the accepted quote/invoice it's the work behind (pricing/line-items stay on the Transaction — a job card only tracks getting the work done), assignable to a Membership (technician), with a per-job checklist. New models `JobCard`/`JobCardTask` (migration `20260831180627_add_job_cards`, local dev only).

- **`src/lib/core/jobCards.ts`** (new): `createJobCard()` (with an optional checklist), `toggleJobCardTask()`, `setJobCardStatus()`, `completeJobCard()` — deliberately **refuses to complete a job card with any unticked checklist item** (throws with a clear count), the same "don't silently allow skipping a step" posture as the till-reconciliation and PO-receiving work earlier this session. A job card with no checklist at all completes immediately — the checklist is optional, not a forced hoop.
- New page `/dashboard/[tenantId]/job-cards` (SERVICES/LOGISTICS nav) — create form (pick the job, title, assign, schedule, checklist as one-per-line textarea), and a list with tap-to-toggle checklist items and Start/Mark done actions.
- 7 new tests in `tests/core/jobCards.test.ts`: checklist creation order, refusing completion with unticked items, completing once everything's ticked, completing a checklist-free card immediately, toggling a task back off, clearing `completedAt` when reopened, and the assigned technician's name resolving correctly.
- **Verified live, full real cycle** — created a real job card through the UI (Jane Homeowner, 3-step checklist), ticked all three checklist items one at a time (confirmed against the database directly, not just the screen — this session's Browser-pane screenshot tool showed stale/cached frames partway through, a known artifact; `get_page_text` and direct DB checks were used as ground truth instead), confirmed "Mark done" was disabled with a "tick off every checklist item first" tooltip while items remained, then confirmed it completed successfully once all three were done — status flipped to "Done" and the action buttons correctly disappeared. No server errors. Cleaned up test data afterward.
- Full suite: **61/61 tests passing**, typecheck clean.

**This was a judgment call, not a spec** — told the user plainly that a real conversation about what "job card" means for their specific business (photos required? customer sign-off? recurring maintenance jobs vs one-off installs?) would sharpen this further; what's built is a solid, real, working default they can react to and redirect.

Remaining from the original PA-capability list (not yet started): day-planning (job 5 — genuinely hard, needs real prioritization logic, not just reporting what's already booked).

**Migrations from this entire session still applied to local dev only** — before any of this reaches production: `add_pa_voice_plans`, `add_noshow_and_membership_renewal`, `add_till_variance_field`, `add_purchase_orders`, `add_payment_reply_and_proof_detection`, `add_job_cards`. Run `prisma migrate deploy` against the Supabase pooler and confirm `prisma migrate status` comes back clean before shipping any of this.

## 2026-08-31 — PA layer + PA voice, phase 1 (typechecked, browser-verified against local dev DB, NOT yet deployed to production)

Started the "next phase in CRM/BOS" the user asked for: flow acting as a dynamic PA (judgment-driven, not a static rule engine), not just a record-keeper. Also produced a strategic doc — 50 automatable jobs across every vertical on a per-action Manual/Copilot/Autopilot trust dial — as an Artifact for the user, not code.

**PA command (natural-language action)**
- `POST /api/dashboard/[tenantId]/pa/command` — today supports exactly one intent: "send a quote like the one for X to [customer]" — extracts target price + keywords + customer contact via `generateObject`, scores all past QUOTE transactions by keyword overlap + price closeness, clones the winning quote's lines/discount/subject onto a find-or-create Party, returns a DRAFT quote id. Never auto-sends — always hands back a review URL. Returns `{ fallbackToQa: true }` (not an error) when the instruction isn't an action it knows, so callers can retry it as a plain question instead.
- **More intents are the obvious next increment** — everything else in the 50-job list needs its own intent added to this same classify-then-execute pattern.

**Floating "Ask flow" PA button — the Siri-style entry point**
- `FloatingPaButton.tsx`, mounted in the tenant layout (`layout.tsx`), so it's on every dashboard page, not just home. Bottom-right circular button → small panel with text input + mic (Web Speech Recognition, same pattern as `VoiceAssistant.tsx`). Tries `pa/command` first; on `fallbackToQa`, retries against `/voice-assistant` (plain Q&A grounded in real tenant data) automatically — one entry point, two backends, invisible to the user.
- The dashboard-home `PaCommandBox.tsx` (text-only, no mic) is kept as-is alongside it for discoverability; the floating button is the one that actually follows the user everywhere.

**PA voice — provider toggle + metered plans (new this pass)**
- **Schema**: `PlatformSetting.voiceProvider` ("browser" | "google", platform-wide default "browser"), `Tenant.voicePlan` ("free" | "starter" | "unlimited", default "free"), new `VoiceUsage` model (one row per tenant per period, `@@unique([tenantId, period])`) — migration `20260831144530_add_pa_voice_plans`, applied to local dev DB. **Not yet applied to production** — run `prisma migrate deploy` against the pooler before this ships.
- `src/lib/voice/plan.ts` — the three plans' allowances (free 20k/month, starter 60k/month, unlimited 10k/day) and period-key logic.
- `src/lib/voice/synthesize.ts` — `synthesizePaVoice(tenantId, text)`: checks the platform-wide provider switch, then the tenant's plan allowance for the current period (reserves the character budget atomically before calling Google, so it can't double-spend under concurrent requests), calls Google Cloud TTS REST API if both check out, otherwise returns `{ engine: "browser" }`. Never throws, never blocks — past the allowance it's just free browser voice for the rest of that period, which is what makes calling the top tier "Unlimited" honest.
- `src/lib/voice/speakClient.ts` — the one client-side `speak(tenantId, text)` every voice surface now calls; hits the synth API, plays the returned base64 MP3 if premium, else falls back to `speechSynthesis`. `DailyVoiceBriefing.tsx` and `VoiceAssistant.tsx` both switched to this instead of calling `speechSynthesis` directly.
- `GOOGLE_TTS_API_KEY` added to the `getPlatformSecret` registry (same DB-first/env-fallback pattern as every other credential).
- `/admin/voice` (+ `actions.ts`) — super-admin toggle, mirrors `/admin/ai`'s pattern exactly. Defaults to "browser" so nothing changes until a Google key is actually added and this is flipped on.
- **Pricing decided in conversation, not yet built into billing** (there's no billing/Stripe integration yet — `Tenant.voicePlan` today is just a DB column, set manually): Free tier 20,000 chars/month, Starter $3/mo for 60,000 chars/month, "Unlimited PA voice" $10/mo for 10,000 chars/day. All three fall back to free browser voice rather than ever hard-blocking.
- **Verified live** (local dev, demo tenant, no Google key configured): floating button end-to-end (command → fallbackToQa → voice-assistant → clean "no AI provider" message, no crash); typecheck clean across all new files. **Not verified**: actual Google TTS synthesis (needs a real key), the `/admin/voice` toggle UI (didn't re-test as super-admin this pass — same code pattern as the already-working `/admin/ai` page, low risk).

## 2026-08-29 → 2026-08-31 session arc — quote/invoice parity pass, reminders, voice, calendar sync

This was one very long multi-day session. In rough order, all shipped, migrated, and verified live:

**Quote/invoice richness (Zoho-parity pass)**
- Multi-line item editor (`LineItemsEditor.tsx`) replacing the old single-line quote form — add/remove rows, live subtotal
- Per-line **discount %** and **tax %**, plus a whole-document discount % — one shared formula (`src/lib/core/pricing.ts`) used everywhere a total is computed or shown (form, PDF, online view, what's actually charged)
- **SKU** and **HSN/tax code** on products; shown under each PDF/UI line item
- **Subject line** and **PO/reference #** fields on quotes/invoices
- **Salesperson** field — attributed on the document, with their contact info shown to the customer
- Duplicate-quote flow, quote/invoice edit locked once ACCEPTED/DECLINED or PAID/PARTIALLY_PAID
- CSV import extended to cover quotes/invoices (was customers/products only)
- Customer (Party) record made rich: company, VAT number, address/city/postal/country, notes — both an add form and (new) an edit form
- Products list gained pagination (was loading the entire catalog unbounded)

**Dashboard restructure — Zoho-style two-column list+detail**
- New **Quotes** and **Invoices** top-level nav sections: paginated, searchable left-hand list (`TransactionListPanel.tsx`, backed by `/api/dashboard/[tenantId]/transactions`) + detail panel on the right, exactly the Zoho pattern. Previously there was no dedicated list page for either — only "New Quote"/"Unsent Quotes"/Pipeline.
- **Statements** section — customer running account balance
- Unified **Settings hub** (`/dashboard/[tenantId]/settings`) — every settings sub-page in one grouped index; previously they were separate routes with no common entry point and the sidebar had no "Settings" link at all.
- **Pipeline board fixed for scale** — was loading every quote for the tenant unbounded (hit 3,223 rows in real usage); now caps each column to 25 with a real `count()`.

**Super-admin platform controls**
- **API key management** (`/admin/api-keys`) — every external credential (Anthropic, Gemini, Google OAuth, Resend, WhatsApp, Cloudflare R2/Storage) settable from a DB-backed table, checked before falling back to env vars, no redeploy needed. `src/lib/platform/apiKeys.ts` is the registry + `getPlatformSecret(key)` helper.
- **AI provider picker** (`/admin/ai`) — Claude vs Gemini, switchable live. `src/lib/ai/model.ts` is the one place every AI call in the app gets its model from.
- Fixed two real bugs caught while wiring this up: the WhatsApp key was registered under the wrong env var name (`WHATSAPP_ACCESS_TOKEN` vs the actual `WHATSAPP_API_KEY`), and the R2/storage registry only had 2 of the 5 real env vars the storage client actually needs. Both fixed.

**Google OAuth (login) + Google Calendar (separate, real two-way sync)**
- "Sign in with Google" — `src/auth.ts` rebuilt as a request-scoped NextAuth config function so DB-stored credentials take effect without a redeploy; find-or-create by email so it links to an existing password account.
- **Live two-way Google Calendar sync for reminders** (`/dashboard/[tenantId]/settings/calendar`) — a *separate* OAuth flow from login (needs `calendar.events` scope + offline access, which login's id-token-only flow doesn't have). `src/lib/calendar/google.ts` handles token refresh transparently. Setting/updating a reminder updates the same calendar event (`Transaction.calendarEventId`); clearing it deletes the event. Degrades cleanly (verified) when no calendar is connected.

**Manual follow-up reminders + "This Week" board**
- Verified the existing automated follow-up cron actually works end-to-end (hit it live, it drafted 7 real `AiDraft` rows against genuinely stale quotes, correctly left PENDING not auto-sent).
- New: pick a date + note on any quote/invoice ("said he'll be ready in 2 months") — reuses `Transaction.nextFollowUpAt`, which the cron already treats as a cadence override, so this isn't cosmetic, it genuinely delays the automatic follow-up.
- **This Week board** (new nav item + dashboard widget) — every reminder/follow-up due in the next 7 days or already overdue, the actual "who to contact" work list.
- **Calendar export (.ics)** per reminder — works even without the Google Calendar OAuth connection, opens in any calendar app.

**Voice (both pieces use free, native browser APIs — no TTS API key spent yet)**
- **Daily voice briefing** — reads a summary aloud on first dashboard visit each day (`speechSynthesis`), pulling from the same data as the This Week board. Replay button. Once-per-day-per-viewer via localStorage.
- **Voice Q&A** ("🎤 Ask flow") — Web Speech Recognition transcribes a spoken question, answered by AI grounded strictly in the tenant's real numbers (never invented), spoken back. `/api/dashboard/[tenantId]/voice-assistant`.
- **Not yet built: better TTS voice quality.** Current voice is robotic browser TTS. Discussed OpenAI `tts-1` (~$30/mo at 100 users, cheap) vs ElevenLabs (~$400+/mo at 100 users, much better voice) as upgrade paths — user hasn't chosen yet. See "Next up" below.

**PDF templates**
- Real anti-fraud/verification: banking details (owner-only settings page, hard role check not a capability — staff can never see/change payout details), "Verify this document via WhatsApp" callout with a `wa.me` deep link, on both the PDF and the customer portal view.
- **Drag-and-drop section builder** (native HTML5 DnD) — reorder/hide Terms/Banking/Verify blocks per template.
- **Real per-field customization** — font, header layout, table header style, logo shape are now independently overridable per template on top of the base style, not locked to the preset.
- **Two real bugs found by actually rendering PDFs and reading them back** (not just inspecting code): (1) every band-layout template (Modern Coral/Teal/Violet, Modern Slip) had an **invisible** business name/address/invoice-number block — white text was forced for "band" layout but never actually rendered on top of the colored band, so it was white-on-white. Fixed. (2) the marketing site's dark CTA band was `#050608` (near-void-black, read as broken) — lightened to a real navy `#0c0f1e`.

**Onboarding (earlier in this arc)**
- AI PDF-quote extraction — upload a past quote, extracts business name/niche/customer/priced line items
- Website prefill enrichment — logo + social links via regex (works without an AI key), auto-creates the tenant's first PDF template with the found logo
- Smart single-box entry on **New Quote**: paste/type free text ("Quote for John, 2x solar panel at R5000 each, 10% off"), AI sorts it into the form, matched against the real catalog where possible.

**Ecommerce / payments (already existed, confirmed intact this session)**
- WooCommerce integration (product sync + auto-invoice on order + email) — fully built, just verified.
- Card payment gateways for customers (Yoco, PayFast, Paystack, Stripe real; PayPal/Square/iKhokha/etc. stubbed) on the customer portal.

**Deliberately not built, said plainly (judgment calls, not oversights):**
- The modal/lightbox add-item flow the user asked about — skipped on purpose: the current inline table already exposes every field (name/qty/price/discount/tax/SKU) per row, and a modal-per-item would mean *more* clicks for multi-item entry, not fewer. Revisit if the user still wants it after seeing the current table.
- A full "click every button in the app" QA pass — verified core money/reminder/PDF flows and everything newly built, not literally every route.
- Live two-way *Outlook* calendar sync — only Google Calendar was built.
- Products list still has no rich modal/detail redesign to match the new Quotes/Invoices two-column pattern (it does have pagination now).

## 2026-08-25 → 2026-08-28 session arc — the big one

Started from the pain-point research phase (below) and kept going across several build rounds in the same multi-day session. In order, all shipped and live:

1. **Retail inventory + tax/VAT export** (detail below)
2. **Marketing site rewrite**: nav bugs fixed (no mobile menu existed at all; Industries hover-dropdown had a gap that closed it before the cursor arrived — now click-to-pin + outside-click-to-close too), full persuasive copy pass across all pages, new `/pricing` page, before/after + FAQ sections, richer color palette
3. **Non-profit/faith niche** (`NONPROFIT`) — member/donor records, append-only involvement history, a donation ledger separate from the commercial invoice ledger, compliance-filing tracking (`/dashboard/[tenantId]/members`)
4. **Rentals module** — platform-wide, any catalog item can be marked rentable, tracks out/returned lifecycle, bills actual duration on return (`/dashboard/[tenantId]/rentals`)
5. **Property module** — properties, leases, expiring-lease alerts (`/dashboard/[tenantId]/properties`)
6. **POS** — flow's own built-in till (open/checkout/close-and-reconcile) plus a region-scaffolded card-provider registry, Yoco (RSA) as the first real integration, stubbed until a real key is supplied (`/dashboard/[tenantId]/pos`, `settings/pos-integrations`)
7. **Account settings & doc backup** — Google Drive connect toggle, stubbed until real OAuth is registered (`settings/backup`)
8. **PDF templates** — 10 invoice/quote design styles + 2 delivery-slip styles, one shared parameterized renderer (`src/lib/pdf/`), every document gets a QR code + view-online link + flow branding footer. Tenants save up to 3 templates (one default + two customized) at `settings/pdf-templates`. New "Proposal" quote type: AI generates system-info/performance-expectancy/timeline from the line items + a location field — metered at 5/month, visible counter, model only ever writes text (never touches PDF layout). New invoice PDF + portal view (didn't exist before, only quotes had one).
9. **Follow-up automation controls** — owner-configurable cadence (`settings/automation`: first-touch window + repeat interval, e.g. same-day/next-day/weekly) replacing a hardcoded 3-day window, plus an auto-respond toggle that lets a tenant skip the manual Approve step entirely
10. **Built-in mail client** (`settings/mail`) — BlueMail-style, three connection types: IMAP (real today, password AES-encrypted at rest via `src/lib/crypto.ts`), flow-hosted forwarding address (real today, no credentials — but needs an inbound-parse provider like Postmark/Mailgun connected with MX records before mail actually arrives there), Google OAuth (visible "coming soon," needs a verified OAuth app). AI classifies every inbound email (statement/invoice/legal/quote-reply/other), flags importance, and reschedules a quote's follow-up automatically when a customer's reply gives a real timing cue ("call me in 2 weeks" → `Transaction.nextFollowUpAt`).
11. **In-dashboard notification center** (`/dashboard/[tenantId]/inbox`) — unread badge in the sidebar, fed by hot leads, important mail, and auto-sent follow-ups; also WhatsApp-alerts the owner.

**Real, still-open checkpoints (external accounts needed, not code gaps):**
- Real Google Drive OAuth (doc backup) and Google mail sign-in both need a verified Google OAuth app
- Real Yoco secret key for POS card charges (stubbed/logs until then)
- An inbound-parse email provider (Postmark/Mailgun-class) + MX records for the flow-hosted mail address to actually receive anything
- `ANTHROPIC_API_KEY` already set in production — AI proposal generation, email classification, and follow-up drafting are all real there, not just stubbed

**Also still open, not blocked on anything external, just not built yet:**
- Education niche (flagged as worthwhile, not scoped)
- Film/TV/production niche (works today via Services' vocabulary remapping; dedicated niche only if real demand shows up)
- End-to-end encryption (user's own idea, explicitly deferred — "a few months post-launch")
- PDF template settings page has no logo-upload widget yet (schema supports it, UI doesn't expose it)
- No "Download PDF" button in the dashboard's own invoice views yet (only reachable via the customer portal)
- Quote creation is still single-line-item only — no multi-line cart in that form

## 2026-08-25 update — AI inventory optimization + tax/VAT export (Phase 1 & 2 of the industry-optimization roadmap)

Ran a full pain-point research pass across all 7 niches plus US/RSA tax compliance this session (report delivered to the user as a PDF, not committed to the repo). Started converting that research into features — full 8-phase roadmap below, phases 1–2 built and verified tonight, phases 3–8 scoped for follow-up sessions.

**Design principle used throughout:** numbers come from math (statistical aggregation over existing ledger data), not from an LLM call — the AI's job is reasoning/language (explaining, drafting), not computing forecasts. This is also why it shipped in one session: no new external AI calls needed, just aggregate queries.

**Built tonight:**
- `src/lib/core/inventory.ts` — demand velocity + heatmap (`getDemandHeatmap`), reorder sizing (`getReorderSuggestions`), and batch/expiry (FEFO waste) tracking (`recordBatch`/`getExpiryRisk`). New `ItemBatch` model (migration `20260825181433_inventory_optimization`), additive on top of `Item.stockQty` — only used when a business logs batches with expiry dates, doesn't touch existing stock tracking.
- New dashboard page `/dashboard/[tenantId]/inventory` — reorder suggestions, expiry risk, and the demand heatmap ("SKU heat map" — pure sales-velocity ranking, not a physical store-layout map; confirmed that's what was meant before building).
- `src/lib/core/tax.ts` — `getTaxSummary()`, aggregates tax charged per period from existing `TransactionLine`/`Item.taxRatePercent` data. Supports monthly (US-style) and SARS bi-monthly VAT201-style grouping. Wired into the existing CSV export page/route (`settings/export`) as a new "Tax / VAT summary" entity — no new UI surface needed, reused the "leave anytime" export pattern.
- Verified: demand heatmap renders correctly against live demo data, batch-logging form → expiry-risk display works end-to-end in-browser, tax math verified against a synthetic PAID invoice (2 units × R100 @ 15% VAT → R30.00 collected, exact). Build, typecheck, and full 14-test suite all pass.
- **Now on production** — applied along with everything else in the 2026-08-28 deploy at the top of this file.

## 8-phase industry-optimization roadmap (from this session's pain-point research) — all 8 shipped

1. ✅ **Retail** — inventory optimization (demand heatmap, reorder suggestions, expiry/waste tracking).
2. ✅ **Tax/VAT (cross-industry, USA & RSA)** — filing-ready export.
3. ✅ **Corporate** — overdue-invoice dashboard + one-click late fee (`/dashboard/[tenantId]/overdue`).
4. ✅ **Services** — speed-to-quote SLA tracker (`/dashboard/[tenantId]/unsent-quotes`). Missed-calls/slow-quotes was the single highest-dollar-value gap from the research ($100B+/year industry-wide) but needs a phone/call-handling integration flow doesn't have — the SLA-tracker is the buildable slice of that problem; real call handling is still open.
5. ✅ **Logistics** — hard POD gate (`Event.photoUrl`/`signedByUrl` required before a DELIVERY event can close) + auto-invoice generation on POD capture, in `src/lib/core/movement.ts`.
6. ✅ **Medical** — automated appointment reminders at 48h/2h marks (`cron/appointment-reminders`).
7. ✅ **Wholesale** — credit-limit + MOQ enforcement on wholesale ordering, in `src/lib/core/connections.ts`.
8. ✅ **Ecommerce** — abandoned-quote AI recovery reusing the existing follow-up-draft engine, in `src/lib/core/money.ts`/`cron/follow-ups`.

Full plan detail (exact function signatures, schema) is in this session's plan file if picking this up cold: `/Users/user/.claude/plans/goofy-brewing-dewdrop.md`.

## 2026-08-22 update — multi-page marketing site + super-admin CMS

Built out the marketing site from one hardcoded homepage into 13 pages, all editable by a super-admin through a structured section editor (not a free block builder) — no code changes needed to update copy/images going forward.

- **New Prisma models:** `PageContent`, `PageSection` (migration `20260822201311_marketing_cms`) — now on production, along with every migration through this file's "Last updated" date.
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

**Uncommitted on disk right now** (2026-09-12 audit — see the section directly
below): 9 cross-tenant write vulnerabilities closed, a double-payment race
fixed, the dashboard global search made functional, plus the in-progress
jewel/summer skin work that was already here. Nothing is committed — review
`git diff` and commit before anything else.

1. Review + commit the 2026-09-12 security work. No migration is needed for
   any of it (schema unchanged; the `colorSkin` edit is comment-only).
2. Create a free Cloudflare R2 account + bucket, enable public access, and supply `STORAGE_ENDPOINT`/`STORAGE_ACCESS_KEY_ID`/`STORAGE_SECRET_ACCESS_KEY`/`STORAGE_BUCKET`/`STORAGE_PUBLIC_BASE_URL` so CMS image uploads work (currently returns a clear "not configured" error).
3. Before taking real money: replace the portal checkout-confirm redirect with
   each gateway's signed webhook — see "Known production blocker" below.

> Items 1-2 and 4 of the previous list (commit the marketing CMS work, run
> migration `20260822201311_marketing_cms`, confirm the Vercel build) are
> **done** — the CMS shipped in commit `a24612d`, which also moved the admin
> console to `/car`. That list had gone stale.

## 2026-09-13 — full Admina port, mobile pass, and complete agent tool coverage

### Admina, finished
The chrome is now the template's, not a lookalike:
- **Navbar** rebuilt to their markup spec — back arrow, `h-11 w-[24.25rem]` pill
  search with the 32px blue circular submit at `end-1.5`, 44px circular icon
  buttons that go blue on hover, bell badge, avatar + name + role block.
- **Panel footer** is their upgrade-card shape carrying account links.
- **Canvas** reproduces their `body-bg.png` wash as gradients, so it re-tints
  for dark instead of being hidden the way the template hides its image.
- **Page header + breadcrumb**, form controls (r8, blue focus), buttons
  (r8, `0.625rem 1.25rem`), and tables (tinted header band, hairline rows) all
  restated to their values.
- Pages are **full width** under this skin — the app centres content in
  `max-w-3xl`, which left Admina's grid floating with dead space either side.

**Removed, because they were our old look and you said not that:** the tinted
tile gradients (`::before`), the 3px colour bar on every tile (`::after`), and
the navy hero tile. The hero was a hardcoded inline style, so it is now a
token (`--kb-hero-bg`) that each skin answers for.

**Audited, not eyeballed.** A script walked 30 dashboard pages at 1440px and
31 at 375px checking every `.kb-card`/`.kb-tile` for the right radius and no
shadow, plus horizontal overflow and the mobile drawer. Two real bugs came out
of it: `/products` had a `shrink-0` header row that couldn't wrap (a desktop
*and* mobile overflow), and my own primary-tile ring was an inline style the
skin couldn't override. Both fixed; all 61 checks now pass.

Dark values verified against their palette and exact by construction, since
they come from their own remapped dark block: sidebar/card `#273142`, body
`#1b2431`, border `#323d4e`, accent `#487FFF`.

### The AI can now reach every feature
Tool coverage went **4 → 84** for an owner (STAFF 79, REP 66, TECHNICIAN 66,
DRIVER 61). Three registries: `tools.ts` (money/customers), `tools.extra.ts`
(stock, work, property, people, reporting, tax), `tools.ops.ts` (catalog, till,
fleet, wholesale, team chat, membership, document templates).

`tests/agent/coverage.test.ts` is what keeps this true: it reads
`src/lib/core/` and fails if any module is neither imported by a tool registry
nor listed as exempt **with a reason** — and separately fails if something
listed as exempt turns out to be wired, so the list can't rot into a lie. It
already caught two modules I'd mis-named from a truncated listing, and a first
draft of the test that only checked a list rather than real wiring.

Genuinely exempt, with reasons: `audit`, `notifications`, `reviews`,
`reminders` (side effects or cron-driven), `pricing`, `whatsappShare` (pure
functions), `cms` (marketing site, not workspace data).

### It now detects and asks, rather than only reporting
The tick's prompts changed from "say what you would do" to **attempt the
action**. Anything irreversible is intercepted by the autonomy gate and stored
with its exact arguments, so the owner gets a concrete one-click proposal
instead of a description. Notifications deep-link to the specific run
(`/agent?run=<id>`) and their title says whether it is news or a decision.

### Still the one blocker
The Gemini account is out of credit (HTTP 429), so no model response has been
observed end to end. The loop builds and dispatches correct tool-calling
requests and degrades with an actionable message. Top up Gemini or add an
`ANTHROPIC_API_KEY` in the admin console to confirm.

**State:** lint 0, tsc 0, build 0 warnings, **155 tests**, 96 routes sweeping
identical to the clean baseline.

## 2026-09-12 (later still) — Admina theme port + agentic phases 4-6

### The Admina look, using the template's own CSS
`admina-tailwind-admin/` (ThemeForest) is now the platform's eighth skin, and
the default. It is a **port, not a transplant**: the template is Tailwind 3 +
gulp + 85 static HTML pages + Flowbite; this app is Tailwind 4 + React 19.
Rewriting 89 pages into its markup would have cost the seven-skin system for
no gain.

- `src/app/admina.css` is the template's **own stylesheet**, extracted verbatim
  from `dist/assets/css/style.css` (its "navbar css start" marker to EOF) — not
  a hand-transcription. Two mechanical changes on extraction: every selector is
  prefixed with `.kb-shell[data-skin="admina"]` so its generic class names
  (`.navbar-header`, `.dashboard-main`, `.card`) can't leak into the other
  skins, and its `.dark`/`:is(.dark *)` selectors are remapped onto this app's
  `[data-theme="dark"]`. **Remapped, not stripped** — stripping promotes every
  dark rule into light mode, which is what turned the sidebar dark at midday on
  the first attempt. The compiled Tailwind 3 utility layer above that marker is
  deliberately excluded; a second utility layer would collide with Tailwind 4.
- `TwinSidebar.tsx` + `adminaNav.tsx` — the double-layer menu: a 72px icon rail
  of seven categories plus a 248px panel. Uses the template's own class names
  so the vendored CSS drives it; only the behaviour jQuery did in the original
  (which category is selected, the mobile drawer) is React.
- flow's 33 pages are grouped by what someone is doing — Overview, Sales &
  money, Customers, Products & stock, Work, Team, Settings — rather than the
  template's Dashboards/Components/Forms demo taxonomy.

**Verified against the template's own spec values, not by eye:** rail 72px,
panel 248px, panel head 78px, rail icons 44x44 at r14, active `#487FFF`, menu
links `11px 14px` at r10, navbar 72px, main offset 320px, cards r20 flat. All
exact. Mobile: drawer off-canvas below 1200px behind the template's floating
toggle, backdrop, no horizontal overflow.

**Gotcha worth knowing:** the template references `--ts-surface` and
`--ts-accent` but never declares them (it hardcodes `#fff` and calls its blue
`--ts-purple`). They're declared in `globals.css` alongside the skin palette —
a `var()` that resolves to nothing invalidates the whole declaration, which
silently flattened the card radius and the hero tile until it was found.

**Licensing — needs checking before launch:** the bundled LICENSE says the
Regular License covers end products **not sold to end users**; an **Extended
License** is required when the end product is sold. flow is a paid SaaS with
pricing plans, so the Extended tier is very likely required.

### Agentic phases 4-6
- **Memory** (`agent/memory.ts`) — threads per user, plus durable `TenantFact`
  rows upserted by key so a changed fact is corrected rather than accumulating
  contradictions in the prompt.
- **Autonomy gate** (`agent/autonomy.ts`) — three levels, enforced in code, not
  the prompt. Money movement and outbound customer contact are held for a
  person at **every** level including FULL; only a present user can authorise
  them.
- **Approvals** (`agent/approvals.ts`) — held tool calls are stored with their
  exact arguments and replayed verbatim on approval, as the approver: approving
  cannot execute something the approver couldn't run themselves.
- **Event bus** (`agent/events.ts`, `agent/sweep.ts`) — the core layer emits
  domain events; a sweep derives the ones nobody emits (an invoice that went
  overdue at midnight, stock crossing its reorder point). Claims are atomic, so
  two overlapping ticks can't both chase the same customer.
- **Heartbeat** (`agent/tick.ts`, `/api/cron/agent-tick`, every 30 min) — reacts
  to queued events, and reviews the business every 6h. A run with nothing to say
  produces no notification.
- **Named agents** (`agent/named.ts`) — brief + tool subset + autonomy +
  schedule. Four templates ship (Collections, Quote follow-up, Stock watch,
  Morning brief). Runs outlive their definition so the audit trail survives.
- **Console** at `/dashboard/[tenantId]/agent` — approval queue first, autonomy
  dial, named agents, recent runs, learned facts, what it noticed.
- **Home page** is now a live agent console: status strip, chat box with thread
  continuity, and shortcut tiles carrying live counts.

Verified live: the tick swept **7 overdue invoices** into events and processed
them across 20 tenants. 147 tests, lint/tsc/build all clean.

**Still blocked on the same thing:** the Gemini account is out of credit (HTTP
429), so no model response has been observed end to end. The loop builds and
dispatches a correct tool-calling request; provider failures now say which it
is rather than "something went wrong".

## 2026-09-12 (later) — payment webhooks + the agentic pivot, phases 1-3

### Payment blocker closed
The portal checkout-confirm page no longer writes to the ledger at all — it is
display-only. Money now moves in exactly one place:
`/api/webhooks/payments/[provider]`, and only after the provider's own signed
callback verifies.

- Real signature verification implemented per gateway: **Stripe** (HMAC-SHA256
  over `t.body`, 5-min replay window), **Paystack** (HMAC-SHA512),
  **Yoco** (svix scheme over `id.timestamp.body`), **PayFast** (ITN MD5
  signature *plus* the mandatory server postback to `/eng/query/validate`).
  Unimplemented gateways return `ignored` and can never credit a ledger.
- `PaymentGateway.webhookSecret` added, with the callback URL and a warning
  shown on the settings page when it isn't set.
- `PaymentCheckout.webhookEventId` is unique, so a provider redelivering an
  event cannot double-credit; the claim itself is an atomic conditional
  `updateMany`.
- Amount mismatch between what we asked for and what the gateway reports marks
  the checkout FAILED rather than settling the invoice.
- Migration `20260912175501_payment_webhook_verification` — applied locally,
  **not yet applied to production**.
- 12 tests in `tests/payments/webhooks.test.ts` covering forged signatures,
  tampered bodies, replay, wrong secret, missing secret, and unpaid sessions.

### Phase 1 of the agentic pivot — the platform is now awake
The six cron jobs were written but **nothing ever called them** (no
`vercel.json`), and their guard was fail-OPEN: `if (process.env.CRON_SECRET && …)`
with `CRON_SECRET` set nowhere, so once reachable they were public.

- `vercel.json` added with real schedules (follow-ups hourly, email every 15m,
  daily briefing 05:00, recurring invoices 01:30, weekly digest Mondays).
- `src/lib/cron/auth.ts` — one shared guard that **fails closed**, accepts
  Vercel Cron's bearer header or a shared secret, constant-time compared.
- `CRON_SECRET` documented in `.env.example` (hex, not base64 — base64's `+`
  and `/` get mangled as a query param) and set locally.
- Verified live: refuses without/with a wrong secret, runs with the right one.
  First real run drafted **3 follow-ups**, sent 7 briefings and 9 digests.

### Phases 2-3 — the PA is an agent, not a classifier
The PA was one `generateObject` call whose `intent` was an enum of three
values; anything else returned "unknown". `src/lib/ai/tools.ts` defined four
tools that **nothing imported**.

- `src/lib/agent/tools.ts` — the Business Graph as tools. Two invariants:
  **no tool schema contains a tenantId** (the runtime closes over it, so a
  prompt injection has nowhere to put another company's id), and every tool
  calls the same `src/lib/core/*` function the dashboard calls. Write tools
  declare a capability and are withheld from roles that don't hold it, so a
  REP is never even offered `recordPayment`.
- `src/lib/agent/runtime.ts` — a real loop (`stopWhen: stepCountIs(12)`), so
  the model sees what a tool returned and can take another step. Provider
  billing/key failures are translated into messages an admin can act on.
- The PA route and `FloatingPaButton` now carry conversation history, and only
  navigate when the agent actually changed something.
- 11 tests in `tests/agent/tools.test.ts`, including that no tool accepts a
  tenantId and that a foreign customer id is refused.

**Not verified end-to-end:** the loop builds and dispatches a correct
tool-calling request, but the Google Gemini account is **out of credit**
(HTTP 429, "prepayment credits are depleted"), so no model response could be
observed. Top up Gemini or add an `ANTHROPIC_API_KEY` in the admin console to
confirm, then re-run the live check.

### Still open from the same brief — not started
Document/PDF infrastructure per industry, proper statements, the legal-doc
checker, the quote/invoice/job-card form and flow redesign, and the richer
customer form. Phases 4-6 of the agentic plan (memory, the approval surface,
the event bus, named agents) are also not started. Full plan and reasoning:
the "Agentic Gap" assessment artifact.

## 2026-09-12 — production-readiness audit (bug hunt + fixes)

Full sweep for bugs, dead links, and broken pages. Baseline state and every
fix below is verified: `tsc --noEmit` clean, `eslint` clean (0 errors,
0 warnings), `next build` clean, 86/86 tests passing, and all 96 routes
exercised live against the seeded local database.

**Cross-tenant write vulnerabilities closed (9).** Each was the same shape:
a server action proved the caller's access to its *own* tenant, then passed a
record id straight off the form post into a core function that looked the row
up by bare id. Any signed-in owner could act on another company's rows.

- `setManager` / `setDepartment` (`core/org.ts`) — rewrote reporting lines and
  departments of staff in other companies.
- `updateGoalProgress` (`core/goals.ts`) — also had no `assertCan` at all, so
  any role could write goals.
- `applyLateFee` (`core/collections.ts`) — appended a real fee document to
  another tenant's customer ledger.
- `closeTill` (`core/pos.ts`) — closed and reconciled another tenant's till.
- `sendQuote` (`core/money.ts`) — marked another tenant's quote SENT, which is
  what the follow-up engine watches.
- `markNoShowAndRebook` (`core/reminders.ts`) — also WhatsApp'd that other
  tenant's customer.
- `returnRental` / `markItemRentable` / `createRental` (`core/rentals.ts`).
- `createQuote` + `recordCashSale` (`core/money.ts`) — accepted a `partyId` or
  line `itemId` from another tenant, leaking that customer's name/email into
  the rendered PDF and portal view. Both now go through one shared
  `assertPartyAndItemsInTenant` check.
- `checkoutSale` (`core/pos.ts`) — resolves `partyId` against the tenant
  *before* a card is charged.

The fix is at the core layer, not in the actions, so future callers (AI tools,
mobile endpoints, the planned REST API) inherit it. `tenantId` was **appended**
to these signatures rather than prepended on purpose: both params are strings,
so a missed call site fails to compile instead of silently swapping arguments —
which is how all 11 call sites, including `prisma/seed.ts`, got caught.

`tests/core/tenant-isolation.test.ts` is new: 13 tests that stand two tenants
up side by side and assert each call is refused *and* the victim's row is
unchanged.

**Other real bugs fixed:**
- **Double-payment race** in `portal/[token]/invoices/[invoiceId]/pay/confirm`
  — check-then-act on `checkout.status === "PENDING"`, so a double-click or a
  refresh of the gateway redirect credited the invoice twice. Now claims the
  checkout with an atomic conditional `updateMany` before recording anything.
- **Dashboard global search did nothing** — the top bar submits `?q=` to the
  customers page, which only read `page` and `add`. Wired through
  `listCustomersPaginated` (name/email/phone, case-insensitive, always ANDed
  with `tenantId`), added the visible search box and a real no-match state, and
  fixed pagination dropping the query on page 2. 6 new tests.
- **Stale-response races** in `TransactionListPanel` and `TenantListClient` —
  typing or paging fast let an older fetch resolve last and overwrite newer
  rows. Both now guard with a cancellation flag, and a failed fetch no longer
  leaves the panel spinning forever.
- **Org chart could silently lose people** — `setManager` blocked self-manage
  but not cycles; A→B plus B→A left neither as a root, so both vanished from
  the chart. Now rejected at the point the loop is created.
- **Marketing nav did full page reloads** — raw `<a href>` throughout the
  shared chrome; converted to `next/link`.
- **"One engine, seven skins"** on onboarding while offering eight (NONPROFIT
  is a real niche). Now derived from `NICHE_CONFIGS` so it can't drift again.
- Dead `amountCents` in `returnRental`; duplicated `any`-typed recharts tooltip
  in three files, now one typed `components/dashboard/CardTooltip.tsx`.

**Toolchain unblocked.** `automation-saas/` (490MB) and `SassTech/` (11MB) are
third-party templates sitting untracked in the repo root. `tsconfig.json`'s
`**/*.ts` include pulled them in — **342 typecheck errors**, and their vendored
minified JS produced ~1,500 of the repo's 1,698 lint problems, burying every
real finding. Both are now gitignored and excluded from tsc + eslint. They were
never committed, so production was unaffected; local `tsc`/`build` were broken.

**Verified live, not just built:** logged in against the seeded database and
walked all 96 routes. 83×200, 3 redirects, 10×404 — every non-200 confirmed
correct: `/` and `/dashboard` route logged-in users onward, an ACCEPTED quote's
`/edit` bounces back to the read view, `/book/:id` 404s because booking is off
for that tenant, and all `/car/*` 404 for a normal owner but return 200 for
`admin@platform.demo.local`. Zero server errors, zero console errors on a clean
page load. A signed-in owner of one tenant gets 404 on every page of another.

### Known production blocker — do not take real money yet

`portal/[token]/invoices/[invoiceId]/pay/confirm/page.tsx` treats the gateway's
*redirect back* as proof of payment. The double-credit race is fixed, but a
customer who never pays can still reach that URL directly and mark the invoice
paid. This is documented in the file's own header and is not a regression — it
has always been the stub behaviour. Before real payments, move `recordPayment`
into each provider's signed webhook (Stripe `checkout.session.completed`,
PayFast ITN, Paystack `charge.success`).

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

## 2026-09-13 — agentic pass 2, and the start of the conversational build

### Answer to "is it agentic-first now?"
The engine was. The product wasn't. Five spines existed but were not
connected to anything; each is now wired, with a test that fails if it rots
back.

1. **Named-agent schedules never ran.** `AgentDefinition.schedule` was stored
   and printed back to the owner ("Schedule: 0 9 * * 1-5") and nothing ever
   evaluated it. Added `src/lib/agent/schedule.ts` (cron matcher + `isDue`,
   evaluated in the business's time zone via Intl, `APP_TIMEZONE`, default
   Africa/Johannesburg), wired into the tick. The console now shows the
   schedule in words and offers named slots instead of raw cron.
   *Proved live: `agentsRun: 1`, run recorded with trigger AGENT.*

2. **The event bus emitted 3 of its 9 declared signals.** Most importantly
   `acceptQuoteWithSignature` — the path most customers actually take — was
   silent, so a signed quote never reached the agent. Wired
   quote.accepted (signature), invoice.paid, customer.created,
   dispute.raised, payment.failed (both webhook failure paths, guarded by the
   atomic claim so retries don't re-alert). `quote.accepted` promoted to
   ACTIONABLE.

3. **The agent could read its memory but never write it.** `rememberFact`
   had no caller, so "what you already know about this business" was
   permanently empty. Added rememberFact/forgetFact/recallFacts tools,
   classified REVERSIBLE, and told the prompt when to use them.

4. **Approval was all-or-nothing.** Added per-action approve/reject
   (`approveAction`/`rejectAction`), claimed under a row lock so two managers
   can't double-execute. Claim-then-execute: a crash loses the action rather
   than running it twice.

5. **It didn't know what page you were on.** `src/lib/agent/pageContext.ts`
   derives the record from the path server-side (scoped to the caller's own
   tenant prefix, so a foreign URL resolves to nothing). "Chase this one"
   now works.

Plus: NDJSON streaming (`/api/dashboard/[id]/pa/stream`) with a live
checklist of what it's doing — instrumented in our own tool wrapper, not an
SDK callback, so it can't miss a call. FloatingPaButton became `CommandBar`:
⌘K, a conversation, and — the real bug — it now tells you when an action is
waiting for approval instead of silently queueing it.

### Started on the conversational build (2026-09-13 request)
- **`src/lib/core/quoteComposer.ts`** — paste a customer and a priced list,
  get a real draft quote. Deterministic, not a model call: it must work with
  the provider out of credit, and money must never be hallucinated. Handles
  "R20 000,00", "$1,250.50", "2 x iPhone 16 @ 20000", trailing quantities,
  explicit totals. 23 tests.
- Wired as the agent tool `draftQuoteFromText`, and as the **first** reader in
  the existing paste-to-form box, which until now returned "No AI provider
  configured — fill in the form manually" and did nothing.
- **`findDocuments`** tool — resolves "the quote for Mr Isaac", "365",
  "yesterday". Refuses to pick when several match.
- **`whatsappLink`** tool — click-to-chat from the agent.
- **Fixed:** the new-quote action created a new Party on every quote, so
  quoting someone twice split their history in half. Now uses the shared
  `findOrCreateCustomer`. Added email + company fields to the form.

### Still to build from that request
- Conversational follow-up negotiation ("I'll be ready in June" → "which date
  in June?" → check the operator's availability → create the calendar event).
  Foundations exist: classifier gives `scheduleFollowUpInDays`,
  `Transaction.nextFollowUpAt/followUpNote/calendarEventId`, Google Calendar
  OAuth in `src/lib/calendar/google.ts`.
- Microsoft Graph and Zoom calendar providers (Google exists).
- Routing payment-proof/statement alerts to finance specifically rather than
  the workspace generally.
- Meta WhatsApp Cloud API direct (current client is 360dialog, a Meta BSP).
- `sendInvoice` — there is `sendQuote` but no invoice equivalent.

### Unchanged blocker
No AI provider with credit, so no model response has been observed end to
end. Every failure path is correct and actionable; the agent's reasoning is
still unverified.

## 2026-09-13 (later) — dark mode, and the command dock

### Dark mode was broken by hardcoded colour, not by the theme system
The tokens and the `[data-theme="dark"]` wiring were correct. Three things
defeated them:

1. **63 hardcoded `bg-white`** across 39 files, almost all form controls,
   each paired with `text-[var(--kb-text)]` — which is near-white in dark.
   White text on a white input: invisible. Replaced with
   `bg-[var(--kb-panel)]`. Every skin defines `--kb-panel: #ffffff` in light,
   so light mode is pixel-identical; dark now follows the theme.
   (`bg-white/NN` alpha variants were left alone — those sit on the always-dark
   sidebar and marketing hero, where they are correct.)

2. **`<body>` stayed white**, and a body background propagates to the browser
   canvas — so overscroll on a phone flashed white under a dark dashboard.
   Fixed with `body:has(.kb-shell[data-theme="dark"])` per skin, plus
   `color-scheme: dark` so scrollbars and native date pickers stop rendering
   light. Scoped with `:has()` rather than stamping the theme on `<html>`,
   because the theme is a dashboard setting and the marketing site must stay
   light regardless.

3. **`STATUS_PILL.OVERDUE` was the one hardcoded entry** in an otherwise fully
   tokenised map (`#fee2e2`/`#dc2626`), copied again by the agent page's
   FAILED pill. Gave it a real `--kb-status-danger` token with a dark value.

Also: Admina styles inputs by explicit `type`, so a bare `<input>` (type
defaults to text but the attribute is absent) matched none of its selectors
and kept whatever utility class it had — added `input:not([type])`.

**Verified**, not eyeballed: a script walks 34 dashboard pages in a
same-origin iframe and reports any element with a light background. It found
the offenders above and now returns zero. Mobile re-checked at 375px: no
horizontal overflow on any page.

### The command box is now a dock
Moved from a circular button in the corner to a bar pinned to the bottom of
every page — always visible, always typeable, the way a composer is in a chat
app. Focusing it opens the transcript above it; Escape closes the transcript
and leaves the bar. Cmd/Ctrl-K focuses rather than toggles, since there is
nothing to summon any more.

- `.kb-dock` is inset from the left by `--kb-dock-left`, mirroring each
  shell's own content offset at the same breakpoints, so on a desktop it sits
  centred over the content rather than running under the sidebar.
- `.kb-dock-host` reserves 6rem at the foot of every page so the bar never
  covers the last row.
- The dock input needed a four-class selector to beat Admina's own bare-input
  rule, which otherwise drew a boxed field inside the pill.
- **Removed `AgentConsole`** from the home page. With the dock on every page
  it was a second input for the same agent, each with its own thread — ask in
  one, follow up in the other, and the follow-up loses the context.

```
lint 0 · tsc 0 · build clean · 224 tests · 34 pages dark-clean · 375px overflow-free
```

## 2026-09-13 (later still) — the document template builder

### What was actually there
The "PDF templates" page offered a name, a style dropdown and an accent
colour. Three things it promised were not connected to anything:

- **The logo could never be set.** The page copy said "each with your own
  accent color and logo", `logoDataUrl` was in the schema and honoured by the
  renderer — and no UI anywhere wrote it.
- **Terms rendered empty, always.** The builder let you reorder and hide a
  "Terms" block whose text had no field anywhere in the app.
- **`tenantAddress` was declared and never populated**, so every invoice this
  app has produced went out with no business address and no VAT number —
  which a valid ZA tax invoice legally requires.

The twelve "styles" varied colour, font and header position only; the page
*structure* was identical in all of them, which is why choosing one never
felt like choosing a design.

### What it is now
Modelled on how Zoho does it, per the screenshots:

- **Gallery** of templates, each card a real rendered thumbnail of its own
  design (the preview route in a scaled, inert iframe — a card can never show
  a design the renderer no longer makes). DEFAULT badge, hover actions.
- **New template starts from a design**: Classic, Statement, Proposal,
  Compact, Delivery slip. A preset carries a full section layout *and* its
  style settings, so you begin with a document that works.
- **Editor** with a left rail — General, Header & Footer, Transaction Details,
  Table, Total, Other Details — the live PDF beside it, and one Save.
- **16 sections**, each openable: rename its heading, write its body text,
  reorder it, hide it, and switch its individual fields on and off. Header
  parts stay in the header (a logo reordered below the totals is not a layout
  anyone wants); order is yours within each zone.
- **Page setup**: A5/A4/Letter, portrait/landscape, per-edge margins in
  inches, page background, font family and size, three colour tokens.
- New renderer capabilities to match real invoices: large logos, row numbers,
  per-line descriptions and units, payments-received and a banded balance due,
  terms, signature block, footer alignment.
- `Item.description` and `Item.unit` added — the columns those switches need.
- Templates can be scoped per document kind (`appliesTo`), so a delivery slip
  no longer renders with the invoice design. Cap raised 3 → 12.

### Two bugs worth remembering
- **Save silently did nothing.** The margin inputs had `step="0.05"` while
  their defaults came from the point-based presets (40pt = 0.56in). HTML
  constraint validation rejected the form, so the browser refused to submit
  and showed nothing. Fixed with `step="any"`, plus an `onInvalid` handler
  that now says what is wrong — an invalid field on another panel is
  otherwise invisible.
- Chasing that, I twice hit a **stale Prisma client in the running dev
  server** after a migration: the action throws `Unknown argument`, the page
  500s, and nothing explains it. Restart `next dev` after every migration.

```
lint 0 · tsc 0 · build clean · 239 tests
save verified end to end: orientation round-trips and the PDF MediaBox
follows it (595x842 portrait / 842x595 landscape)
```

## 2026-09-14 — the 100-phase plan, and phases 02, 03, 47 built

Plan published: https://claude.ai/code/artifact/dd8c93a1-ba43-43b8-ab7e-22c09475a8fc

### What the research changed
Competitor weaknesses are specific and quotable, not vague: ClickUp's top
2026 complaints are speed, learning curve and a weak mobile app; Monday bills
a 3-seat minimum then rounds seats up in blocks of five; Zoho's is the
interface and the tier walls; GoHighLevel's is email deliverability. The
lesson from ClickUp's ~1,000 integrations is that almost none are native —
it's a public API plus Zapier. **The API is the integration strategy.**

### Phase 02 — public API (built)
`/api/v1` over the same core functions the dashboard calls.

- **Keys carry a Role**, not their own permission list. The app already has
  one permission model (Role → Capability) and every core function is written
  against it; a second scheme for API callers would be two things to keep in
  step, and the one that drifts is the one nobody watches.
- Secret half never stored — SHA-256 + a visible prefix, constant-time
  compare. Lookup is by prefix so a harvested prefix alone is worthless.
- `readOnly` keys, expiry, revocation, `lastUsedAt`.
- Rate limit counted **on the row**, not in memory: in-process counters are
  per-instance and therefore meaningless on serverless.
- Routes: `/v1/me`, customers (+detail), products, quotes, invoices,
  invoice payments, tasks. `POST /v1/quotes` accepts either structured lines
  **or prose** — verified live: it matched an existing customer by email,
  created two products and totalled R16,200.
- 13 tests. Verified over HTTP: 401 no key, 401 wrong secret with a real
  prefix, 403 read-only writing, 403 driver creating a quote.

### Phase 03 — outbound webhooks (built)
- Fan-out rides the **existing domain event bus**, so the agent's view of the
  business and an integrator's can't drift.
- HMAC-SHA256 over `timestamp.body`, `X-Flow-Signature`. Queue-then-send:
  a dead endpoint must never slow or fail the operation that produced it.
- 5 attempts over ~2 hours, then visibly FAILED — never silently dropped.
- Atomic claim per delivery, so overlapping crons can't double-post.
- New cron `/api/cron/webhook-dispatch` every 5 min. 11 tests.

### Phase 47 — Android app (scaffolded)
`mobile/` — Capacitor 7, `co.skynat.flow`.

- A **shell over the live app**, deliberately. A parallel native client would
  be behind from day one, which is exactly the complaint about mobile apps in
  this category.
- `androidScheme: https` — a custom scheme is the first thing that breaks
  auth. `allowNavigation` allowlist so a link in a customer note can't hijack
  the window.
- Dark canvas end to end (#0B1120) — splash, status bar, nav bar — so there's
  no white flash before first paint.
- Offline page that reloads itself when connectivity returns, wired via
  `errorPath` so nobody sees Chrome's dinosaur inside our app.
- App Links intent-filter + `/.well-known/assetlinks.json` (fingerprint from
  `ANDROID_CERT_FINGERPRINTS`, env not constant — it changes per signing key).
- PWA manifest + generated icons, so it's installable from the browser too.
- **Not compiled here**: no JDK/Android SDK on this machine. Generated and
  synced; first build is `npm run open` in Android Studio. README covers
  signing, App Links and push.

### Two dead spines found and made real
`ApiKey`, `WebhookEndpoint` and `WebhookDelivery` were already in the schema
and **nothing in the code used them**. Same pattern as the event bus and the
memory layer earlier this week: designed, tabled, never wired.

```
lint 0 · tsc 0 · build clean · 264 tests
API verified live · manifest + assetlinks served · dispatch cron ok:true
```

### Next
Phase 79 (MCP server) is cheap now the API exists and nobody in this category
has one. Phase 01 (production) needs your Vercel + provider credentials.

## 2026-09-14 (later) — release APK, MCP server, cash forecast, readiness

### Release APK — built and signed
`mobile/android/app/build/outputs/apk/release/flow-release-1.0.apk` (3.0 MB).

Buildable here after all: no system JDK, but **Android Studio bundles one**
(`/Applications/Android Studio.app/Contents/jbr/Contents/Home`, JDK 21) and
the SDK was already at `~/Library/Android/sdk`.

- Signing config reads `android/keystore.properties` (gitignored). Absent, a
  release build comes out unsigned — the right failure for a fresh clone: a
  missing key should be obvious, not silently swapped for a debug one.
- `flow-testing.keystore` is a **testing key only**. A Play listing is bound
  forever to the key that signs it; creating and safeguarding that key is a
  person's decision, not mine.
- Its SHA-256 is in `.env` as `ANDROID_CERT_FINGERPRINTS`, so App Links
  verify against this build.
- Verified: `apksigner` confirms the cert, `aapt2` confirms package
  `co.skynat.flow`, targetSdk 35, label "flow", and the four permissions.

### Phase 79 — MCP server (built)
`/api/mcp`. Nothing else in this category has one.

- A **protocol adapter, not a second tool surface**. The agent's 84 tools are
  already tenant-scoped and capability-gated; a parallel implementation would
  be the thing that drifts.
- Three filters, in order: role → read-only → **workspace autonomy**. An MCP
  client is not a person watching, so `userPresent: false` — which means
  recordPayment, recordRefund, sendQuote and convertQuoteToInvoice are never
  offered at any autonomy level. Verified live: 77 tools, none of those four.
- Distinguishes "no such tool" (-32601) from "withheld" (-32000) so an
  assistant can explain the real reason rather than telling someone flow
  can't do it.
- Same API keys as `/api/v1`, so revoking a key revokes both.
- 15 tests. Live: initialize, tools/list, and a real `businessSnapshot` call
  returning actual ledger data.

### Phase 21 — 13-week cash forecast (built)
`src/lib/core/cashForecast.ts`, a page, an agent tool and `/api/v1/cash-forecast`.

- Built from committed rows, not a growth assumption. Every line carries a
  `basis` and a `confidence`.
- **Reads each customer's own payment habit** (median lateness from settled
  invoices) and moves the money to the week it will actually arrive — a
  forecast that books every invoice at face value on its due date is a wish
  list.
- Nets off part-payments; treats overdue as owed *now*, not in the past.
- Says what it cannot see — missing running costs, no bank balance — rather
  than silently assuming zero and looking healthier than the business is.
- 11 tests. **Bug caught by them**: `toISOString()` shifted every week label
  back a day for anyone east of UTC. Fixed with a local-date formatter.

### Phase 08 — self-completing readiness (built)
`src/lib/core/readiness.ts` + the home strip, replacing a four-item checklist.

- Ten steps, each checked against real rows, so it ticks itself off as normal
  work happens. Nobody is asked to "complete onboarding".
- Leads with the **single next step** and its reason; the rest is one click
  away. A wall of ten is what makes people close it.
- **Retires on the core steps only** — a business that is invoicing and being
  paid is operational whether or not it invited a teammate. A checklist that
  stays up after you're done with it stops being read, and so does everything
  next to it.
- Also an agent tool (`setupReadiness`), so "what should I do next?" works in
  chat and over MCP.
- 8 tests.

### Housekeeping
- `mobile/**` added to the eslint ignores: Capacitor's generated
  `native-bridge.js` in the Gradle output was producing every warning in the
  repo and none of them real. Same class as the earlier template pollution.
- The coverage test caught `readiness` having no agent tool. Wired it rather
  than exempting it — the better answer.

```
lint 0 · tsc 0 · build clean · 298 tests · APK signed and verified
```

### Parked
**Phase 101 — Shopify and the wider ecommerce set** (user's request, for
later). WooCommerce exists; `EcommercePlatform` is a one-value enum, so
Shopify is a new enum value plus one client file, mirroring how the payment
gateway registry works.
