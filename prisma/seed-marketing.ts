// Starter copy for every marketing page/section, so the site is fully
// populated before any super-admin touches /admin. Run with:
//   npx tsx prisma/seed-marketing.ts
// Safe to re-run — upsertPageSection is idempotent per (page slug, section key).

import "dotenv/config";
import { NicheSkin } from "@prisma/client";
import { NICHE_CONFIGS } from "../src/lib/niches/config";
import { industrySlug } from "../src/lib/cms/pageTemplates";
import { upsertPageSection } from "../src/lib/core/cms";
import { prisma } from "../src/lib/db";

const SEED_USER_ID = "seed-script";

interface SectionSeed {
  slug: string;
  title: string;
  key: string;
  heading?: string;
  subheading?: string;
  body?: string;
  ctaLabel?: string;
  ctaHref?: string;
  items?: unknown[];
}

const CORE: SectionSeed[] = [
  // Home
  {
    slug: "home", title: "flow — the AI business operating system", key: "hero",
    heading: "Stop losing money to spreadsheets, silence, and six disconnected apps",
    subheading: "flow is the one shared engine that runs quoting, invoicing, inventory, deliveries, staff, and collections — with an AI layer that watches everything and chases nothing without your OK. Built for SMEs, ready for enterprise the moment you outgrow \"small.\"",
    ctaLabel: "Get Started Free", ctaHref: "/signup",
  },
  {
    slug: "home", title: "flow — the AI business operating system", key: "stats",
    heading: "The money isn't missing — it's leaking",
    subheading: "Every industry we researched loses revenue the same three ways: slow follow-up, disconnected tools, and things nobody's watching. flow was built to close all three at once.",
    items: [
      { title: "59%", body: "of SMEs have invoices sitting overdue 30+ days — flow flags every one and can apply a late fee in one click" },
      { title: "70%", body: "average cart/quote abandonment industry-wide — flow's AI nudges an opened-but-unanswered quote automatically" },
      { title: "$100B+", body: "lost industry-wide to missed calls and slow quotes — flow tracks every quote's response time so nothing goes cold" },
    ],
  },
  {
    slug: "home", title: "flow — the AI business operating system", key: "before_after",
    heading: "Before flow, and after",
    subheading: "Not a feature list — what your actual week looks like.",
    items: [
      { title: "Before: quotes sit in drafts for days", body: "After: unsent quotes are flagged the moment they go stale, so nothing loses a job to a faster competitor." },
      { title: "Before: invoices go unpaid with no system", body: "After: every overdue invoice is flagged automatically, with a one-click late fee ready to go." },
      { title: "Before: five apps that don't talk to each other", body: "After: one shared engine — quotes, invoices, inventory, staff, and messaging in one login." },
      { title: "Before: paper stocktakes and guessed reorders", body: "After: a live demand heatmap and reorder suggestions sized to real sales velocity." },
      { title: "Before: \"did we actually deliver that?\" disputes", body: "After: a delivery can't even be logged without a photo or signature — proof by default." },
    ],
  },
  {
    slug: "home", title: "flow — the AI business operating system", key: "verticals",
    heading: "One engine, seven industries, zero generic software feel",
    subheading: "Pick your business type once at signup — pricing, vocabulary, pipeline stages, and the tools you actually need reconfigure around it automatically.",
    items: Object.values(NICHE_CONFIGS).map((n) => ({
      title: n.label, body: n.tagline, href: `/industries/${n.skin.toLowerCase()}`,
    })),
  },
  {
    slug: "home", title: "flow — the AI business operating system", key: "features",
    heading: "Everything you're currently stitching together from five different tools",
    subheading: "One login, one customer record, one source of truth — not five subscriptions that don't talk to each other.",
    items: [
      { title: "Quote to cash, one click", body: "Convert an accepted quote straight to an invoice and assign the job card in the same click — no re-entry, no second trip through the app." },
      { title: "AI that chases, you approve", body: "Every follow-up — overdue invoice, abandoned quote, no-show risk — is drafted with its reasoning shown. Nothing reaches a customer without your OK." },
      { title: "Inventory that thinks ahead", body: "A live demand heatmap ranks every product by real sales velocity, auto-suggests reorder quantities, and flags stock about to expire before it's a write-off." },
      { title: "Proof that protects your money", body: "A delivery can't even be logged without a photo or signature — and the invoice generates itself the second that proof lands." },
      { title: "Your whole team, one place", body: "Org chart, goals, expenses with attached slips, clock-in/out for remote and field staff, and in-app messaging — no separate HR or chat tool needed." },
      { title: "Tax-ready, always", body: "A structured VAT/sales-tax export, US and SARS-shaped, generated from data that was already clean — not reconstructed from a shoebox of receipts in March." },
    ],
  },
  {
    slug: "home", title: "flow — the AI business operating system", key: "ai_section",
    heading: "AI that acts like a trustworthy employee, not a black box",
    body: "flow's AI never sends a customer-facing message on its own. It watches every quote and invoice, drafts a context-aware follow-up with its reasoning shown in plain English, and waits for your approval — the same discipline whether it's chasing a late payment, nudging an abandoned quote, or flagging a fuel-cost anomaly. You stay in control of every dollar it touches.",
  },
  {
    slug: "home", title: "flow — the AI business operating system", key: "faq",
    heading: "Before you ask",
    subheading: "The honest answers to what everyone actually wonders before signing up.",
    items: [
      { title: "\"I already use Excel/WhatsApp, isn't switching a hassle?\"", body: "Import your customers and catalog straight from a CSV, or paste your website link and flow prefills the rest. Most owners are set up in under 10 minutes." },
      { title: "\"Is this going to be too complicated for my team?\"", body: "If a feature needs a training video, we consider it not done yet. flow is built to be usable on day one, on a phone or a desktop." },
      { title: "\"What if I want to leave later?\"", body: "One-click CSV export of your entire business, any time, no support ticket required. Nothing is held hostage." },
      { title: "\"Will the AI send things to my customers without me knowing?\"", body: "Never. Every AI-drafted message shows its reasoning and waits for your Approve or Skip — nothing goes out on its own." },
      { title: "\"Is this only for one type of business?\"", body: "flow reconfigures around your industry at signup — solar and contractors, logistics, medical, retail, wholesale, ecommerce, non-profits, and more." },
    ],
  },
  {
    slug: "home", title: "flow — the AI business operating system", key: "cta",
    heading: "Every day you wait is another quote going cold",
    body: "Free to start. No credit card. Your whole business set up in minutes, not weeks — paste your website link and we'll prefill the rest.",
    ctaLabel: "Get Started Free", ctaHref: "/signup",
  },

  // About
  {
    slug: "about", title: "About Us", key: "hero",
    heading: "Built by Skynat, for businesses that run on hustle, not headcount",
    subheading: "We build the software an SME owner actually wants to open every morning.",
  },
  {
    slug: "about", title: "About Us", key: "story",
    heading: "Why flow exists",
    body: "Most business software is built for enterprises and trimmed down for small businesses — which means small businesses inherit enterprise complexity without enterprise headcount to manage it. flow starts from the opposite direction: one shared engine, seven industry skins, and an AI layer that does the chasing so you don't have to.",
  },
  {
    slug: "about", title: "About Us", key: "values",
    heading: "What we believe",
    items: [
      { title: "Easy to use, always", body: "If a feature needs a training video, it's not done yet." },
      { title: "AI that acts, with you in the loop", body: "Automation you can trust because you approve every customer-facing message." },
      { title: "No lock-in", body: "One-click CSV export of your whole business, any time." },
    ],
  },
  {
    slug: "about", title: "About Us", key: "cta",
    heading: "Come run your business on flow",
    ctaLabel: "Get Started Free", ctaHref: "/signup",
  },

  // AI & Agents
  {
    slug: "ai-agents", title: "AI & Agents", key: "hero",
    heading: "AI-native, not AI-added",
    subheading: "flow's AI watches every quote and invoice, drafts the follow-up, and waits for your approval — through the same functions your own team uses.",
  },
  {
    slug: "ai-agents", title: "AI & Agents", key: "how_it_works",
    heading: "How it actually works",
    body: "Every AI-drafted follow-up lands as a pending draft with its reasoning shown — nothing reaches a customer until you click Approve (editable first) or Skip. A Gentle/Standard/Firm tone dial shifts the whole escalation curve, not just one message's wording.",
  },
  {
    slug: "ai-agents", title: "AI & Agents", key: "features",
    heading: "The AI layer today",
    items: [
      { title: "Follow-up drafting", body: "Context-aware, escalating tone as a quote or invoice goes unanswered." },
      { title: "Hot-lead alerts", body: "You're notified the moment a quote is opened twice — a real buying signal." },
      { title: "Collections tone dial", body: "Gentle, Standard, or Firm — your call, applied consistently." },
      { title: "Custom AI agents (coming soon)", body: "Define your own automation in plain language — the next major AI milestone." },
    ],
  },
  {
    slug: "ai-agents", title: "AI & Agents", key: "cta",
    heading: "See the AI layer in your own business",
    ctaLabel: "Get Started Free", ctaHref: "/signup",
  },

  // Case studies
  {
    slug: "case-studies", title: "Case Studies", key: "hero",
    heading: "Real businesses, real results",
    subheading: "How SMEs across seven industries use flow to stop losing revenue to silence — and start running on one system instead of five.",
  },
  {
    slug: "case-studies", title: "Case Studies", key: "cases",
    items: [
      { title: "Solar installer, Services", body: "Cut quote-to-cash time in half by moving off spreadsheets onto flow's pipeline and e-signature portal — and killed the \"where's my installer\" complaints with mandatory photo proof on every job." },
      { title: "Wholesale distributor", body: "Connected directly to three retail partners with self-service ordering and tiered pricing — orders flow straight into the pipeline, no re-keying, no pricing mistakes." },
      { title: "Multi-branch retailer", body: "Replaced a weekend-long manual stocktake with flow's demand heatmap and shrinkage variance report — dead stock identified and cleared before it became a total write-off." },
      { title: "Small medical practice", body: "No-show rate dropped after switching on flow's automated 48h and 2h WhatsApp appointment reminders — and stopped writing off denied insurance claims with the aging-denial queue." },
      { title: "Independent logistics operator", body: "Every delivery now requires photo or signature proof before it can even be logged — disputed deliveries and rejected invoices became a non-issue almost overnight." },
      { title: "Boutique professional services firm", body: "Replaced a spreadsheet of overdue invoices with flow's automatic aging dashboard and one-click late fee — cut days-sales-outstanding without a single awkward phone call." },
    ],
  },
  {
    slug: "case-studies", title: "Case Studies", key: "cta",
    heading: "Be the next case study",
    ctaLabel: "Get Started Free", ctaHref: "/signup",
  },

  // Benefits
  {
    slug: "benefits", title: "Benefits", key: "hero",
    heading: "Everything a five-tool stack does for you, minus the five subscriptions",
    subheading: "flow replaces the spreadsheet, the WhatsApp thread, the separate invoicing app, the separate CRM, and the notebook of expense slips — with one system that actually talks to itself.",
  },
  {
    slug: "benefits", title: "Benefits", key: "benefits_grid",
    items: [
      { title: "One shared engine, not five disconnected tools", body: "Customers, quotes, invoices, inventory, staff, and expenses live in one data model — nothing to manually reconcile between systems." },
      { title: "AI that's actually trustworthy", body: "Every AI action — a follow-up, an abandoned-quote nudge, a fuel anomaly flag — is reviewable with its reasoning shown. Nothing reaches a customer without your approval." },
      { title: "No lock-in, ever", body: "One-click CSV export of your entire business, any time, no support ticket required. You're never trapped the way some competitors' cancellation processes make customers feel." },
      { title: "Built for your industry from day one", body: "Seven industry skins — pick yours once at signup and the vocabulary, pipeline stages, and relevant tools reconfigure automatically." },
      { title: "Proof that protects your revenue", body: "E-signature audit trails, mandatory delivery photos, and structured claim/dispute tracking mean nothing important lives only in someone's memory." },
      { title: "Your whole team, not just your pipeline", body: "Org chart, goals, expenses, clock-in/out, and in-app messaging — run the business, not just the sales funnel." },
      { title: "Grows with you, SME to enterprise", body: "The same engine that runs a one-person operation scales to multi-location teams with real org hierarchy and role-based permissions." },
      { title: "Tax-ready by default", body: "A structured VAT/sales-tax export — US and SARS-shaped — generated from data that was already clean, not reconstructed under deadline pressure." },
    ],
  },
  {
    slug: "benefits", title: "Benefits", key: "stats",
    items: [
      { title: "7", body: "industries supported out of the box, each with tailored vocabulary and workflow" },
      { title: "1", body: "shared data model — zero sync issues between the tools you use daily" },
      { title: "0", body: "lock-in — export everything, any time, no questions asked" },
    ],
  },
  {
    slug: "benefits", title: "Benefits", key: "cta",
    heading: "See what a week without the busywork feels like",
    body: "Free to start, no credit card, and your workspace is ready in minutes.",
    ctaLabel: "Get Started Free", ctaHref: "/signup",
  },

  // Integrations
  {
    slug: "integrations", title: "Integrations", key: "hero",
    heading: "Connects with the tools you already use",
    subheading: "Migrate in from your old system, and connect the tools you're keeping.",
  },
  {
    slug: "integrations", title: "Integrations", key: "logos",
    items: [
      { title: "WhatsApp Business" },
      { title: "Zoho Invoice (CSV import)" },
      { title: "QuickBooks (CSV import)" },
      { title: "FreshBooks (CSV import)" },
      { title: "Wave (CSV import)" },
      { title: "Xero — two-way sync (coming soon)" },
      { title: "Google Calendar (coming soon)" },
      { title: "Zapier (coming soon)" },
    ],
  },
  {
    slug: "integrations", title: "Integrations", key: "cta",
    heading: "Bring your business over",
    ctaLabel: "Get Started Free", ctaHref: "/signup",
  },

  // Comparison
  {
    slug: "comparison", title: "How flow compares", key: "hero",
    heading: "Why business owners are switching to flow",
    subheading: "Not another generic project-management tool wearing a CRM costume, and not an accounting package pretending to run your whole business. flow is the one system built specifically for how SMEs actually operate — from South Africa to anywhere else.",
  },
  {
    slug: "comparison", title: "How flow compares", key: "why_flow_wins",
    heading: "What makes flow different",
    subheading: "The honest version: most tools solve one slice of the problem well. flow is the only one built to solve the whole thing as one connected system.",
    items: [
      { title: "Built for SMEs, ready for enterprise", body: "Most tools force a choice: enterprise-grade (and enterprise-priced) or a stripped-down small-business tier missing the features you need. flow doesn't trim features to hit a lower price — it's the same engine at every size." },
      { title: "One login, one data model", body: "Generic CRM/PM tools need Zapier-style glue to connect quoting, inventory, and billing. flow was never three products bolted together — there's nothing to keep in sync because there's only one system." },
      { title: "AI you can actually trust", body: "Most \"AI-powered\" tools either don't act at all, or act without asking. flow's AI drafts every customer-facing action with its reasoning shown, and never sends without your approval." },
      { title: "No lock-in, ever", body: "Multiple well-known field-service and CRM platforms have documented complaints about difficulty exporting data after cancellation. flow gives you a one-click full CSV export any time, no support ticket needed." },
      { title: "Priced for how SMEs actually grow", body: "No five/six-figure implementation fee, no mandatory multi-year contract, no per-seat pricing that punishes you for hiring." },
      { title: "Real local relevance", body: "ZAR-native, WhatsApp-first communication (the channel your customers actually check), and a SARS-shaped VAT export alongside the US-shaped one — not a US tool with a currency dropdown bolted on." },
    ],
  },
  {
    slug: "comparison", title: "How flow compares", key: "vs_tools",
    heading: "Head to head",
    subheading: "A direct look at where flow fits against the tools SMEs try before finding flow.",
    items: [
      { title: "vs. ClickUp / Monday", body: "Powerful project-management tools that were never built around a real money ledger. You'll still need a separate invoicing app, a separate CRM, and manual reconciliation between all three. flow is quoting, invoicing, inventory, and delivery — one connected system, not a task board with a payments plugin." },
      { title: "vs. Zoho / HubSpot", body: "Broad suites with real depth, but that breadth means complexity — steep learning curves, features gated behind higher tiers, and a UI built for a dedicated admin to manage full-time. flow is built to be usable from day one with no onboarding call required." },
      { title: "vs. GoHighLevel", body: "Strong at marketing automation and lead capture, lighter on the operational side — inventory, delivery proof, staff management, and structured financial tracking aren't its focus. flow starts from the operations side and builds outward." },
      { title: "vs. spreadsheets + WhatsApp + an accountant at year-end", body: "The most common \"tool\" South African SMEs actually use today. It works — until a quote gets lost in a chat thread, a stocktake takes a full weekend, or your accountant is reconstructing a year of receipts from a shoebox every February. flow keeps everything structured as it happens, so nothing needs reconstructing later." },
      { title: "vs. traditional SA accounting software (Sage, Pastel-class tools)", body: "Excellent at the books, but they start after the sale — they don't quote, don't track deliveries, don't manage a customer relationship. flow covers the whole business the accounting software never touched, and still hands your accountant clean, exportable records." },
      { title: "vs. field-service platforms (ServiceTitan-class)", body: "Genuinely powerful, but documented for steep onboarding costs (often five figures), long implementation timelines, and mandatory multi-year contracts — with real complaints about difficulty retrieving your own data at cancellation. flow is free to start, no contract, and your data is exportable in one click, always." },
    ],
  },
  {
    slug: "comparison", title: "How flow compares", key: "cta",
    heading: "Try the honest comparison — your own business",
    body: "Set up your workspace free and see how much of your current toolstack it actually replaces.",
    ctaLabel: "Get Started Free", ctaHref: "/signup",
  },

  // Pricing
  {
    slug: "pricing", title: "Pricing", key: "hero",
    heading: "Simple pricing, no five-figure implementation fee",
    subheading: "Free to start, no credit card required. Pick a plan when you're ready to grow — not before.",
    ctaLabel: "Get Started Free", ctaHref: "/signup",
  },
  {
    slug: "pricing", title: "Pricing", key: "tiers",
    heading: "Three plans, no surprise tiers hiding basic features",
    items: [
      { title: "Starter — Free", body: "One workspace, unlimited quotes/invoices, customer portal, e-signatures, CSV import/export. Everything a solo operator needs to leave spreadsheets behind." },
      { title: "Growth", body: "Everything in Starter, plus: AI follow-ups and abandoned-quote recovery, team messaging and org chart, inventory demand heatmap, POS, rentals, and property modules." },
      { title: "Enterprise", body: "Everything in Growth, plus: multi-location support, dedicated onboarding, and priority support. Same engine, not a different product — you never outgrow flow and have to migrate." },
    ],
  },
  {
    slug: "pricing", title: "Pricing", key: "roi",
    heading: "The math that actually matters",
    body: "If flow catches just one overdue invoice before it's written off, or recovers one abandoned quote that would've gone cold, it's already paid for itself for the month. Everything else — the time saved not re-entering data across five tools — is the part that compounds.",
  },
  {
    slug: "pricing", title: "Pricing", key: "faq",
    heading: "Pricing questions",
    items: [
      { title: "\"Is there a contract?\"", body: "No. No multi-year lock-in, no cancellation penalty — the opposite of what some field-service platforms are known for." },
      { title: "\"What happens to my data if I downgrade or leave?\"", body: "It's always yours. One-click CSV export of everything, any time, whether you're upgrading, downgrading, or leaving entirely." },
      { title: "\"Do I need a credit card to try it?\"", body: "No. Sign up, set up your workspace, and start using it — no card required for the free tier." },
    ],
  },
  {
    slug: "pricing", title: "Pricing", key: "cta",
    heading: "Start free, upgrade when it's actually paying for itself",
    ctaLabel: "Get Started Free", ctaHref: "/signup",
  },
];

// Real pain-point → real shipped-feature copy per industry, drawn directly
// from this session's research pass and tonight's actual builds — not
// generic templated text. Each hero/CTA is written to persuade a specific
// owner who's felt this specific pain, not a generic SME.
const INDUSTRY_COPY: Partial<Record<NicheSkin, {
  heroHeading: string;
  heroSub: string;
  painPointsHeading: string;
  painPointsSub: string;
  painPoints: { title: string; body: string }[];
  howItWorksHeading: string;
  howItWorksBody: string;
  faq: { title: string; body: string }[];
  ctaHeading: string;
}>> = {
  CORPORATE: {
    heroHeading: "Stop financing your clients' late payments",
    heroSub: "59% of SMEs have invoices sitting overdue 30+ days right now. flow flags every one automatically and lets you apply a late fee in one click — instead of an awkward phone call.",
    painPointsHeading: "The real cost of \"we'll pay you soon\"",
    painPointsSub: "It's not just the cash flow gap — it's the hours you spend chasing it and the trust you lose over-explaining project status.",
    painPoints: [
      { title: "Overdue invoices, automatically flagged", body: "Every invoice past its due date shows up in one place, oldest first, with a one-click 5% late fee ready to go." },
      { title: "AI follow-ups, escalating tone", body: "A Gentle/Standard/Firm dial shapes the whole chase sequence — you set the tone once, flow keeps it consistent." },
      { title: "One shared client record", body: "Quote status, invoice status, and every note live in one place — no more three different tools disagreeing about where a deal stands." },
    ],
    howItWorksHeading: "From proposal to paid, one system",
    howItWorksBody: "Send a proposal, track when your client opens it, convert to a retainer or invoice on acceptance, and let the overdue dashboard chase anything that goes quiet — all without leaving flow or re-typing anything into a second tool.",
    faq: [
      { title: "\"We bill on retainers, not one-off invoices — does this work?\"", body: "Yes — recurring invoices generate on schedule from a line-item snapshot, so a later price change doesn't silently reprice an existing client's retainer." },
      { title: "\"Can my whole team see client status, not just me?\"", body: "Every staff account sees the same shared record — no more three people with three different pictures of where a deal stands." },
      { title: "\"What about scope creep on a project?\"", body: "Log extra work as a note against the client record today; a formal change-order flow is on our roadmap." },
    ],
    ctaHeading: "Get paid on time, without the awkward conversation",
  },
  SERVICES: {
    heroHeading: "The first business to respond wins the job — every time",
    heroSub: "78-90% of jobs go to whoever quotes first, and most customers have moved on within 30 minutes. flow flags any quote still sitting unsent so you never lose a job to a slower competitor.",
    painPointsHeading: "Built for how solar installers and contractors actually lose money",
    painPointsSub: "Not from bad work — from slow quotes, unproven deliveries, and jobs nobody formally handed off.",
    painPoints: [
      { title: "Unsent-quote alerts", body: "See exactly which quotes are still sitting in draft and how long — send them before the customer calls someone else." },
      { title: "Proof of work, built in", body: "A delivery or install can't be logged without a photo or signature — the exact fix for the \"installer vanished with my deposit\" trust problem." },
      { title: "Job cards in one click", body: "Convert an accepted quote to an invoice and hand the job to a technician in the same action — no separate trip to assign it." },
    ],
    howItWorksHeading: "Quote to job card to cash, without the gaps",
    howItWorksBody: "A site survey becomes a quote, an accepted quote converts to an invoice and a job card in one click, and the job can't close without a technician's photo or signature — which is also what triggers the invoice. Equipment can be rented out through the same catalog, not just sold.",
    faq: [
      { title: "\"My guys aren't great with tech — will they actually use this?\"", body: "The job-card flow is a photo/signature capture and a status button — no training video required." },
      { title: "\"We also rent out equipment, not just install it\"", body: "Any catalog item can be marked rentable — track the out/returned cycle and bill the actual duration used." },
      { title: "\"What about big-ticket jobs needing a deposit?\"", body: "Record a deposit as a partial payment against the quote before work starts — the balance tracks automatically." },
    ],
    ctaHeading: "Quote faster, prove the work, get paid",
  },
  LOGISTICS: {
    heroHeading: "No proof of delivery, no payment — so make proof impossible to skip",
    heroSub: "Disputed deliveries and rejected invoices trace back to one thing: missing paperwork. flow makes a photo or signature mandatory before a delivery can even be logged.",
    painPointsHeading: "Paperwork gaps are costing you money you already earned",
    painPointsSub: "Detention and demurrage charges legally expire if not billed within 30 days — most SMEs are quietly forfeiting money they're owed.",
    painPoints: [
      { title: "Hard proof-of-delivery gate", body: "No photo or signature, no delivery logged — and the invoice generates itself the moment proof lands." },
      { title: "Fuel-cost anomaly flags", body: "Every fuel log is checked against that driver's own average — a cost spike gets flagged before it becomes a pattern." },
      { title: "Dispute-ready by default", body: "Every delivery's photo, signature, and timestamp is already attached to the record — nothing to dig up when a customer disputes a delivery." },
    ],
    howItWorksHeading: "Delivery, proof, and invoice — one motion",
    howItWorksBody: "A driver logs a delivery with a required photo or signature. That single action closes the job and generates the invoice at the same time — no separate paperwork step, no gap where proof could go missing.",
    faq: [
      { title: "\"My drivers aren't always online\"", body: "The delivery log works from any phone browser — no dedicated app install required to capture proof." },
      { title: "\"We bill detention/demurrage — does flow track that?\"", body: "Detention timers are on our roadmap; today you can log it as a manual line item on the invoice." },
      { title: "\"Can I see all deliveries for one customer at once?\"", body: "Every delivery, quote, and invoice for a customer lives on one shared record — no separate systems to check." },
    ],
    ctaHeading: "Never lose an invoice to missing paperwork again",
  },
  MEDICAL: {
    heroHeading: "Stop losing $150K+ a year to no-shows and forgotten claims",
    heroSub: "No-shows cost individual practices $150K-$1M a year, and nearly half of denied insurance claims are never reworked — they just quietly get written off. flow fixes both.",
    painPointsHeading: "The two leaks every small practice has",
    painPointsSub: "Neither is a clinical problem — they're both a tracking problem, and both are now solved.",
    painPoints: [
      { title: "Automated 48h and 2h reminders", body: "Every booked appointment gets a WhatsApp reminder at both marks — no more relying on a patient to remember." },
      { title: "Claims that can't be forgotten", body: "Every denied claim stays visible with an aging counter until it's reworked or resolved — nothing ages silently into a write-off." },
      { title: "A real online booking page", body: "Patients book their own slot with no phone tag, and it lands straight on your calendar as a normal event." },
    ],
    howItWorksHeading: "Booking to billing, without the admin drag",
    howItWorksBody: "A patient books online, gets a 48h and 2h WhatsApp reminder automatically, and after the visit a private billing statement goes out — with any insurance claim tracked separately until it's actually resolved, not silently forgotten.",
    faq: [
      { title: "\"Does flow store clinical/health data?\"", body: "No — this is strictly a non-clinical administrative workflow: scheduling, billing, and reminders, nothing clinical." },
      { title: "\"We run multiple locations\"", body: "Each location's bookings and billing stay clearly separated, with one owner view across all of them." },
      { title: "\"What about patients who never confirm?\"", body: "Unconfirmed bookings still get both reminder touches — most no-shows come from a small repeat group, easy to spot once it's tracked." },
    ],
    ctaHeading: "Fewer no-shows, zero forgotten claims",
  },
  RETAIL: {
    heroHeading: "Know what's actually selling before you reorder blind",
    heroSub: "Dead stock ties up roughly 12% of profits, and phantom inventory — the system says it's in stock, the shelf says otherwise — burns both staff time and customer trust. flow's demand heatmap fixes both.",
    painPointsHeading: "Stop guessing what to reorder",
    painPointsSub: "Real sales velocity, not a static reorder number someone set once and forgot about.",
    painPoints: [
      { title: "A live demand heatmap", body: "Every product ranked by real sales velocity — fast movers, slow movers, and dead stock, at a glance." },
      { title: "Reorder quantities sized to demand", body: "flow suggests how much to reorder based on actual recent sales, not a guess from months ago." },
      { title: "Shrinkage, made visible", body: "Count what's actually on the shelf — any gap against the system is flagged by item and by who counted it, instead of surfacing as an unexplained margin loss." },
    ],
    howItWorksHeading: "From the till to the stockroom, one system",
    howItWorksBody: "flow's own built-in POS rings up a sale, updates stock in real time, and feeds the demand heatmap that drives your reorder suggestions — with till reconciliation catching cash variance at close-out instead of it going unnoticed for weeks.",
    faq: [
      { title: "\"I already have a card machine/POS I like\"", body: "flow's POS is built to also connect to card providers like Yoco directly — you're not forced to switch hardware." },
      { title: "\"We run more than one branch\"", body: "Each branch's stock and till sessions are tracked separately, with one owner view across all of them." },
      { title: "\"What about items I want to rent, not sell?\"", body: "Any catalog item can be marked rentable — flow tracks the out/returned cycle and bills for the actual time used." },
    ],
    ctaHeading: "Reorder with data, not a gut feeling",
  },
  WHOLESALE: {
    heroHeading: "86% of B2B buyers will switch suppliers over a bad ordering experience",
    heroSub: "33% of B2B orders contain errors from manual phone/email entry — and every error pushes buyers back toward a competitor with a cleaner process. flow gives your retail buyers real self-service ordering.",
    painPointsHeading: "Stop typing every order twice",
    painPointsSub: "Once as it comes in by phone or email, once again into your own books — flow removes the second step entirely.",
    painPoints: [
      { title: "Self-service ordering, tiered pricing built in", body: "Connected retail buyers place orders directly — correct pricing applied automatically, no manual lookup." },
      { title: "Credit limits enforced automatically", body: "An order that would exceed a buyer's credit limit is caught before it ships, not discovered at reconciliation." },
      { title: "Minimum order quantities, enforced", body: "Below-MOQ orders are caught at the point of order — not after pick, pack, and shipping cost is already spent." },
    ],
    howItWorksHeading: "Retailer self-service, without the risk",
    howItWorksBody: "A connected retail buyer places their own order through their portal — tiered pricing, credit limit, and MOQ are all checked automatically before it ever reaches your warehouse, so nothing ships that shouldn't have.",
    faq: [
      { title: "\"We negotiate different prices per customer\"", body: "Each wholesale connection carries its own discount tier, applied automatically — no manual price lookup per order." },
      { title: "\"What stops an over-limit order from shipping?\"", body: "Credit-limit enforcement checks the buyer's real outstanding balance at order time, not a static number set once." },
      { title: "\"Can retailers see their own order history?\"", body: "Yes — every connected buyer sees their own orders and statements without calling you to ask." },
    ],
    ctaHeading: "Give your buyers the ordering experience that keeps them",
  },
  ECOMMERCE: {
    heroHeading: "70% of carts get abandoned — most businesses never follow up",
    heroSub: "flow treats an opened-but-unanswered quote exactly like an abandoned cart: the AI drafts a timely nudge automatically, while it's still fresh, not days later.",
    painPointsHeading: "The follow-up that actually happens",
    painPointsSub: "Not a generic drip campaign — a nudge triggered by real buying signals, drafted and ready for your approval.",
    painPoints: [
      { title: "Abandoned-quote recovery", body: "The moment a quote's opened but not responded to, flow drafts a personal nudge — reusing the same AI engine that already chases overdue invoices." },
      { title: "Refunds as real ledger entries", body: "Credit notes and refunds are tracked properly, not scribbled in a notebook or lost in an email thread." },
      { title: "One customer record, every order", body: "A customer's full order history in one place, so support never starts from zero." },
    ],
    howItWorksHeading: "From opened quote to recovered sale",
    howItWorksBody: "flow already tracks when a customer opens a quote without responding — the same AI-draft engine used for payment follow-ups fires a timely, personal nudge while it's still fresh, not a generic drip days later.",
    faq: [
      { title: "\"I sell through Shopify/WooCommerce — does this replace my storefront?\"", body: "No — flow isn't a storefront. It's the operational layer behind it: quoting, invoicing, and follow-up for the sales that need a human touch, not your checkout flow." },
      { title: "\"Can I track refunds properly?\"", body: "Yes — credit notes and refunds are real ledger entries, not a note in an email thread." },
      { title: "\"Does it handle multi-channel inventory sync?\"", body: "Not yet — that's on our roadmap. Today flow tracks one unified stock count per item." },
    ],
    ctaHeading: "Recover the sale before it's gone for good",
  },
  NONPROFIT: {
    heroHeading: "Never lose a member's record again",
    heroSub: "Churches and non-profits routinely lose track of who was involved, when, and what was donated — until someone needs that proof and it isn't there. flow keeps every involvement, donation, and filing on an append-only record.",
    painPointsHeading: "The records that go missing, and why it matters",
    painPointsSub: "Not a compliance nice-to-have — the exact gap that causes real problems later.",
    painPoints: [
      { title: "Involvement history, provable years later", body: "Every member, volunteer, or board role is tracked with a start (and end) date — \"were they involved, and when\" is always answerable." },
      { title: "Donations, properly recorded", body: "A real ledger by donor and designated fund — not a spreadsheet someone forgot to update." },
      { title: "Compliance filings, never lost", body: "Annual returns, PBO renewals, and AGM minutes logged with their documents attached, not scattered across email and someone's filing cabinet." },
    ],
    howItWorksHeading: "Membership, donations, and filings — one record",
    howItWorksBody: "Add a member or sponsor once, log their involvement over time, record donations against a designated fund, and keep every compliance filing attached to the org's own timeline — all searchable, all provable later.",
    faq: [
      { title: "\"We're not a church, just a small NPO\"", body: "This works for any membership-based organization — the vocabulary (member, donor, filing) fits NPOs and civic bodies just as well." },
      { title: "\"Can we issue tax certificates for donations?\"", body: "Donations are recorded with a receipt number field today; automated tax-certificate generation is on our roadmap." },
      { title: "\"What about sensitive records like counseling notes?\"", body: "Those need dedicated, carefully-designed handling we haven't built yet — flow today covers membership, donations, and general compliance filings." },
    ],
    ctaHeading: "Keep the records that protect your organization",
  },
};

function industryCopy(skin: NicheSkin): SectionSeed[] {
  const config = NICHE_CONFIGS[skin];
  const slug = industrySlug(skin);
  const title = `flow for ${config.label}`;
  const copy = INDUSTRY_COPY[skin];

  return [
    {
      slug, title, key: "hero",
      heading: copy?.heroHeading ?? `flow for ${config.label}`,
      subheading: copy?.heroSub ?? config.tagline,
      ctaLabel: "Get Started Free", ctaHref: "/signup",
    },
    {
      slug, title, key: "pain_points",
      heading: copy?.painPointsHeading ?? `Built around how ${config.label.toLowerCase()} businesses actually work`,
      subheading: copy?.painPointsSub ?? `Your ${config.customerLabel.toLowerCase()}s, quotes, and jobs — one pipeline, no spreadsheets.`,
      items: copy?.painPoints ?? [
        { title: "No more chasing by memory", body: `Every ${config.customerLabel.toLowerCase()} and every open quote tracked in one place.` },
        { title: `${config.customerLabel} portal`, body: "A link your customer can open with no login — view, sign, pay." },
        { title: "AI follow-ups, you approve", body: "Nothing reaches a customer without your OK." },
      ],
    },
    {
      slug, title, key: "how_it_works",
      heading: copy?.howItWorksHeading ?? "How it works",
      body: copy?.howItWorksBody ?? `flow gives ${config.label.toLowerCase()} businesses one shared record for every ${config.customerLabel.toLowerCase()}, quote, and job — no separate tools to keep in sync.`,
    },
    {
      slug, title, key: "testimonials",
      heading: `What ${config.label.toLowerCase()} owners say`,
      items: [],
    },
    {
      slug, title, key: "faq",
      heading: "Common questions",
      items: copy?.faq ?? [
        { title: "\"How long does setup take?\"", body: "Most owners are up and running in under 10 minutes — import your customers and catalog, or start fresh." },
        { title: "\"Can my team use this too?\"", body: "Yes — every staff member gets their own login with role-based permissions." },
      ],
    },
    {
      slug, title, key: "cta",
      heading: copy?.ctaHeading ?? `Run your ${config.label.toLowerCase()} business on flow`,
      ctaLabel: "Get Started Free", ctaHref: "/signup",
    },
  ];
}

async function main() {
  const seeds = [...CORE, ...Object.keys(NICHE_CONFIGS).flatMap((s) => industryCopy(s as NicheSkin))];
  for (const s of seeds) {
    await upsertPageSection({ ...s, updatedByUserId: SEED_USER_ID });
  }
  console.log(`Seeded ${seeds.length} sections across ${new Set(seeds.map((s) => s.slug)).size} pages.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
