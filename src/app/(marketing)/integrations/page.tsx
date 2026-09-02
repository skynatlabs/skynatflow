import type { Metadata } from "next";
import { PricingTeaser } from "@/components/marketing/chrome";

export const metadata: Metadata = {
  title: "Integrations — flow",
  description: "Connects with the tools you already use. Migrate in from your old system, and connect the tools you're keeping.",
};

const VARIANTS = ["card-light", "card-dark", "card-accent", "card-accent2"] as const;

const INTEGRATIONS = [
  { title: "WhatsApp Business", status: "Live" },
  { title: "Zoho Invoice", status: "CSV import" },
  { title: "QuickBooks", status: "CSV import" },
  { title: "FreshBooks", status: "CSV import" },
  { title: "Wave", status: "CSV import" },
  { title: "Xero", status: "Two-way sync — coming soon" },
  { title: "Google Calendar", status: "Coming soon" },
  { title: "Zapier", status: "Coming soon" },
];

export default function IntegrationsPage() {
  return (
    <>
      <div className="hero-wrap">
        <div className="field">
          <div className="blob b2" />
          <div className="blob b3" />
        </div>
        <div className="wrap" style={{ paddingBottom: 40 }}>
          <section className="hero hero-centered">
            <h1>
              Connects with the tools <span className="grad-text">you already use</span>
            </h1>
            <p className="sub">Migrate in from your old system, and connect the tools you&apos;re keeping.</p>
          </section>
        </div>
      </div>

      <section className="section">
        <div className="logo-grid">
          {INTEGRATIONS.map((it, i) => (
            <div key={it.title} className={`logo-chip scatter-card ${VARIANTS[i % VARIANTS.length]}`}>
              <p style={{ margin: 0 }}>{it.title}</p>
              <p className="muted" style={{ margin: "4px 0 0", fontSize: "0.75rem", fontWeight: 600 }}>
                {it.status}
              </p>
            </div>
          ))}
        </div>
      </section>

      <section className="cta-band">
        <div className="cta-band-inner">
          <h2>Bring your business over</h2>
          <a className="cta-primary cta-band-btn" href="/signup">
            Start free trial &rarr;
          </a>
        </div>
      </section>

      <PricingTeaser />
    </>
  );
}
