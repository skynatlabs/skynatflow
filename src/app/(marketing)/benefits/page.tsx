import type { Metadata } from "next";
import { PricingTeaser } from "@/components/marketing/chrome";

export const metadata: Metadata = {
  title: "Benefits — flow",
  description: "Everything a five-tool stack does for you, minus the five subscriptions.",
};

const VARIANTS = ["card-light", "card-dark", "card-accent", "card-accent2"] as const;

const BENEFITS = [
  { title: "One shared engine, not five disconnected tools", body: "Customers, quotes, invoices, inventory, staff, and expenses live in one data model — nothing to manually reconcile between systems." },
  { title: "AI that's actually trustworthy", body: "Every AI action — a follow-up, an abandoned-quote nudge, a fuel anomaly flag — is reviewable with its reasoning shown. Nothing reaches a customer without your approval." },
  { title: "No lock-in, ever", body: "One-click CSV export of your entire business, any time, no support ticket required." },
  { title: "Built for your industry from day one", body: "Seven industry skins — pick yours once at signup and the vocabulary, pipeline stages, and relevant tools reconfigure automatically." },
  { title: "Proof that protects your revenue", body: "E-signature audit trails, mandatory delivery photos, and structured claim/dispute tracking mean nothing important lives only in someone's memory." },
  { title: "Your whole team, not just your pipeline", body: "Org chart, goals, expenses, clock-in/out, and in-app messaging — run the business, not just the sales funnel." },
  { title: "Grows with you, SME to enterprise", body: "The same engine that runs a one-person operation scales to multi-location teams with real org hierarchy and role-based permissions." },
  { title: "Tax-ready by default", body: "A structured VAT/sales-tax export — US and SARS-shaped — generated from data that was already clean, not reconstructed under deadline pressure." },
];

const STATS = [
  { n: "7", label: "industries supported out of the box, each with tailored vocabulary and workflow" },
  { n: "1", label: "shared data model — zero sync issues between the tools you use daily" },
  { n: "0", label: "lock-in — export everything, any time, no questions asked" },
];

export default function BenefitsPage() {
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
              Everything a five-tool stack does for you, <span className="grad-text">minus the five subscriptions</span>
            </h1>
            <p className="sub">
              flow replaces the spreadsheet, the WhatsApp thread, the separate invoicing app, the separate
              CRM, and the notebook of expense slips — with one system that actually talks to itself.
            </p>
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
        <div className="how-row">
          {STATS.map((s) => (
            <div key={s.label} className="how-step">
              <p style={{ fontFamily: "var(--font-display, Fraunces, serif)", fontSize: "3rem", fontWeight: 500, margin: 0, color: "var(--a-2)" }}>
                {s.n}
              </p>
              <p style={{ marginTop: 8, color: "var(--ink-dim)", fontSize: "0.92rem" }}>{s.label}</p>
            </div>
          ))}
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
