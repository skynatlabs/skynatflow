import type { Metadata } from "next";
import { PRICING_PLANS, TRIAL_DAYS } from "@/lib/marketing/pricing";

export const metadata: Metadata = {
  title: "Pricing — flow",
  description: "Simple pricing, no five-figure implementation fee. 14 days free, then pick a plan that fits.",
};

const FAQS = [
  {
    q: "Is there a contract?",
    a: "No. No multi-year lock-in, no cancellation penalty — the opposite of what some field-service platforms are known for.",
  },
  {
    q: "What happens to my data if I downgrade or leave?",
    a: "It's always yours. One-click CSV export of everything, any time, whether you're upgrading, downgrading, or leaving entirely.",
  },
  {
    q: "Do I need a credit card to try it?",
    a: "No. Sign up, set up your workspace, and start using it — no card required during the trial.",
  },
];

export default function PricingPage() {
  return (
    <>
      <div className="hero-wrap">
        <div className="field">
          <div className="blob b1" />
          <div className="blob b2" />
        </div>
        <div className="wrap" style={{ paddingBottom: 40 }}>
          <section className="hero hero-centered">
            <h1>Simple pricing, no five-figure implementation fee</h1>
            <p className="sub">
              {TRIAL_DAYS} days free, no credit card required. Pick a plan when you&apos;re ready to grow —
              not before.
            </p>
            <div className="cta-row">
              <a className="cta-primary" href="/signup">
                Start free trial &rarr;
              </a>
            </div>
          </section>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <span className="kicker">Plans</span>
          <h2>Three plans, no surprise tiers hiding basic features</h2>
        </div>
        <div className="pricing-row">
          {PRICING_PLANS.map((plan) => {
            const isFeatured = plan.id === "growth";
            const isDark = plan.id === "enterprise";
            const variant = isFeatured ? "card-accent" : isDark ? "card-dark" : "card-outline";
            const mutedClass = variant === "card-outline" ? "" : "muted";
            return (
              <div
                key={plan.id}
                className={`price-card scatter-card ${variant} ${isFeatured ? "price-featured" : ""}`}
              >
                <p className="price-tier">{plan.name}</p>
                <p className="price-amount">
                  {plan.price}
                  {plan.id !== "enterprise" && <span style={{ fontSize: "0.9rem", opacity: 0.7 }}>/mo</span>}
                </p>
                <p className={`price-desc ${mutedClass}`}>{plan.priceNote}</p>
                <p className={`price-desc ${mutedClass}`} style={{ marginTop: 12 }}>
                  {plan.description}
                </p>
                <ul style={{ marginTop: 16, paddingLeft: 0, listStyle: "none", fontSize: "0.88rem", lineHeight: 1.7 }}>
                  {plan.features.map((f) => (
                    <li key={f}>&#10003; {f}</li>
                  ))}
                </ul>
                {plan.extraSeatPrice && (
                  <p className={`price-desc ${mutedClass}`} style={{ marginTop: 12 }}>
                    Extra seats: {plan.extraSeatPrice}
                  </p>
                )}
                <div style={{ marginTop: 20 }}>
                  <a
                    href={plan.ctaHref}
                    className="cta-primary"
                    style={
                      isFeatured
                        ? { background: "white", color: "var(--a)" }
                        : isDark
                          ? { background: "white", color: "var(--ink)" }
                          : undefined
                    }
                  >
                    {plan.ctaLabel} &rarr;
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      <section className="section">
        <div className="testimonial scatter-card card-light">
          <span className="kicker">The math that actually matters</span>
          <p className="testimonial-body" style={{ fontSize: "1.15rem" }}>
            If flow catches just one overdue invoice before it&apos;s written off, or recovers one abandoned
            quote that would&apos;ve gone cold, it&apos;s already paid for itself for the month. Everything
            else — the time saved not re-entering data across five tools — is the part that compounds.
          </p>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="kicker">Pricing questions</span>
          <h2>Straight answers</h2>
        </div>
        <div className="faq-grid">
          {FAQS.map((f, i) => (
            <div key={f.q} className={`faq-card scatter-card ${i % 2 === 0 ? "card-light" : "card-dark"}`}>
              <h3>&ldquo;{f.q}&rdquo;</h3>
              <p className={i % 2 === 0 ? "" : "muted"}>{f.a}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="cta-band">
        <div className="cta-band-inner">
          <h2>Start free, upgrade when it&apos;s actually paying for itself</h2>
          <a className="cta-primary cta-band-btn" href="/signup">
            Start free trial &rarr;
          </a>
        </div>
      </section>
    </>
  );
}
