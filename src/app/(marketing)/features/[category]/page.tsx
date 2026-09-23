import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { PricingTeaser } from "@/components/marketing/chrome";
import { FEATURE_CATEGORIES, categoryBySlug } from "@/lib/marketing/features";

// Pre-rendered: the catalogue is a constant, so there is no reason for any
// of these to be worked out per request.
export function generateStaticParams() {
  return FEATURE_CATEGORIES.map((c) => ({ category: c.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ category: string }>;
}): Promise<Metadata> {
  const category = categoryBySlug((await params).category);
  if (!category) return {};
  return {
    title: `${category.headline} ${category.headlineAccent} — skynat.ai`,
    description: category.teaser,
  };
}

const VARIANTS = ["card-light", "card-dark", "card-accent", "card-accent2"] as const;

export default async function FeatureCategoryPage({
  params,
}: {
  params: Promise<{ category: string }>;
}) {
  const category = categoryBySlug((await params).category);
  if (!category) notFound();

  const others = FEATURE_CATEGORIES.filter((c) => c.slug !== category.slug);

  return (
    <>
      <div className="hero-wrap">
        <div className="field">
          <div className="blob b1" />
          <div className="blob b3" />
        </div>
        <div className="wrap" style={{ paddingBottom: 40 }}>
          <section className="hero hero-centered">
            <span className="kicker">{category.label}</span>
            <h1>
              {category.headline} <span className="grad-text">{category.headlineAccent}</span>
            </h1>
            <p className="sub">{category.standfirst}</p>
          </section>
        </div>
      </div>

      {/* The thesis. One sentence naming the problem the whole category removes. */}
      <section className="section">
        <div className="testimonial scatter-card card-dark">
          <span className="quote-mark" aria-hidden>
            &ldquo;
          </span>
          <p className="testimonial-body">{category.thesis}</p>
        </div>
      </section>

      {category.proof && (
        <section className="section">
          <div className="how-row">
            {category.proof.map((stat) => (
              <div key={stat.label} className="how-step">
                <p
                  style={{
                    fontFamily: "var(--font-display, Fraunces, serif)",
                    fontSize: "2.6rem",
                    fontWeight: 500,
                    margin: 0,
                    color: "var(--a-2)",
                  }}
                >
                  {stat.n}
                </p>
                <p style={{ marginTop: 8, color: "var(--ink-dim)", fontSize: "0.92rem" }}>
                  {stat.label}
                </p>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="section">
        <div className="section-head">
          <span className="kicker">In detail</span>
          <h2>
            {category.features.length} things, and what each one is for
          </h2>
          <p className="section-sub">
            Where something needs an account of your own before it will work, it says so. A page
            that promises an integration nobody can switch on is the fastest way to lose the
            second month of a subscription.
          </p>
        </div>

        <div className="feature-grid">
          {category.features.map((feature, i) => {
            const variant = VARIANTS[i % VARIANTS.length];
            const dim = variant === "card-light" ? "" : "muted";
            return (
              <div key={feature.name} className={`feature-card scatter-card ${variant}`}>
                <p
                  className={dim}
                  style={{
                    margin: 0,
                    fontSize: "0.72rem",
                    fontWeight: 700,
                    letterSpacing: "0.09em",
                    textTransform: "uppercase",
                    opacity: 0.75,
                  }}
                >
                  {feature.name}
                </p>
                <h3 style={{ marginTop: 6 }}>{feature.benefit}</h3>
                <p className={dim}>{feature.how}</p>
                {feature.needs && (
                  <p
                    className={dim}
                    style={{
                      marginTop: 12,
                      paddingTop: 10,
                      borderTop: "1px solid rgba(128,128,128,0.25)",
                      fontSize: "0.82rem",
                      fontStyle: "italic",
                    }}
                  >
                    Needs: {feature.needs}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="kicker">The rest of the engine</span>
          <h2>None of this is a separate subscription</h2>
          <p className="section-sub">
            Same ledger, same customer record, same team &mdash; read from a different angle.
          </p>
        </div>
        <div className="logo-grid">
          {others.map((other, i) => (
            <Link
              key={other.slug}
              href={`/features/${other.slug}`}
              className={`logo-chip scatter-card ${VARIANTS[i % VARIANTS.length]}`}
              style={{ textDecoration: "none" }}
            >
              <p style={{ margin: 0 }}>{other.label}</p>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.75rem", fontWeight: 600 }}>
                {other.features.length} things
              </p>
            </Link>
          ))}
        </div>
      </section>

      <section className="cta-band">
        <div className="cta-band-inner">
          <h2>Try it against your own numbers</h2>
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
