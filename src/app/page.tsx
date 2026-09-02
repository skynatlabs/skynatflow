import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/auth";
import { MarketingFonts, MarketingNav, MarketingFooterStatic, PricingTeaser, MARKETING_CSS } from "@/components/marketing/chrome";

// The home page — hand-authored raw HTML/CSS matching the approved concept
// mockup exactly, deliberately NOT going through the CMS/React component
// system the rest of the marketing site used to use. That trade-off (no
// admin-editable copy) was made explicitly in favor of full pixel control
// over the design. Shares the same nav/footer/CSS module as every other
// marketing page (see chrome.tsx) — only the hero and unique sections
// below are specific to this page.
export const metadata: Metadata = {
  title: "flow — Quote fast. Get paid faster.",
  description:
    "Quoting, invoicing, follow-ups, and an AI PA that runs the busywork — one AI-native platform for how SMEs actually work. By Skynat.",
};

export default async function Home() {
  const session = await auth();
  if (session?.user?.id) {
    redirect("/dashboard");
  }

  return (
    <div className="mkt">
      <MarketingFonts />
      <style>{MARKETING_CSS}</style>

      <div className="hero-wrap">
        <div className="field">
          <div className="blob b1" />
          <div className="blob b2" />
          <div className="blob b3" />
        </div>

        <MarketingNav />

        <div className="wrap" style={{ paddingTop: 0 }}>
          <section className="hero">
            <div>
              <span className="eyebrow">
                <span className="dot" />
                Built for busy business owners
              </span>
              <h1>
                Quote fast. Get paid faster. Let <em>flow</em> chase the rest.
              </h1>
              <p className="sub">
                One place to quote, invoice, and follow up — with an AI PA that carries out the busywork
                for you, so you can focus on running the business instead of chasing it.
              </p>
              <div className="cta-row">
                <a className="cta-primary" href="/signup">
                  Start free trial &rarr;
                </a>
                <a className="cta-secondary" href="/about">
                  Watch a 2-min demo
                </a>
              </div>
            </div>

            <div className="stage">
              <div className="doc-card">
                <div className="doc-top">
                  <span className="doc-label">Quote #1042</span>
                  <span className="doc-status">Accepted</span>
                </div>
                <div className="doc-amount">R85,000</div>
                <div className="doc-customer">Jane Homeowner · 8kVA solar system</div>
                <div className="doc-wave">
                  {[40, 65, 30, 80, 50, 95, 60, 75, 45].map((h, i) => (
                    <span key={i} style={{ height: `${h}%` }} />
                  ))}
                </div>
              </div>

              <div className="float-card fc-1">
                <div className="fc-label">Collected, 12wk</div>
                <div className="fc-value">R612,400</div>
                <div className="fc-delta">&uarr; 18% vs last period</div>
              </div>

              <div className="float-card fc-2">
                <div className="fc-2-body">
                  <div className="ring" />
                  <div className="fc-2-text">
                    <div className="fc-label">Pipeline won</div>
                    <div className="fc-value">70%</div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>

      {/* ================= LOGOS STRIP ================= */}
      <section className="logos">
        <p className="logos-label">Trusted by trades &amp; service businesses across South Africa</p>
        <div className="logos-row">
          <span>SolarWorks</span>
          <span>Corner Store Co-op</span>
          <span>Fleet Logistics SA</span>
          <span>Family Practice Group</span>
          <span>BulkSupply</span>
        </div>
      </section>

      {/* ================= AI PA — the thing the user explicitly asked not
         to be forgotten: the assistant that carries out tasks so the owner
         can focus on running the business, not the software. ================= */}
      <section className="section" style={{ paddingBottom: 30 }}>
        <div className="section-head">
          <span className="kicker">Your AI PA</span>
          <h2>An assistant that actually does the work, not just reminds you of it</h2>
          <p className="section-sub">
            Tell it what you need in plain language — &ldquo;send a quote for a 5kVA system to John, 082 123
            4567&rdquo; — and it drafts the quote, finds or creates the customer, and gets it ready to send.
            You stay focused on the job; flow&apos;s AI PA handles the admin around it.
          </p>
        </div>

        <div className="feature-grid">
          <div className="feature-card scatter-card card-accent">
            <div className="feature-icon">💬</div>
            <h3>Command box</h3>
            <p className="muted">
              Type what you want done in plain English — flow&apos;s AI PA turns it into a real quote,
              invoice, or customer record.
            </p>
          </div>
          <div className="feature-card scatter-card card-dark">
            <div className="feature-icon" style={{ background: "var(--a-2)" }}>
              🎙️
            </div>
            <h3>Voice assistant</h3>
            <p className="muted">
              Talk instead of type — the same PA, driven by voice, for when your hands are full on-site.
            </p>
          </div>
          <div className="feature-card scatter-card card-light">
            <div className="feature-icon" style={{ ["--edge" as string]: "var(--mint)", background: "var(--mint)" }}>
              📋
            </div>
            <h3>Daily voice briefing</h3>
            <p>A spoken rundown of what needs your attention today — overdue invoices, quiet leads, who to follow up with.</p>
          </div>
          <div className="feature-card scatter-card card-accent2">
            <div className="feature-icon">✅</div>
            <h3>You approve, it sends</h3>
            <p className="muted">
              Every AI-drafted follow-up is reviewable before it reaches a customer — the PA does the
              drafting, you keep the final say.
            </p>
          </div>
        </div>
      </section>

      {/* ================= FEATURES ================= */}
      <section className="section">
        <div className="section-head">
          <span className="kicker">What flow does</span>
          <h2>Everything between &quot;sent a quote&quot; and &quot;got paid,&quot; handled</h2>
          <p className="section-sub">
            No more chasing across WhatsApp, email, and a spreadsheet to find out where a deal actually
            stands.
          </p>
        </div>

        <div className="feature-grid">
          <div className="feature-card scatter-card card-light">
            <div className="feature-icon" style={{ ["--edge" as string]: "var(--a-2)", background: "var(--a-2)" }}>
              ⚡
            </div>
            <h3>Quotes in minutes</h3>
            <p>Build a professional quote from your catalog, send it, and know the moment it&apos;s opened.</p>
          </div>
          <div className="feature-card scatter-card card-dark">
            <div className="feature-icon grad-icon">◎</div>
            <h3>One pipeline, always current</h3>
            <p className="muted">
              Every quote&apos;s status — sent, viewed, accepted, paid — in one board, updated automatically.
            </p>
          </div>
          <div className="feature-card scatter-card card-accent">
            <div className="feature-icon">✓</div>
            <h3>Invoices that chase themselves</h3>
            <p className="muted">
              Automatic follow-ups on anything overdue — polite, on-brand, sent before you&apos;d remember to.
            </p>
          </div>
          <div className="feature-card scatter-card card-accent2">
            <div className="feature-icon">🔔</div>
            <h3>Customer self-service portal</h3>
            <p className="muted">Customers view, accept, and pay — no login, no app download required.</p>
          </div>
        </div>

        <div className="inline-features">
          <div>
            <h4>Inventory that flags itself</h4>
            <p>Reorder points and demand trends surface before you run out, not after a customer asks.</p>
          </div>
          <div>
            <h4>Team &amp; role management</h4>
            <p>Invite staff, assign roles, and see who&apos;s handling what — without a separate HR tool.</p>
          </div>
        </div>

        <div className="cta-inline">
          <a className="cta-secondary" href="/benefits">
            See every feature &rarr;
          </a>
        </div>
      </section>

      {/* ================= INDUSTRIES ================= */}
      <section className="section">
        <div className="section-head">
          <span className="kicker">Built for your trade</span>
          <h2>One engine, tuned for how your industry actually works</h2>
          <p className="section-sub">
            Same core — quotes, invoices, follow-ups — with the fields and workflow that fit your business.
          </p>
        </div>

        <div className="feature-grid">
          <a className="feature-card scatter-card card-accent" href="/industries/services">
            <div className="feature-icon">☀️</div>
            <h3>Solar &amp; trades</h3>
            <p className="muted">Job cards and site-visit scheduling tied straight to the quote that sold the job.</p>
          </a>
          <a className="feature-card scatter-card card-light" href="/industries/retail">
            <div className="feature-icon" style={{ ["--edge" as string]: "var(--mint)", background: "var(--mint)" }}>
              🏬
            </div>
            <h3>Retail &amp; wholesale</h3>
            <p>Stock demand heatmap so reordering is a decision, not a guess.</p>
          </a>
          <a className="feature-card scatter-card card-dark" href="/industries/logistics">
            <div className="feature-icon" style={{ background: "var(--a-2)" }}>
              🚚
            </div>
            <h3>Logistics &amp; delivery</h3>
            <p className="muted">Fuel logs and fleet costs sitting next to the invoices they&apos;re tied to.</p>
          </a>
        </div>

        <p className="also-serving">
          Also built for <strong>medical &amp; patient care</strong>, <strong>corporate services</strong>, and{" "}
          <strong>nonprofits</strong> — same engine, industry-specific fields.
        </p>

        <div className="cta-inline">
          <a className="cta-primary" href="/industries/medical" style={{ background: "linear-gradient(120deg, var(--a-2), #0d5bb8)" }}>
            Find your industry &rarr;
          </a>
        </div>
      </section>

      {/* ================= HOW IT WORKS ================= */}
      <section className="section">
        <div className="section-head">
          <span className="kicker">How it works</span>
          <h2>Three steps, not a training day</h2>
        </div>
        <div className="how-row">
          <div className="how-step">
            <div className="how-num grad-icon">1</div>
            <h3>Quote the job</h3>
            <p>Pick items from your catalog, type a custom line, or just tell the AI PA — sent as a branded PDF in under a minute.</p>
          </div>
          <div className="how-step">
            <div className="how-num" style={{ background: "var(--a-2)" }}>
              2
            </div>
            <h3>Customer accepts</h3>
            <p>They approve on their phone, no account needed. It converts straight into an invoice.</p>
          </div>
          <div className="how-step">
            <div className="how-num" style={{ background: "var(--mint)" }}>
              3
            </div>
            <h3>flow chases payment</h3>
            <p>Reminders go out on schedule. You only get pinged when it&apos;s something you need to decide.</p>
          </div>
        </div>
        <div className="cta-inline">
          <a className="cta-secondary" href="/signup">
            Try it on a real quote &rarr;
          </a>
        </div>
      </section>

      {/* ================= TESTIMONIAL ================= */}
      <section className="section">
        <div className="testimonial scatter-card card-dark">
          <div className="quote-mark">&ldquo;</div>
          <p className="testimonial-body">
            Before flow, I&apos;d lose track of which quotes were even still live. Now I can see it at a
            glance, and it nudges customers for me — I&apos;ve gotten paid faster just from that.
          </p>
          <div className="testimonial-by">
            <div className="avatar" />
            <div>
              <p className="t-name">Owner, solar installation business</p>
              <p className="t-role muted">Gauteng, South Africa</p>
            </div>
          </div>
        </div>
        <div className="cta-inline">
          <a className="cta-secondary" href="/case-studies">
            Read more customer stories
          </a>
        </div>
      </section>

      <PricingTeaser />

      {/* ================= FINAL CTA ================= */}
      <section className="cta-band">
        <div className="cta-band-inner">
          <h2>Stop chasing. Let flow do it.</h2>
          <p>Free to start, no credit card required.</p>
          <a className="cta-primary cta-band-btn" href="/signup">
            Create my workspace &rarr;
          </a>
        </div>
      </section>

      <MarketingFooterStatic />
    </div>
  );
}
