import type { Metadata } from "next";
import { PricingTeaser } from "@/components/marketing/chrome";

export const metadata: Metadata = {
  title: "About — flow",
  description: "Built by Skynat, for businesses that run on hustle, not headcount.",
};

const BELIEFS = [
  { title: "Easy to use, always", body: "If a feature needs a training video, it's not done yet.", variant: "card-light" as const },
  { title: "AI that acts, with you in the loop", body: "Automation you can trust because you approve every customer-facing message.", variant: "card-dark" as const },
  { title: "No lock-in", body: "One-click CSV export of your whole business, any time.", variant: "card-accent" as const },
];

export default function AboutPage() {
  return (
    <>
      <div className="hero-wrap">
        <div className="field">
          <div className="blob b1" />
          <div className="blob b3" />
        </div>
        <div className="wrap" style={{ paddingBottom: 40 }}>
          <section className="hero hero-centered">
            <h1>
              Built by Skynat, for businesses that run on <span className="grad-text">hustle</span>, not
              headcount
            </h1>
            <p className="sub">We build the software an SME owner actually wants to open every morning.</p>
          </section>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <span className="kicker">Why flow exists</span>
          <h2>One shared engine, not enterprise complexity trimmed down</h2>
        </div>
        <p style={{ maxWidth: 680, margin: "0 auto", color: "var(--ink-dim)", fontSize: "1.05rem", lineHeight: 1.7, textAlign: "center" }}>
          Most business software is built for enterprises and trimmed down for small businesses — which
          means small businesses inherit enterprise complexity without enterprise headcount to manage it.
          flow starts from the opposite direction: one shared engine, seven industry skins, and an AI layer
          that does the chasing so you don&apos;t have to.
        </p>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="kicker">What we believe</span>
          <h2>Three things we won&apos;t compromise on</h2>
        </div>
        <div className="feature-grid">
          {BELIEFS.map((b) => (
            <div key={b.title} className={`feature-card scatter-card ${b.variant}`}>
              <h3>{b.title}</h3>
              <p className={b.variant === "card-light" ? "" : "muted"}>{b.body}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="cta-band">
        <div className="cta-band-inner">
          <h2>Come run your business on flow</h2>
          <a className="cta-primary cta-band-btn" href="/signup">
            Start free trial &rarr;
          </a>
        </div>
      </section>

      <PricingTeaser />
    </>
  );
}
