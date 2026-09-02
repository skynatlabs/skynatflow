import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NicheSkin } from "@prisma/client";
import { NICHE_CONFIGS, NicheConfig } from "@/lib/niches/config";
import { PricingTeaser, FULL_ENGINE_FEATURES } from "@/components/marketing/chrome";

function resolveSkin(param: string): NicheSkin | null {
  const upper = param.toUpperCase();
  return upper in NICHE_CONFIGS ? (upper as NicheSkin) : null;
}

// Real per-niche copy, not fabricated claims — each line describes an
// actual capability the engine has (see src/lib/core/*), keyed to the
// niche's own `emphasizes` list from config.ts.
const EMPHASIS_COPY: Record<NicheConfig["emphasizes"][number], { title: string; body: string }> = {
  quoting: { title: "Quote to cash, tracked", body: "Every quote's status — sent, viewed, accepted, paid — updated automatically, no manual follow-up spreadsheet." },
  inventory: { title: "Inventory that flags itself", body: "Demand heatmap and reorder points surface before you run out, not after a customer asks." },
  delivery: { title: "Proof of delivery, built in", body: "Photo or signature proof required before a delivery can even be logged — disputes become a non-issue." },
  wholesale: { title: "Tiered pricing & self-ordering", body: "Retail partners order directly with the pricing tier they're on — no re-keying, no pricing mistakes." },
  appointments: { title: "Appointments that keep themselves", body: "Automated WhatsApp reminders cut no-shows before they cost you a slot." },
  subscriptions: { title: "Recurring revenue, tracked", body: "Subscription and repeat-order billing runs on the same engine as one-off invoices." },
  membership: { title: "Membership & donor tracking", body: "Members, donors, and their giving history live on the same contact record as everything else." },
};

const VARIANTS = ["card-light", "card-dark", "card-accent", "card-accent2"] as const;

export async function generateMetadata({ params }: { params: Promise<{ skin: string }> }): Promise<Metadata> {
  const skin = resolveSkin((await params).skin);
  if (!skin) return {};
  const config = NICHE_CONFIGS[skin];
  return { title: `flow for ${config.label}`, description: config.tagline };
}

export default async function IndustryPage({ params }: { params: Promise<{ skin: string }> }) {
  const skin = resolveSkin((await params).skin);
  if (!skin) notFound();
  const config = NICHE_CONFIGS[skin];

  return (
    <>
      <div className="hero-wrap">
        <div className="field">
          <div className="blob b1" />
          <div className="blob b2" />
        </div>
        <div className="wrap" style={{ paddingBottom: 40 }}>
          <section className="hero hero-centered">
            <span className="eyebrow">
              <span className="dot" />
              Built for {config.label.toLowerCase()}
            </span>
            <h1>{config.tagline}</h1>
            <p className="sub">
              Same flow engine, tuned for how {config.label.toLowerCase()} actually works — your{" "}
              {config.customerLabel.toLowerCase()}s, your pipeline stages, your vocabulary.
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
          <span className="kicker">Your pipeline, out of the box</span>
          <h2>
            Every {config.customerLabel.toLowerCase()} moves through these stages — no setup required
          </h2>
        </div>
        <div className="how-row" style={{ gap: 24 }}>
          {config.pipeline.map((stage, i) => (
            <div key={stage.key} className="how-step" style={{ width: "auto" }}>
              <div className="how-num" style={{ background: i % 2 === 0 ? "var(--a-2)" : "var(--mint)" }}>
                {i + 1}
              </div>
              <h3>{stage.label}</h3>
            </div>
          ))}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="kicker">What&apos;s tuned for you</span>
          <h2>Built for {config.label.toLowerCase()}, not bolted on</h2>
        </div>
        <div className="feature-grid">
          {config.emphasizes.map((key, i) => {
            const copy = EMPHASIS_COPY[key];
            const variant = VARIANTS[i % VARIANTS.length];
            return (
              <div key={key} className={`feature-card scatter-card ${variant}`}>
                <h3>{copy.title}</h3>
                <p className={variant === "card-light" ? "" : "muted"}>{copy.body}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <span className="kicker">The full engine</span>
          <h2>Everything else you get, out of the box</h2>
          <p className="section-sub">
            Beyond what&apos;s tuned specifically for {config.label.toLowerCase()}, every flow workspace
            includes the same AI PA, voice assistant, and core toolset.
          </p>
        </div>
        <div className="feature-grid">
          {FULL_ENGINE_FEATURES.map((f, i) => {
            const variant = VARIANTS[i % VARIANTS.length];
            return (
              <div key={f.title} className={`feature-card scatter-card ${variant}`}>
                <div className="feature-icon" style={{ background: variant === "card-light" ? "var(--a-2)" : "rgba(255,255,255,0.16)" }}>
                  {f.icon}
                </div>
                <h3>{f.title}</h3>
                <p className={variant === "card-light" ? "" : "muted"}>{f.body}</p>
              </div>
            );
          })}
        </div>
      </section>

      <section className="cta-band">
        <div className="cta-band-inner">
          <h2>See flow set up for {config.label.toLowerCase()}</h2>
          <p>Free to start, no credit card required.</p>
          <a className="cta-primary cta-band-btn" href="/signup">
            Start free trial &rarr;
          </a>
        </div>
      </section>

      <PricingTeaser />
    </>
  );
}
