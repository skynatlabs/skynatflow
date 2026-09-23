import type { Metadata } from "next";
import Link from "next/link";
import { PricingTeaser } from "@/components/marketing/chrome";
import { FEATURE_CATEGORIES, allFeatures } from "@/lib/marketing/features";

export const metadata: Metadata = {
  title: "Everything skynat.ai does — features by what they do for you",
  description:
    "Twelve areas, over a hundred and thirty things the engine does, each written as what it does for your business rather than what it is called.",
};

const VARIANTS = ["card-light", "card-dark", "card-accent", "card-accent2"] as const;

export default function FeaturesIndexPage() {
  const total = allFeatures().length;

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
              {total} things it does, <span className="grad-text">written as what they do for you</span>
            </h1>
            <p className="sub">
              A feature name tells you nothing you did not already know you lacked. So every line
              below is the reason a business would change software, and the mechanism underneath
              it &mdash; including, plainly, the things that need an account of your own before
              they will work.
            </p>
          </section>
        </div>
      </div>

      <section className="section">
        <div className="section-head">
          <span className="kicker">The whole engine</span>
          <h2>Twelve areas, one system underneath</h2>
          <p className="section-sub">
            Nothing here is a separate product with a separate subscription. They are the same
            ledger, the same customer record and the same team, read from twelve angles.
          </p>
        </div>

        <div className="feature-grid">
          {FEATURE_CATEGORIES.map((category, i) => {
            const variant = VARIANTS[i % VARIANTS.length];
            return (
              <Link
                key={category.slug}
                href={`/features/${category.slug}`}
                className={`feature-card scatter-card ${variant}`}
                style={{ textDecoration: "none", display: "block" }}
              >
                <h3>{category.label}</h3>
                <p className={variant === "card-light" ? "" : "muted"}>{category.teaser}</p>
                <p
                  className={variant === "card-light" ? "" : "muted"}
                  style={{ marginTop: 14, fontSize: "0.78rem", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}
                >
                  {category.features.length} things &rarr;
                </p>
              </Link>
            );
          })}
        </div>
      </section>

      <section className="section">
        <div className="how-row">
          <div className="how-step">
            <p style={{ fontFamily: "var(--font-display, Fraunces, serif)", fontSize: "3rem", fontWeight: 500, margin: 0, color: "var(--a-2)" }}>
              1
            </p>
            <p style={{ marginTop: 8, color: "var(--ink-dim)", fontSize: "0.92rem" }}>
              ledger underneath all of it, so nothing has to be reconciled between two tools that
              disagree
            </p>
          </div>
          <div className="how-step">
            <p style={{ fontFamily: "var(--font-display, Fraunces, serif)", fontSize: "3rem", fontWeight: 500, margin: 0, color: "var(--a-2)" }}>
              0
            </p>
            <p style={{ marginTop: 8, color: "var(--ink-dim)", fontSize: "0.92rem" }}>
              money movements or customer messages the AI can send without a person &mdash; at any
              autonomy setting
            </p>
          </div>
          <div className="how-step">
            <p style={{ fontFamily: "var(--font-display, Fraunces, serif)", fontSize: "3rem", fontWeight: 500, margin: 0, color: "var(--a-2)" }}>
              {FEATURE_CATEGORIES.length}
            </p>
            <p style={{ marginTop: 8, color: "var(--ink-dim)", fontSize: "0.92rem" }}>
              areas covered, from the till to the tax return, on one subscription
            </p>
          </div>
        </div>
      </section>

      <section className="cta-band">
        <div className="cta-band-inner">
          <h2>See it against your own numbers</h2>
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
