import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { auth } from "@/auth";

// The home page — hand-authored raw HTML/CSS matching the approved concept
// mockup exactly, deliberately NOT going through the CMS/React component
// system the rest of the marketing site uses. That trade-off (no
// admin-editable copy for this page) was made explicitly in favor of full
// pixel control over the design. This route sits outside the (marketing)
// route group on purpose, so it does not inherit MarketingHeader/Footer —
// the nav and footer here are the mockup's own, self-contained.
export const metadata: Metadata = {
  title: "flow — Quote fast. Get paid faster.",
  description:
    "Quoting, invoicing, follow-ups, and a customer portal — one AI-native platform for how SMEs actually work. By Skynat.",
};

export default async function Home() {
  const session = await auth();
  if (session?.user?.id) {
    redirect("/dashboard");
  }

  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@500&display=swap"
        rel="stylesheet"
      />
      <style>{PAGE_CSS}</style>

      <div className="hero-wrap">
        <div className="field">
          <div className="blob b1" />
          <div className="blob b2" />
          <div className="blob b3" />
        </div>

        <div className="wrap">
          <nav>
            <div className="brand">
              <span className="mark" />
              flow
            </div>
            <div className="navlinks">
              <a href="/benefits">Product</a>
              <a href="/industries/services">Industries</a>
              <a href="/pricing">Pricing</a>
              <a href="/case-studies">Customers</a>
            </div>
            <a className="navcta" href="/signup">
              Start free trial
            </a>
          </nav>

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
                One place to quote, invoice, and follow up — with an AI assistant that nudges quiet leads
                and flags overdue invoices before you have to think about it.
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
            <p>Pick items from your catalog or type a custom line — sent as a branded PDF in under a minute.</p>
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

      {/* ================= PRICING ================= */}
      <section className="section">
        <div className="section-head">
          <span className="kicker">Pricing</span>
          <h2>14 days free, then pick a plan that fits</h2>
          <p className="section-sub">No credit card required to start. Cancel any time.</p>
        </div>
        <div className="pricing-row">
          <div className="price-card scatter-card card-outline">
            <p className="price-tier">Starter</p>
            <p className="price-amount">$19/mo</p>
            <p className="price-desc muted">Per organization · 3 staff seats · quotes, invoices, customer portal.</p>
          </div>
          <div className="price-card price-featured scatter-card card-accent">
            <p className="price-tier">Growth</p>
            <p className="price-amount">$49/mo</p>
            <p className="price-desc">Per organization · 5 seats · AI follow-ups, inventory, POS, rentals.</p>
          </div>
          <div className="price-card scatter-card card-dark">
            <p className="price-tier">Enterprise</p>
            <p className="price-amount">Custom</p>
            <p className="price-desc muted">Multi-location &amp; multi-org, dedicated onboarding, priority support.</p>
          </div>
        </div>
        <div className="cta-inline">
          <a className="cta-primary" href="/signup">
            Get started free &rarr;
          </a>
        </div>
      </section>

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

      {/* ================= FOOTER ================= */}
      <footer className="footer">
        <div className="footer-inner">
          <div className="brand">
            <span className="mark" />
            flow
          </div>
          <div className="footer-links">
            <a href="/benefits">Product</a>
            <a href="/pricing">Pricing</a>
            <a href="/industries/services">Industries</a>
            <a href="/case-studies">Customers</a>
            <a href="/about">About</a>
          </div>
          <p className="footer-copy">&copy; 2026 flow. Built by Skynat.</p>
        </div>
      </footer>
    </>
  );
}

const PAGE_CSS = `
  :root {
    --bg: #f7f6fb;
    --bg-soft: #ffffff;
    --ink: #171725;
    --ink-dim: #6b6b80;
    --line: #e6e6f2;
    --a: #fb5d6b;
    --a-mid: #fb923c;
    --a-2: #1479e8;
    --mint: #059669;
    --card-shadow: 0 30px 60px -20px rgba(251, 93, 107, 0.3);
  }

  .hero-wrap, .hero-wrap * , .logos, .logos *, .section, .section *, .cta-band, .cta-band *, .footer, .footer * {
    box-sizing: border-box;
  }
  .hero-wrap, .logos, .section, .cta-band, .footer {
    font-family: "Manrope", ui-sans-serif, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
  }

  .field { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
  .hero-wrap { position: relative; overflow: hidden; background: var(--bg); color: var(--ink); }
  .blob { position: absolute; border-radius: 50%; filter: blur(70px); opacity: 0.35; }
  .blob.b1 { width: 480px; height: 480px; background: var(--a); top: -160px; left: -120px; }
  .blob.b2 { width: 420px; height: 420px; background: var(--a-2); top: 20%; right: -160px; opacity: 0.25; }
  .blob.b3 { width: 380px; height: 380px; background: var(--a-mid); bottom: -140px; left: 30%; opacity: 0.2; }

  .wrap { position: relative; z-index: 1; max-width: 1180px; margin: 0 auto; padding: 28px 32px 100px; }

  nav { display: flex; align-items: center; justify-content: space-between; padding: 6px 4px 56px; }
  .brand { display: flex; align-items: center; gap: 10px; font-family: "Fraunces", serif; font-weight: 600; font-size: 1.35rem; letter-spacing: -0.01em; color: var(--ink); }
  .brand .mark { width: 30px; height: 30px; border-radius: 9px; background: linear-gradient(135deg, var(--a), var(--a-mid)); box-shadow: 0 6px 16px -6px rgba(251, 93, 107, 0.4); }
  .navlinks { display: flex; gap: 30px; font-size: 0.9rem; font-weight: 600; color: var(--ink-dim); }
  .navlinks a { color: inherit; text-decoration: none; }
  .navlinks a:hover, .navlinks a:focus-visible { color: var(--ink); }
  .navcta { padding: 10px 20px; border-radius: 10px; background: var(--ink); color: var(--bg-soft); font-weight: 700; font-size: 0.88rem; text-decoration: none; box-shadow: 0 8px 20px -8px rgba(23, 23, 37, 0.4); }

  .hero { display: grid; grid-template-columns: 1.05fr 1fr; gap: 56px; align-items: center; }

  .eyebrow { display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px 7px 8px; border-radius: 999px; background: var(--bg-soft); border: 1px solid var(--line); font-size: 0.78rem; font-weight: 700; color: var(--ink-dim); letter-spacing: 0.02em; }
  .eyebrow .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--a-2); }

  h1 { font-family: "Fraunces", serif; font-weight: 500; font-size: clamp(2.6rem, 4.4vw, 3.7rem); line-height: 1.03; letter-spacing: -0.015em; margin: 22px 0 20px; text-wrap: balance; color: var(--ink); }
  h1 em { font-style: italic; font-weight: 600; background: linear-gradient(100deg, var(--a) 15%, var(--a-mid) 90%); -webkit-background-clip: text; background-clip: text; color: transparent; }

  .sub { font-size: 1.08rem; line-height: 1.6; color: var(--ink-dim); max-width: 46ch; margin: 0 0 34px; }

  .cta-row { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
  .cta-primary { padding: 15px 26px; border-radius: 12px; background: linear-gradient(120deg, var(--a), var(--a-mid)); color: white; font-weight: 700; font-size: 0.98rem; text-decoration: none; box-shadow: 0 14px 30px -10px rgba(251, 93, 107, 0.4); display: inline-flex; }
  .cta-secondary { font-weight: 700; font-size: 0.95rem; color: var(--ink); text-decoration: none; border-bottom: 2px solid var(--line); padding-bottom: 2px; }

  .stage { position: relative; height: 480px; }

  .doc-card { position: absolute; top: 6px; right: 10px; width: 340px; border-radius: 22px; padding: 26px; background: linear-gradient(150deg, var(--a) 0%, var(--a-mid) 100%); color: white; box-shadow: var(--card-shadow); transform: rotate(3deg); }
  .doc-top { display: flex; justify-content: space-between; align-items: flex-start; }
  .doc-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.75; font-weight: 700; }
  .doc-status { font-size: 0.68rem; font-weight: 800; letter-spacing: 0.04em; background: rgba(255,255,255,0.22); padding: 4px 10px; border-radius: 999px; }
  .doc-amount { font-family: "Fraunces", serif; font-size: 2.5rem; font-weight: 500; margin: 22px 0 4px; letter-spacing: -0.01em; }
  .doc-customer { font-size: 0.85rem; opacity: 0.85; margin-bottom: 22px; }
  .doc-wave { display: flex; align-items: flex-end; gap: 4px; height: 40px; }
  .doc-wave span { display: block; width: 6px; border-radius: 3px; background: rgba(255,255,255,0.55); }

  .float-card { position: absolute; border-radius: 18px; background: var(--bg-soft); border: 1px solid var(--line); box-shadow: 0 20px 40px -18px rgba(23, 23, 37, 0.18); padding: 16px 18px; overflow: hidden; }
  .float-card::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 3px; background: var(--edge, var(--a-2)); }
  .fc-1 { left: 0; top: 250px; width: 210px; --edge: var(--a-2); }
  .fc-2 { left: 40px; bottom: 6px; width: 240px; --edge: var(--mint); }
  .fc-label { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-dim); font-weight: 700; }
  .fc-value { font-family: "IBM Plex Mono", monospace; font-size: 1.3rem; font-weight: 500; margin-top: 4px; font-variant-numeric: tabular-nums; color: var(--ink); }
  .fc-1 .fc-value { color: var(--a-2); }
  .fc-delta { font-size: 0.78rem; font-weight: 700; color: var(--mint); margin-top: 2px; }
  .ring { width: 54px; height: 54px; border-radius: 50%; background: conic-gradient(var(--mint) 0deg 252deg, var(--line) 252deg 360deg); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .ring::after { content: ""; width: 38px; height: 38px; border-radius: 50%; background: var(--bg-soft); }
  .fc-2-body { display: flex; align-items: center; gap: 14px; }
  .fc-2-text .fc-value { font-size: 1.1rem; }

  @media (prefers-reduced-motion: no-preference) {
    .doc-card { animation: float1 7s ease-in-out infinite; }
    .fc-1 { animation: float2 8s ease-in-out infinite; }
    .fc-2 { animation: float2 9s ease-in-out infinite reverse; }
  }
  @keyframes float1 { 0%,100% { transform: rotate(3deg) translateY(0); } 50% { transform: rotate(2deg) translateY(-10px); } }
  @keyframes float2 { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }

  @keyframes floatA { 0%,100% { transform: rotate(-4deg) translateY(6px); } 50% { transform: rotate(-2deg) translateY(-6px); } }
  @keyframes floatB { 0%,100% { transform: rotate(2deg) translateY(-14px); } 50% { transform: rotate(4deg) translateY(-4px); } }
  @keyframes floatC { 0%,100% { transform: rotate(-2deg) translateY(10px); } 50% { transform: rotate(-4deg) translateY(0px); } }
  @keyframes floatD { 0%,100% { transform: rotate(3deg) translateY(-6px); } 50% { transform: rotate(1deg) translateY(4px); } }
  @keyframes floatE { 0%,100% { transform: rotate(-3deg) translateY(4px); } 50% { transform: rotate(-1deg) translateY(-8px); } }
  @keyframes floatF { 0%,100% { transform: rotate(2deg) translateY(-10px); } 50% { transform: rotate(4deg) translateY(2px); } }

  .scatter-card { will-change: transform; }
  @media (prefers-reduced-motion: no-preference) {
    .scatter-card:nth-of-type(6n+1) { animation: floatA 8s ease-in-out infinite; animation-delay: -1s; }
    .scatter-card:nth-of-type(6n+2) { animation: floatB 9.5s ease-in-out infinite; animation-delay: -3s; }
    .scatter-card:nth-of-type(6n+3) { animation: floatC 7s ease-in-out infinite; animation-delay: -5s; }
    .scatter-card:nth-of-type(6n+4) { animation: floatD 10s ease-in-out infinite; animation-delay: -2s; }
    .scatter-card:nth-of-type(6n+5) { animation: floatE 8.5s ease-in-out infinite; animation-delay: -6s; }
    .scatter-card:nth-of-type(6n+6) { animation: floatF 9s ease-in-out infinite; animation-delay: -4s; }
    .scatter-card:hover { animation: none; }
  }

  .card-light { background: var(--bg-soft); border: 1px solid var(--line); color: var(--ink); }
  .card-dark { background: var(--ink); border: none; color: white; }
  .card-dark .muted { color: rgba(255,255,255,0.62); }
  .card-accent { background: linear-gradient(150deg, var(--a) 0%, var(--a-mid) 100%); border: none; color: white; box-shadow: var(--card-shadow); }
  .card-accent .muted { color: rgba(255,255,255,0.78); }
  .card-accent2 { background: linear-gradient(150deg, var(--a-2) 0%, #0d5bb8 100%); border: none; color: white; }
  .card-accent2 .muted { color: rgba(255,255,255,0.78); }
  .card-outline { background: transparent; border: 1.5px dashed var(--line); color: var(--ink); }
  .muted { color: var(--ink-dim); }

  .section { position: relative; max-width: 1180px; margin: 0 auto; padding: 80px 32px; background: var(--bg); color: var(--ink); }
  .section-head { max-width: 640px; margin: 0 auto 48px; text-align: center; }
  .kicker { display: inline-block; font-size: 0.76rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--a-2); margin-bottom: 14px; }
  .section-head h2 { font-family: "Fraunces", serif; font-weight: 500; font-size: clamp(1.9rem, 3vw, 2.6rem); line-height: 1.15; letter-spacing: -0.01em; margin: 0; text-wrap: balance; }
  .section-sub { margin-top: 14px; color: var(--ink-dim); font-size: 1.02rem; line-height: 1.6; }

  .logos { padding: 40px 32px 10px; text-align: center; background: var(--bg); }
  .logos-label { font-size: 0.78rem; font-weight: 700; letter-spacing: 0.04em; color: var(--ink-dim); text-transform: uppercase; }
  .logos-row { margin-top: 22px; display: flex; flex-wrap: wrap; justify-content: center; gap: 36px; font-family: "Fraunces", serif; font-weight: 500; font-size: 1.1rem; color: var(--ink-dim); opacity: 0.6; }

  .feature-grid { display: flex; flex-wrap: wrap; justify-content: center; gap: 34px 26px; padding: 10px 0 30px; }
  .feature-card { position: relative; border-radius: 20px; padding: 30px; width: 300px; box-shadow: 0 16px 34px -18px rgba(23, 23, 37, 0.2); transition: box-shadow 0.25s ease; text-decoration: none; display: block; }
  .feature-card:hover { transform: rotate(0deg) translateY(-10px) !important; box-shadow: 0 26px 46px -18px rgba(23, 23, 37, 0.3); z-index: 2; }
  .feature-icon { width: 44px; height: 44px; border-radius: 13px; display: flex; align-items: center; justify-content: center; color: white; font-size: 1.25rem; margin-bottom: 20px; box-shadow: 0 10px 20px -8px color-mix(in srgb, var(--edge, var(--a)) 60%, transparent); }
  .card-dark .feature-icon, .card-accent .feature-icon, .card-accent2 .feature-icon { background: rgba(255,255,255,0.16); box-shadow: none; }
  .grad-icon { background: linear-gradient(135deg, var(--a), var(--a-mid)); }
  .feature-card h3 { font-size: 1.1rem; font-weight: 800; margin: 0 0 8px; }
  .feature-card p { margin: 0; font-size: 0.95rem; line-height: 1.55; }

  .inline-features { max-width: 760px; margin: 44px auto 0; display: grid; grid-template-columns: 1fr 1fr; gap: 30px; padding: 30px 0; border-top: 1px solid var(--line); }
  .inline-features h4 { font-size: 1rem; font-weight: 800; margin: 0 0 6px; }
  .inline-features p { margin: 0; color: var(--ink-dim); font-size: 0.92rem; line-height: 1.55; }
  .also-serving { max-width: 640px; margin: 40px auto 0; text-align: center; color: var(--ink-dim); font-size: 1rem; line-height: 1.6; }
  .also-serving strong { color: var(--ink); }
  .cta-inline { text-align: center; margin-top: 40px; }

  .how-row { display: flex; justify-content: center; gap: 48px; flex-wrap: wrap; padding-top: 10px; }
  .how-step { text-align: center; width: 240px; }
  .how-num { width: 46px; height: 46px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-family: "IBM Plex Mono", monospace; font-weight: 500; font-size: 1.1rem; margin: 0 auto 18px; }
  .how-step h3 { font-size: 1.05rem; font-weight: 800; margin: 0 0 8px; }
  .how-step p { margin: 0; color: var(--ink-dim); font-size: 0.93rem; line-height: 1.55; }

  .testimonial { max-width: 760px; margin: 0 auto; text-align: center; padding: 56px 40px; border-radius: 24px; position: relative; box-shadow: 0 24px 50px -24px rgba(23, 23, 37, 0.3); }
  .quote-mark { font-family: "Fraunces", serif; font-size: 4rem; line-height: 1; margin-bottom: 4px; opacity: 0.9; }
  .testimonial-body { font-family: "Fraunces", serif; font-weight: 500; font-size: 1.4rem; line-height: 1.45; letter-spacing: -0.005em; text-wrap: balance; }
  .testimonial-by { margin-top: 28px; display: flex; align-items: center; justify-content: center; gap: 12px; }
  .avatar { width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, var(--a-2), var(--mint)); flex-shrink: 0; }
  .t-name { margin: 0; font-weight: 700; font-size: 0.9rem; text-align: left; }
  .t-role { margin: 0; font-size: 0.8rem; text-align: left; }

  .pricing-row { display: flex; justify-content: center; align-items: center; flex-wrap: wrap; gap: 30px 24px; padding: 14px 0 20px; }
  .price-card { border-radius: 20px; padding: 30px 26px; width: 250px; box-shadow: 0 16px 34px -18px rgba(23, 23, 37, 0.2); }
  .price-card:hover { box-shadow: 0 26px 46px -18px rgba(23, 23, 37, 0.3); z-index: 2; }
  .price-featured { width: 280px; z-index: 1; }
  .price-tier { font-size: 0.8rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.7; margin: 0; }
  .price-amount { font-family: "Fraunces", serif; font-size: 1.5rem; font-weight: 500; margin: 10px 0 12px; }
  .price-desc { margin: 0; font-size: 0.9rem; line-height: 1.55; opacity: 0.85; }

  .cta-band { background: var(--ink); padding: 90px 32px; text-align: center; position: relative; overflow: hidden; }
  .cta-band::before { content: ""; position: absolute; left: 50%; top: -140px; width: 560px; height: 560px; transform: translateX(-50%); background: linear-gradient(135deg, var(--a), var(--a-mid)); opacity: 0.35; filter: blur(100px); border-radius: 50%; }
  .cta-band-inner { position: relative; }
  .cta-band h2 { font-family: "Fraunces", serif; font-weight: 500; font-size: clamp(2rem, 3.4vw, 2.8rem); color: white; margin: 0 0 14px; }
  .cta-band p { color: rgba(255,255,255,0.65); font-size: 1.05rem; margin: 0 0 30px; }
  .cta-band-btn { display: inline-flex; }

  .footer { border-top: 1px solid var(--line); padding: 40px 32px; background: var(--bg-soft); }
  .footer-inner { max-width: 1180px; margin: 0 auto; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 20px; }
  .footer-links { display: flex; gap: 26px; font-size: 0.88rem; font-weight: 600; color: var(--ink-dim); }
  .footer-links a { color: inherit; text-decoration: none; }
  .footer-links a:hover { color: var(--ink); }
  .footer-copy { margin: 0; font-size: 0.82rem; color: var(--ink-dim); }

  @media (max-width: 880px) {
    .hero { grid-template-columns: 1fr; }
    .stage { height: 420px; margin-top: 20px; }
    .navlinks { display: none; }
    .feature-card, .how-step, .price-card {
      width: 100% !important;
      max-width: 380px;
      transform: none !important;
    }
    .footer-inner { flex-direction: column; align-items: flex-start; }
  }
`;
