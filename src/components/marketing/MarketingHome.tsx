// The marketing homepage — inspired by ClickUp's bold headlines/product-card
// grid and Monday's colorful gradient pills, built in our own coral/violet/
// navy design system rather than copying either verbatim. Logged-out
// visitors land here instead of straight on /login (see src/app/page.tsx).

import Link from "next/link";
import { NICHE_CONFIGS } from "@/lib/niches/config";
import { FlowMark } from "@/components/FlowMark";
import {
  QuoteIcon,
  BoxIcon,
  SignatureIcon,
  LinkIcon,
  CheckSquareIcon,
  UserCogIcon,
  SparkleIcon,
} from "@/components/icons";

const FEATURES = [
  {
    icon: QuoteIcon,
    tint: "kb-tint-mint",
    title: "Quoting & follow-up",
    body: "Send a quote from WhatsApp or the web, and the AI chases it automatically — no follow-up ever falls through the cracks.",
  },
  {
    icon: BoxIcon,
    tint: "kb-tint-blue",
    title: "End-to-end inventory",
    body: "One stock ledger from purchase to sale — no separate purchasing and POS counts drifting apart.",
  },
  {
    icon: SignatureIcon,
    tint: "kb-tint-violet",
    title: "Customer portal & e-signatures",
    body: "Send a link, no login needed. Your customer views the quote and signs it right there.",
  },
  {
    icon: LinkIcon,
    tint: "kb-tint-yellow",
    title: "Wholesale connections",
    body: "Connect directly to another workspace on the platform — orders flow straight into their pipeline, no re-keying.",
  },
  {
    icon: CheckSquareIcon,
    tint: "kb-tint-peach",
    title: "Team tasks & roles",
    body: "A simple board your team will actually use, with real permissions — not a project-management suite nobody opens.",
  },
  {
    icon: UserCogIcon,
    tint: "kb-tint-mint",
    title: "One login, many businesses",
    body: "Own or work under any number of workspaces with one account — a platform admin can see across all of them.",
  },
];

const inputPillClass =
  "kb-pill kb-pill-ghost text-xs !py-1.5 !px-3 pointer-events-none";

export default function MarketingHome() {
  return (
    <div className="kb-shell min-h-screen" data-theme="light">
      {/* Nav */}
      <header className="sticky top-0 z-10 border-b border-[var(--kb-panel-border)] bg-[var(--kb-bg)]/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-2">
            <FlowMark size={30} />
            <span className="text-lg font-bold text-[var(--kb-text)]">flow</span>
          </div>
          <nav className="hidden items-center gap-8 text-sm font-medium text-[var(--kb-text-dim)] sm:flex">
            <a href="#features" className="hover:text-[var(--kb-text)]">Product</a>
            <a href="#verticals" className="hover:text-[var(--kb-text)]">Verticals</a>
            <a href="#ai" className="hover:text-[var(--kb-text)]">AI</a>
          </nav>
          <div className="flex items-center gap-3">
            <Link href="/login" className="kb-pill kb-pill-ghost">Log in</Link>
            <Link href="/signup" className="kb-pill kb-pill-primary">Get Started &rarr;</Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="mx-auto max-w-6xl px-6 pb-20 pt-20 text-center">
        <span
          className="inline-block rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-wide"
          style={{ background: "var(--kb-tint-violet)", color: "var(--kb-tint-violet-ink)" }}
        >
          AI-native, not AI-added
        </span>
        <h1 className="mx-auto mt-6 max-w-4xl text-5xl font-extrabold leading-[1.05] tracking-tight text-[var(--kb-text)] sm:text-6xl">
          One platform to run your <span className="kb-gradient-text">entire business</span>
        </h1>
        <p className="mx-auto mt-6 max-w-2xl text-lg text-[var(--kb-text-dim)]">
          Quoting, invoicing, inventory, delivery, and a customer portal — on one
          shared engine built for how SMEs actually work, not enterprise
          software trimmed down.
        </p>
        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          <Link href="/signup" className="kb-pill kb-pill-primary !px-6 !py-3 text-sm">
            Get Started Free &rarr;
          </Link>
          <a href="#features" className="kb-pill kb-pill-ghost !px-6 !py-3 text-sm">
            See how it works
          </a>
        </div>
        <p className="mt-4 text-xs text-[var(--kb-text-dim)]">
          No credit card needed &middot; Free for your first workspace
        </p>

        {/* Hero product mockup */}
        <div className="kb-card mx-auto mt-14 max-w-4xl overflow-hidden p-0 text-left">
          <div className="flex items-center gap-2 border-b border-[var(--kb-panel-border)] px-5 py-3">
            <span className="h-2.5 w-2.5 rounded-full bg-red-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-yellow-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-green-300" />
          </div>
          <div className="grid grid-cols-1 gap-4 p-6 sm:grid-cols-3">
            <div className="kb-tile kb-tint-mint sm:col-span-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
                Money owed to you
              </p>
              <p className="mt-1 text-2xl font-extrabold">R85,000</p>
              <p className="mt-1 text-[11px] opacity-70">1 open invoice</p>
            </div>
            <div className="kb-tile kb-tint-peach sm:col-span-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
                Gone quiet
              </p>
              <p className="mt-1 text-2xl font-extrabold">R0</p>
              <p className="mt-1 text-[11px] opacity-70">Nothing needs a follow-up</p>
            </div>
            <div className="kb-tile kb-tint-blue sm:col-span-1">
              <p className="text-[10px] font-semibold uppercase tracking-wide opacity-70">
                Customers
              </p>
              <p className="mt-1 text-2xl font-extrabold">128</p>
              <p className="mt-1 text-[11px] opacity-70">on file</p>
            </div>
            <div className="sm:col-span-3 flex flex-wrap items-center gap-2 pt-1">
              <span className={inputPillClass}>+ New Quote</span>
              <span className={inputPillClass}>Send WhatsApp follow-up</span>
              <span className={inputPillClass}>Customer portal link</span>
            </div>
          </div>
        </div>
      </section>

      {/* Problem / stats */}
      <section className="border-y border-[var(--kb-panel-border)] bg-[var(--kb-panel)] py-20">
        <div className="mx-auto max-w-5xl px-6 text-center">
          <h2 className="text-3xl font-extrabold text-[var(--kb-text)] sm:text-4xl">
            SMEs lose real money to silence
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-[var(--kb-text-dim)]">
            Not because the work isn&apos;t there — because nobody has time to
            chase it consistently.
          </p>
          <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-3">
            <div className="kb-tile kb-tint-violet text-left">
              <p className="text-3xl font-extrabold">56%</p>
              <p className="mt-2 text-sm opacity-80">
                of small businesses are owed money on unpaid invoices right now
              </p>
            </div>
            <div className="kb-tile kb-tint-yellow text-left">
              <p className="text-3xl font-extrabold">10+ hrs</p>
              <p className="mt-2 text-sm opacity-80">
                spent every week manually chasing payments and quotes
              </p>
            </div>
            <div className="kb-tile kb-tint-mint text-left">
              <p className="text-3xl font-extrabold">50&ndash;100%</p>
              <p className="mt-2 text-sm opacity-80">
                higher close rate with consistent follow-up instead of giving up early
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Verticals */}
      <section id="verticals" className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center">
          <h2 className="text-3xl font-extrabold text-[var(--kb-text)] sm:text-4xl">
            One engine, seven skins
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-[var(--kb-text-dim)]">
            Pick your business type at signup — the whole platform reconfigures
            around it. Compare performance across verticals before committing
            to one.
          </p>
        </div>
        <div className="mt-10 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {Object.values(NICHE_CONFIGS).map((n) => (
            <div key={n.skin} className="kb-card p-4">
              <p className="font-semibold text-[var(--kb-text)]">{n.label}</p>
              <p className="mt-1 text-xs text-[var(--kb-text-dim)]">{n.tagline}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Feature grid */}
      <section id="features" className="mx-auto max-w-6xl px-6 py-20">
        <div className="text-center">
          <h2 className="text-3xl font-extrabold text-[var(--kb-text)] sm:text-4xl">
            Everything else you&apos;d normally stitch together
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-[var(--kb-text-dim)]">
            One shared core, so nothing gets out of sync between tools.
          </p>
        </div>
        <div className="mt-10 grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => {
            const Icon = f.icon;
            return (
              <div key={f.title} className={`kb-tile ${f.tint}`}>
                <Icon className="h-7 w-7" />
                <p className="mt-3 text-lg font-bold">{f.title}</p>
                <p className="mt-2 text-sm opacity-80">{f.body}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* AI section — dark, like the reference's Brain² block */}
      <section id="ai" className="py-24" style={{ background: "var(--kb-navy)" }}>
        <div className="mx-auto max-w-4xl px-6 text-center">
          <div className="kb-glossy mx-auto grid h-14 w-14 place-items-center">
            <SparkleIcon className="h-7 w-7 text-white" />
          </div>
          <h2 className="mt-6 text-4xl font-extrabold text-white">
            Built AI-first, not AI-added
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-white/60">
            The AI doesn&apos;t sit in a chat sidebar — it watches your quotes
            and invoices and acts, through the same functions your own team
            uses.
          </p>
          <div className="mt-12 grid grid-cols-1 gap-8 text-left sm:grid-cols-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-white/40">Watches</p>
              <p className="mt-2 text-white">
                Every quote and invoice, tenant-wide — nothing needs to be
                manually flagged.
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-white/40">Drafts</p>
              <p className="mt-2 text-white">
                A genuinely context-aware follow-up message, escalating tone
                as it goes unanswered.
              </p>
            </div>
            <div>
              <p className="text-xs font-bold uppercase tracking-wide text-white/40">Alerts</p>
              <p className="mt-2 text-white">
                You personally the moment a quote is opened twice — a real
                buying signal, not noise.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="mx-auto max-w-4xl px-6 py-24 text-center">
        <h2 className="text-4xl font-extrabold text-[var(--kb-text)]">
          Ready to stop losing revenue to silence?
        </h2>
        <div className="mt-8">
          <Link href="/signup" className="kb-pill kb-pill-primary !px-8 !py-3.5 text-base">
            Get Started Free &rarr;
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-[var(--kb-panel-border)] py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 px-6 text-sm text-[var(--kb-text-dim)] sm:flex-row">
          <div className="flex items-center gap-2">
            <FlowMark size={22} />
            <span className="font-semibold text-[var(--kb-text)]">flow</span>
          </div>
          <p>&copy; {new Date().getFullYear()} Skynat. Built for SMEs, not scaled down from enterprise.</p>
        </div>
      </footer>
    </div>
  );
}
