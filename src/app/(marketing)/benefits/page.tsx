import type { Metadata } from "next";
import Link from "next/link";
import { PricingTeaser } from "@/components/marketing/chrome";
import { NICHE_CONFIGS } from "@/lib/niches/config";
import { FEATURE_CATEGORIES, allFeatures } from "@/lib/marketing/features";

export const metadata: Metadata = {
  title: "Why flow — everything a nine-tool stack does, minus the nine subscriptions",
  description:
    "One ledger, one customer record, one team. The reasons a business changes software, and the honest limits of each of them.",
};

const VARIANTS = ["card-light", "card-dark", "card-accent", "card-accent2"] as const;

// Each of these is a claim the codebase can actually stand behind. The one
// that used to say "one-click CSV export of your entire business, any time"
// was removed: there is deliberately no offboarding flow, because SARS
// requires five years of invoice retention and an export that quietly
// stopped at a page would be worse than none. What exists is the honest
// version, and it is stated as such below.
const BENEFITS = [
  {
    title: "Nothing has to be reconciled between two tools that disagree",
    body:
      "Customers, quotes, invoices, stock, staff, jobs, deliveries and expenses are one data model. A price changes once. A customer's name changes once. There is no sync, because there is nothing to sync.",
  },
  {
    title: "The AI cannot do the thing you would not forgive",
    body:
      "Three autonomy settings, and none of them lets money move or a customer be contacted without a person. That is enforced in code from the tool's own classification — never from what the model says about itself.",
  },
  {
    title: "Your books are already right when the deadline arrives",
    body:
      "A real double-entry ledger underneath, not documents in a folder. The tax return is a report rather than a fortnight spent rebuilding a year from bank statements.",
  },
  {
    title: "Your data comes with you if you leave",
    body:
      "An owner can close the account: type the business name, wait a week, and be offered a complete copy of every table the workspace owns. There is no quiet deletion and no support ticket — but nor is there a pretend one-click export, because five years of invoice retention is a legal obligation, not a setting.",
  },
  {
    title: "It already knows what your trade watches",
    body:
      `${Object.keys(NICHE_CONFIGS).length} industry packs. A logistics operation watches empty running; a retailer watches stock turn. A pack changes which findings rank first, which accounts the chart starts with, and what each officer says it is watching. Nothing is switched off — a retailer with a delivery van still hears about the van.`,
  },
  {
    title: "Proof exists before there is an argument",
    body:
      "Geotagged, timestamped, person-attributed evidence captured as work happens. Signed quotes, delivery proof, site photos and certificates — so a business stops discounting invoices to keep relationships.",
  },
  {
    title: "It works where the signal does not",
    body:
      "A rep loses the network between the third shop and the eleventh. Every field action is written to a queue with a key the phone generated, so a retry never does the thing twice — which is the entire failure mode of working offline.",
  },
  {
    title: "It is built for how trade actually works here",
    body:
      "The phone number as identity. The credit notebook as a real ledger. Landmark directions instead of a street address nobody uses. Cash in a rider's bag treated like a till. Load shedding modelled, because it shapes the working day and no imported system has ever heard of it.",
  },
  {
    title: "One price, not nine",
    body:
      "A business buying the competition assembles nine subscriptions and seven integrations, and the data never joins up — which is exactly why nobody can benchmark them, cost their jobs properly or tell them what their peers pay.",
  },
];

export default function BenefitsPage() {
  const totalFeatures = allFeatures().length;

  return (
    <>
      <div className="hero-wrap">
        <div className="field">
          <div className="blob b1" />
          <div className="blob b2" />
        </div>
        <div className="wrap" style={{ paddingBottom: 40 }}>
          <section className="hero hero-centered">
            <h1>
              Everything a nine-tool stack does,{" "}
              <span className="grad-text">minus the nine subscriptions</span>
            </h1>
            <p className="sub">
              skynat.ai replaces the spreadsheet, the WhatsApp thread, the invoicing app, the
              separate CRM, the payroll service, the stock sheet and the notebook of expense slips
              &mdash; with one system that actually talks to itself.
            </p>
            <div className="cta-row">
              <a className="cta-primary" href="/signup">
                Start free trial &rarr;
              </a>
              <Link className="cta-secondary" href="/features">
                See all {totalFeatures} things it does
              </Link>
            </div>
          </section>
        </div>
      </div>

      <section className="section">
        <div className="feature-grid">
          {BENEFITS.map((b, i) => {
            const variant = VARIANTS[i % VARIANTS.length];
            return (
              <div key={b.title} className={`feature-card scatter-card ${variant}`}>
                <h3>{b.title}</h3>
                <p className={variant === "card-light" ? "" : "muted"}>{b.body}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="kicker">In detail</span>
          <h2>Twelve areas, {totalFeatures} things</h2>
          <p className="section-sub">
            Each one written as what it does for your business, with the mechanism underneath and
            the honest limits where there are any.
          </p>
        </div>
        <div className="logo-grid">
          {FEATURE_CATEGORIES.map((c, i) => (
            <Link
              key={c.slug}
              href={`/features/${c.slug}`}
              className={`logo-chip scatter-card ${VARIANTS[i % VARIANTS.length]}`}
              style={{ textDecoration: "none" }}
            >
              <p style={{ margin: 0 }}>{c.label}</p>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.75rem", fontWeight: 600 }}>
                {c.features.length} things
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="how-row">
          <div className="how-step">
            <p style={{ fontFamily: "var(--font-display, Fraunces, serif)", fontSize: "3rem", fontWeight: 500, margin: 0, color: "var(--a-2)" }}>
              {Object.keys(NICHE_CONFIGS).length}
            </p>
            <p style={{ marginTop: 8, color: "var(--ink-dim)", fontSize: "0.92rem" }}>
              industries supported out of the box, each with its own vocabulary, pipeline and
              priorities
            </p>
          </div>
          <div className="how-step">
            <p style={{ fontFamily: "var(--font-display, Fraunces, serif)", fontSize: "3rem", fontWeight: 500, margin: 0, color: "var(--a-2)" }}>
              1
            </p>
            <p style={{ marginTop: 8, color: "var(--ink-dim)", fontSize: "0.92rem" }}>
              shared data model &mdash; zero sync issues between the tools you use every day
            </p>
          </div>
          <div className="how-step">
            <p style={{ fontFamily: "var(--font-display, Fraunces, serif)", fontSize: "3rem", fontWeight: 500, margin: 0, color: "var(--a-2)" }}>
              0
            </p>
            <p style={{ marginTop: 8, color: "var(--ink-dim)", fontSize: "0.92rem" }}>
              money movements or customer messages the AI sends without a person seeing them first
            </p>
          </div>
        </div>
      </section>

      <section className="cta-band">
        <div className="cta-band-inner">
          <h2>See what a week without the busywork feels like</h2>
          <p>Free to start, no credit card, and your workspace is ready in minutes.</p>
          <a className="cta-primary cta-band-btn" href="/signup">
            Start free trial &rarr;
          </a>
        </div>
      </section>

      <PricingTeaser />
    </>
  );
}
