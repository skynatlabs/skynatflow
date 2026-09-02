import type { Metadata } from "next";
import { PricingTeaser } from "@/components/marketing/chrome";

export const metadata: Metadata = {
  title: "Customer Stories — flow",
  description: "Real businesses, real results — how SMEs across seven industries use flow.",
};

const VARIANTS = ["card-light", "card-accent", "card-dark", "card-accent2", "card-light", "card-dark"] as const;

const STORIES = [
  { title: "Solar installer, Services", body: "Cut quote-to-cash time in half by moving off spreadsheets onto flow's pipeline and e-signature portal — and killed the “where's my installer” complaints with mandatory photo proof on every job." },
  { title: "Wholesale distributor", body: "Connected directly to three retail partners with self-service ordering and tiered pricing — orders flow straight into the pipeline, no re-keying, no pricing mistakes." },
  { title: "Multi-branch retailer", body: "Replaced a weekend-long manual stocktake with flow's demand heatmap and shrinkage variance report — dead stock identified and cleared before it became a total write-off." },
  { title: "Small medical practice", body: "No-show rate dropped after switching on flow's automated 48h and 2h WhatsApp appointment reminders — and stopped writing off denied insurance claims with the aging-denial queue." },
  { title: "Independent logistics operator", body: "Every delivery now requires photo or signature proof before it can even be logged — disputed deliveries and rejected invoices became a non-issue almost overnight." },
  { title: "Boutique professional services firm", body: "Replaced a spreadsheet of overdue invoices with flow's automatic aging dashboard and one-click late fee — cut days-sales-outstanding without a single awkward phone call." },
];

export default function CaseStudiesPage() {
  return (
    <>
      <div className="hero-wrap">
        <div className="field">
          <div className="blob b1" />
          <div className="blob b2" />
          <div className="blob b3" />
        </div>
        <div className="wrap" style={{ paddingBottom: 40 }}>
          <section className="hero hero-centered">
            <h1>
              Real businesses, <span className="grad-text">real results</span>
            </h1>
            <p className="sub">
              How SMEs across seven industries use flow to stop losing revenue to silence — and start
              running on one system instead of five.
            </p>
          </section>
        </div>
      </div>

      <section className="section">
        <div className="feature-grid">
          {STORIES.map((s, i) => {
            const variant = VARIANTS[i % VARIANTS.length];
            return (
              <div key={s.title} className={`feature-card scatter-card ${variant}`}>
                <h3>{s.title}</h3>
                <p className={variant === "card-light" ? "" : "muted"}>{s.body}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="cta-band">
        <div className="cta-band-inner">
          <h2>Be the next case study</h2>
          <a className="cta-primary cta-band-btn" href="/signup">
            Start free trial &rarr;
          </a>
        </div>
      </section>

      <PricingTeaser />
    </>
  );
}
