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
    slug: "home", title: "flow — AI Business Operating System", key: "hero",
    heading: "One platform to run your entire business",
    subheading: "Quoting, invoicing, inventory, delivery, and a customer portal — on one shared engine built for how SMEs actually work, not enterprise software trimmed down.",
    ctaLabel: "Get Started Free", ctaHref: "/signup",
  },
  {
    slug: "home", title: "flow — AI Business Operating System", key: "stats",
    heading: "SMEs lose real money to silence",
    subheading: "Not because the work isn't there — because nobody has time to chase it consistently.",
    items: [
      { title: "56%", body: "of small businesses are owed money on unpaid invoices right now" },
      { title: "10+ hrs", body: "spent every week manually chasing payments and quotes" },
      { title: "50–100%", body: "higher close rate with consistent follow-up instead of giving up early" },
    ],
  },
  {
    slug: "home", title: "flow — AI Business Operating System", key: "verticals",
    heading: "One engine, seven skins",
    subheading: "Pick your business type at signup — the whole platform reconfigures around it.",
    items: Object.values(NICHE_CONFIGS).map((n) => ({
      title: n.label, body: n.tagline, href: `/industries/${n.skin.toLowerCase()}`,
    })),
  },
  {
    slug: "home", title: "flow — AI Business Operating System", key: "features",
    heading: "Everything else you'd normally stitch together",
    subheading: "One shared core, so nothing gets out of sync between tools.",
    items: [
      { title: "Basic quotes & proposals", body: "A quick line-item quote, or a full proposal with intro and scope of work." },
      { title: "Product catalog & migration", body: "Build your catalog once, or bring your list over from Zoho, QuickBooks, FreshBooks, Wave, or Xero." },
      { title: "Pipeline & recurring billing", body: "A real deal board plus standing subscriptions that auto-generate invoices on schedule." },
      { title: "AI drafts, you approve", body: "The AI drafts every follow-up with its reasoning shown — nothing sends without your OK." },
      { title: "Booking page & photo proof", body: "A public link for appointments, and photo proof of delivery or install on the customer portal." },
      { title: "Customer portal & e-signatures", body: "Send a link, no login needed — quote acceptance with a legally-verifiable audit trail." },
    ],
  },
  {
    slug: "home", title: "flow — AI Business Operating System", key: "ai_section",
    heading: "Built AI-first, with you always in the loop",
    body: "The AI doesn't sit in a chat sidebar, and it never sends a customer-facing message on its own — it watches every quote and invoice, drafts a context-aware follow-up, and waits for your OK before anything reaches a customer.",
  },
  {
    slug: "home", title: "flow — AI Business Operating System", key: "cta",
    heading: "Ready to stop losing revenue to silence?",
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
    subheading: "How SMEs across seven industries use flow to stop losing revenue to silence.",
  },
  {
    slug: "case-studies", title: "Case Studies", key: "cases",
    items: [
      { title: "Solar installer, Services", body: "Cut quote-to-cash time in half by moving off spreadsheets onto flow's pipeline and e-signature portal." },
      { title: "Wholesale distributor", body: "Connected directly to three retail partners — orders flow straight into the pipeline, no re-keying." },
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
    heading: "Why SMEs pick flow",
    subheading: "Everything a GoHighLevel/ClickUp/Monday/Zoho stack does for you — in one place, at SME pricing.",
  },
  {
    slug: "benefits", title: "Benefits", key: "benefits_grid",
    items: [
      { title: "One shared engine", body: "Party/Item/Transaction/Event — no syncing between five different tools." },
      { title: "AI that's actually trustworthy", body: "Every AI action is reviewable and reversible, nothing sends without approval." },
      { title: "No lock-in", body: "One-click CSV export any time — leave whenever you want." },
      { title: "Built for your industry", body: "Seven industry skins, chosen once at signup, tailored vocabulary and pipeline." },
    ],
  },
  {
    slug: "benefits", title: "Benefits", key: "stats",
    items: [
      { title: "7", body: "industries supported out of the box" },
      { title: "1", body: "shared data model, zero sync issues" },
      { title: "0", body: "lock-in — export everything, any time" },
    ],
  },
  {
    slug: "benefits", title: "Benefits", key: "cta",
    heading: "Try flow free",
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
];

function industryCopy(skin: NicheSkin): SectionSeed[] {
  const config = NICHE_CONFIGS[skin];
  const slug = industrySlug(skin);
  const title = `flow for ${config.label}`;
  return [
    {
      slug, title, key: "hero",
      heading: `flow for ${config.label}`,
      subheading: config.tagline,
      ctaLabel: "Get Started Free", ctaHref: "/signup",
    },
    {
      slug, title, key: "pain_points",
      heading: `Built around how ${config.label.toLowerCase()} businesses actually work`,
      subheading: `Your ${config.customerLabel.toLowerCase()}s, quotes, and jobs — one pipeline, no spreadsheets.`,
      items: [
        { title: "No more chasing by memory", body: `Every ${config.customerLabel.toLowerCase()} and every open quote tracked in one place.` },
        { title: `${config.customerLabel} portal`, body: "A link your customer can open with no login — view, sign, pay." },
        { title: "AI follow-ups, you approve", body: "Nothing reaches a customer without your OK." },
      ],
    },
    {
      slug, title, key: "testimonials",
      heading: `What ${config.label.toLowerCase()} owners say`,
      items: [],
    },
    {
      slug, title, key: "cta",
      heading: `Run your ${config.label.toLowerCase()} business on flow`,
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
