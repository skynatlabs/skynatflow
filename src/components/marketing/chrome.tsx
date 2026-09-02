// Shared chrome for every hand-built (non-CMS) marketing page: fonts, the
// full CSS block from the approved concept mockup, and the nav/footer
// markup. Mounted once in (marketing)/layout.tsx so individual pages don't
// each repeat this — only src/app/page.tsx (the home page, which sits
// outside this route group) has its own copy.

import Link from "next/link";
import { PRICING_PLANS, TRIAL_DAYS } from "@/lib/marketing/pricing";
import { NICHE_CONFIGS } from "@/lib/niches/config";
import { NicheSkin } from "@prisma/client";

// One real photo per industry (verified Unsplash direct-CDN URLs, free to
// hotlink under Unsplash's license) plus the accent color that industry's
// card uses on the home page. Every niche in NICHE_CONFIGS must have an
// entry here — see the "industries we serve" list this maps to.
export const INDUSTRY_IMAGES: Record<NicheSkin, { photoId: string; alt: string; accent: "card-accent" | "card-accent2" | "card-dark" | "card-light" }> = {
  SERVICES: { photoId: "1509391366360-2e959784a276", alt: "Solar panel installation on a rooftop", accent: "card-accent" },
  RETAIL: { photoId: "1736236560164-bc741c70bca5", alt: "Interior of a modern retail store", accent: "card-light" },
  LOGISTICS: { photoId: "1616432043562-3671ea2e5242", alt: "Delivery truck being loaded", accent: "card-dark" },
  MEDICAL: { photoId: "1576091160550-2173dba999ef", alt: "Medical clinic reception area", accent: "card-accent2" },
  WHOLESALE: { photoId: "1587293852726-70cdb56c2866", alt: "Wholesale warehouse with pallets of stock", accent: "card-light" },
  ECOMMERCE: { photoId: "1656543802898-41c8c46683a7", alt: "Shipping boxes ready for e-commerce fulfillment", accent: "card-accent" },
  CORPORATE: { photoId: "1758691737124-05c5bffe46f0", alt: "Corporate office team working together", accent: "card-dark" },
  NONPROFIT: { photoId: "1628717341663-0007b0ee2597", alt: "Community volunteers working together", accent: "card-accent2" },
};

export function unsplashUrl(photoId: string, width = 800) {
  return `https://images.unsplash.com/photo-${photoId}?w=${width}&q=80&auto=format&fit=crop`;
}

// The full platform feature set — real capabilities, not niche-specific —
// shown on every industry page so nobody lands there and misses that the
// AI PA / voice assistant / drafts exist just because their vertical's
// `emphasizes` list didn't happen to mention them. Keep this in sync with
// what's actually built (src/lib/core/*, the dashboard's PaCommandBox/
// VoiceAssistant/DailyVoiceBriefing components) — no invented capabilities.
export const FULL_ENGINE_FEATURES: { icon: string; title: string; body: string }[] = [
  { icon: "💬", title: "AI PA — command box", body: "Type what you need in plain language and the AI PA drafts the quote, invoice, or customer record for you." },
  { icon: "🎙️", title: "Voice assistant & daily briefing", body: "Talk to flow instead of typing, and get a spoken daily rundown of what needs your attention." },
  { icon: "🤖", title: "AI follow-ups, approved by you", body: "Quiet leads and overdue invoices get a drafted nudge automatically — nothing sends without your review." },
  { icon: "⚡", title: "Quotes & invoices", body: "Build from your catalog, send as a branded PDF, and track status automatically from sent to paid." },
  { icon: "🔔", title: "Customer self-service portal", body: "Customers view, accept, and pay online — no login or app download required on their side." },
  { icon: "📦", title: "Inventory demand heatmap", body: "Reorder points and demand trends surface before you run out, not after a customer asks." },
  { icon: "👥", title: "Staff, roles & permissions", body: "Invite your team, assign roles, and control who can see and do what." },
  { icon: "🧾", title: "E-signatures & document proof", body: "Signed quotes and delivery/job proof are captured and stored automatically, no extra app." },
];

// Compact pricing teaser appended to every page except /pricing and the
// home page (both already show the full plan cards).
export function PricingTeaser() {
  return (
    <section className="section">
      <div className="section-head">
        <span className="kicker">Pricing</span>
        <h2>{TRIAL_DAYS} days free, then pick a plan that fits</h2>
        <p className="section-sub">No credit card required to start. Cancel any time.</p>
      </div>
      <div className="pricing-row">
        {PRICING_PLANS.map((plan) => {
          const variant = plan.id === "growth" ? "card-accent" : plan.id === "enterprise" ? "card-dark" : "card-outline";
          const mutedClass = variant === "card-outline" ? "" : "muted";
          return (
            <div key={plan.id} className={`price-card scatter-card ${variant} ${plan.id === "growth" ? "price-featured" : ""}`}>
              <p className="price-tier">{plan.name}</p>
              <p className="price-amount">
                {plan.price}
                {plan.id !== "enterprise" && <span style={{ fontSize: "0.9rem", opacity: 0.7 }}>/mo</span>}
              </p>
              <p className={`price-desc ${mutedClass}`}>{plan.priceNote}</p>
              <ul style={{ marginTop: 14, paddingLeft: 0, listStyle: "none", fontSize: "0.85rem", lineHeight: 1.65 }}>
                {plan.features.map((f) => (
                  <li key={f}>&#10003; {f}</li>
                ))}
              </ul>
              {plan.extraSeatPrice && (
                <p className={`price-desc ${mutedClass}`} style={{ marginTop: 12 }}>
                  Extra seats: {plan.extraSeatPrice}
                </p>
              )}
              <p className={`price-desc ${mutedClass}`} style={{ marginTop: 10, fontSize: "0.78rem", fontStyle: "italic" }}>
                {plan.aiNote}
              </p>
            </div>
          );
        })}
      </div>
      <div className="cta-inline">
        <a className="cta-secondary" href="/pricing">
          See full plan details &rarr;
        </a>
      </div>
    </section>
  );
}

export function MarketingFonts() {
  return (
    <>
      <link rel="preconnect" href="https://fonts.googleapis.com" />
      <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      <link
        href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,500;9..144,600&family=Manrope:wght@400;500;600;700;800&family=IBM+Plex+Mono:wght@500&display=swap"
        rel="stylesheet"
      />
    </>
  );
}

export function MarketingNav() {
  const niches = Object.values(NICHE_CONFIGS);
  return (
    <div className="wrap" style={{ paddingBottom: 0 }}>
      <nav>
        <a className="brand" href="/">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/flow-logo.png" alt="flow" />
        </a>
        <div className="navlinks">
          <a href="/benefits">Product</a>
          <div className="nav-dropdown">
            <a href="/industries/services">
              Industries <span aria-hidden style={{ fontSize: "0.7em" }}>&#9662;</span>
            </a>
            <div className="nav-dropdown-menu">
              {niches.map((n) => (
                <a key={n.skin} href={`/industries/${n.skin.toLowerCase()}`}>
                  {n.label}
                </a>
              ))}
            </div>
          </div>
          <a href="/pricing">Pricing</a>
          <a href="/case-studies">Customers</a>
        </div>
        <a className="navcta" href="/signup">
          Start free trial
        </a>
      </nav>
    </div>
  );
}

// One card per industry, real photo top-half / info bottom-half, colors
// cycling across the site's own palette rather than one flat repeated
// tint. Horizontal scroll so 8 cards don't force a tall grid — small,
// browsable, not a wall.
export function IndustryCardsScroll() {
  const niches = Object.values(NICHE_CONFIGS);
  return (
    <section className="section" style={{ maxWidth: "100%", padding: "70px 0" }}>
      <div className="section-head">
        <span className="kicker">Industries we serve</span>
        <h2>One engine, eight ways to run your business</h2>
        <p className="section-sub">Pick your industry to see flow tuned for how you actually work.</p>
      </div>
      <div className="industry-scroll">
        {niches.map((n) => {
          const img = INDUSTRY_IMAGES[n.skin];
          const mutedClass = img.accent === "card-light" ? "" : "muted";
          return (
            <Link key={n.skin} href={`/industries/${n.skin.toLowerCase()}`} className={`industry-card scatter-card ${img.accent}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={unsplashUrl(img.photoId, 500)} alt={img.alt} loading="lazy" />
              <div className="industry-card-body">
                <h3>{n.label}</h3>
                <p className={mutedClass}>{n.tagline}</p>
              </div>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

// Two-row logo marquee, rows drifting opposite directions. Placeholder
// names until real customer logos are ready to swap in — same "not a real
// claim" logic as the trust-stats decision earlier: these read as
// decorative brand chips, not a specific factual customer list.
const MARQUEE_ROW_1 = ["SolarWorks", "Corner Store Co-op", "Fleet Logistics SA", "Family Practice Group", "BulkSupply", "Metro Wholesale"];
const MARQUEE_ROW_2 = ["Harbor Logistics", "GreenTech Installs", "Riverside Clinic", "Summit Retail Group", "Coastal Ecommerce Co.", "Unity Nonprofit Network"];

export function LogoMarquee() {
  return (
    <div className="marquee-wrap">
      <div className="marquee-row marquee-left">
        {[...MARQUEE_ROW_1, ...MARQUEE_ROW_1].map((name, i) => (
          <span key={i}>{name}</span>
        ))}
      </div>
      <div className="marquee-row marquee-right">
        {[...MARQUEE_ROW_2, ...MARQUEE_ROW_2].map((name, i) => (
          <span key={i}>{name}</span>
        ))}
      </div>
    </div>
  );
}

export function MarketingFooterStatic() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div className="brand">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/flow-logo.png" alt="flow" />
        </div>
        <div className="footer-links">
          <a href="/benefits">Product</a>
          <a href="/pricing">Pricing</a>
          <a href="/industries/services">Industries</a>
          <a href="/case-studies">Customers</a>
          <a href="/about">About</a>
        </div>
      </div>
      <div className="footer-bottom">
        <p className="footer-copy">&copy; 2026 flow. Built by Skynat.</p>
      </div>
    </footer>
  );
}

export const MARKETING_CSS = `
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

  .mkt, .mkt * { box-sizing: border-box; }
  .mkt {
    font-family: "Manrope", ui-sans-serif, system-ui, sans-serif;
    -webkit-font-smoothing: antialiased;
    background: var(--bg);
    color: var(--ink);
    overflow-x: hidden;
  }

  .mkt .field { position: absolute; inset: 0; z-index: 0; pointer-events: none; overflow: hidden; }
  .mkt .hero-wrap { position: relative; overflow: hidden; }
  .mkt .blob { position: absolute; border-radius: 50%; filter: blur(70px); opacity: 0.35; }
  .mkt .blob.b1 { width: 480px; height: 480px; background: var(--a); top: -160px; left: -120px; }
  .mkt .blob.b2 { width: 420px; height: 420px; background: var(--a-2); top: 20%; right: -160px; opacity: 0.25; }
  .mkt .blob.b3 { width: 380px; height: 380px; background: var(--a-mid); bottom: -140px; left: 30%; opacity: 0.2; }

  .mkt .wrap { position: relative; z-index: 1; max-width: 1180px; margin: 0 auto; padding: 28px 32px 40px; }

  .mkt nav { display: flex; align-items: center; justify-content: space-between; padding: 6px 4px 20px; }
  .mkt .brand { display: flex; align-items: center; text-decoration: none; }
  .mkt .brand img { height: 30px; width: auto; display: block; }
  .mkt .footer .brand img { height: 34px; filter: brightness(0) invert(1); }

  /* Two-row logo marquee — rows drift opposite directions, each list
     duplicated so the loop is seamless. Pauses for reduced-motion users. */
  .mkt .marquee-wrap { overflow: hidden; padding: 28px 0; }
  .mkt .marquee-row { display: flex; gap: 48px; width: max-content; }
  .mkt .marquee-row + .marquee-row { margin-top: 22px; }
  .mkt .marquee-row span {
    font-family: "Fraunces", serif; font-weight: 500; font-size: 1.15rem;
    color: var(--ink-dim); opacity: 0.55; white-space: nowrap;
  }
  @media (prefers-reduced-motion: no-preference) {
    .mkt .marquee-left { animation: mktMarqueeLeft 32s linear infinite; }
    .mkt .marquee-right { animation: mktMarqueeRight 32s linear infinite; }
  }
  @keyframes mktMarqueeLeft { from { transform: translateX(0); } to { transform: translateX(-50%); } }
  @keyframes mktMarqueeRight { from { transform: translateX(-50%); } to { transform: translateX(0); } }
  .mkt .navlinks { display: flex; gap: 30px; font-size: 0.9rem; font-weight: 600; color: var(--ink-dim); }
  .mkt .navlinks a { color: inherit; text-decoration: none; }
  .mkt .navlinks a:hover, .mkt .navlinks a:focus-visible { color: var(--ink); }

  /* Industries dropdown — CSS-only (no JS needed): the menu is positioned
     off-screen until the trigger or menu itself is hovered/focused. */
  .mkt .nav-dropdown { position: relative; }
  .mkt .nav-dropdown-menu {
    position: absolute; top: 100%; left: 50%; transform: translateX(-50%);
    margin-top: 14px; padding: 10px; border-radius: 14px;
    background: var(--bg-soft); border: 1px solid var(--line);
    box-shadow: 0 20px 40px -16px rgba(23, 23, 37, 0.25);
    display: grid; grid-template-columns: repeat(2, 1fr); gap: 2px;
    width: 460px;
    opacity: 0; visibility: hidden; pointer-events: none;
    transition: opacity 0.15s ease;
    z-index: 20;
  }
  .mkt .nav-dropdown:hover .nav-dropdown-menu,
  .mkt .nav-dropdown:focus-within .nav-dropdown-menu {
    opacity: 1; visibility: visible; pointer-events: auto;
  }
  .mkt .nav-dropdown-menu a {
    display: block; padding: 10px 12px; border-radius: 8px;
    font-size: 0.85rem; font-weight: 600; color: var(--ink) !important;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .mkt .nav-dropdown-menu a:hover { background: var(--bg); }

  /* Horizontal-scroll industry cards */
  .mkt .industry-scroll {
    display: flex; gap: 20px; overflow-x: auto; padding: 10px 32px 20px;
    scroll-snap-type: x proximity;
    -webkit-overflow-scrolling: touch;
  }
  .mkt .industry-card {
    scroll-snap-align: start;
    flex: 0 0 auto;
    width: 260px;
    border-radius: 20px;
    overflow: hidden;
    text-decoration: none;
    display: block;
    box-shadow: 0 16px 34px -18px rgba(23, 23, 37, 0.22);
  }
  .mkt .industry-card img { display: block; width: 100%; height: 140px; object-fit: cover; }
  .mkt .industry-card-body { padding: 18px; }
  .mkt .industry-card-body h3 { margin: 0 0 6px; font-size: 1.02rem; font-weight: 800; }
  .mkt .industry-card-body p { margin: 0; font-size: 0.85rem; line-height: 1.45; }
  .mkt .navcta { padding: 10px 20px; border-radius: 10px; background: var(--ink); color: var(--bg-soft); font-weight: 700; font-size: 0.88rem; text-decoration: none; box-shadow: 0 8px 20px -8px rgba(23, 23, 37, 0.4); }

  .mkt .hero { display: grid; grid-template-columns: 1.05fr 1fr; gap: 56px; align-items: center; }
  .mkt .hero.hero-centered { display: block; text-align: center; max-width: 780px; margin: 0 auto; }

  .mkt .eyebrow { display: inline-flex; align-items: center; gap: 8px; padding: 7px 14px 7px 8px; border-radius: 999px; background: var(--bg-soft); border: 1px solid var(--line); font-size: 0.78rem; font-weight: 700; color: var(--ink-dim); letter-spacing: 0.02em; }
  .mkt .eyebrow .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--a-2); }

  .mkt h1 { font-family: "Fraunces", serif; font-weight: 500; font-size: clamp(2.4rem, 4vw, 3.4rem); line-height: 1.08; letter-spacing: -0.015em; margin: 22px 0 20px; text-wrap: balance; color: var(--ink); }
  .mkt h1 em, .mkt .grad-text { font-style: italic; font-weight: 600; background: linear-gradient(100deg, var(--a) 15%, var(--a-mid) 90%); -webkit-background-clip: text; background-clip: text; color: transparent; }

  .mkt .sub { font-size: 1.08rem; line-height: 1.6; color: var(--ink-dim); max-width: 46ch; margin: 0 0 34px; }
  .mkt .hero-centered .sub { max-width: 56ch; margin-left: auto; margin-right: auto; }

  .mkt .cta-row { display: flex; align-items: center; gap: 18px; flex-wrap: wrap; }
  .mkt .hero-centered .cta-row { justify-content: center; }
  .mkt .cta-primary { padding: 15px 26px; border-radius: 12px; background: linear-gradient(120deg, var(--a), var(--a-mid)); color: white; font-weight: 700; font-size: 0.98rem; text-decoration: none; box-shadow: 0 14px 30px -10px rgba(251, 93, 107, 0.4); display: inline-flex; }
  .mkt .cta-secondary { font-weight: 700; font-size: 0.95rem; color: var(--ink); text-decoration: none; border-bottom: 2px solid var(--line); padding-bottom: 2px; }

  .mkt .stage { position: relative; height: 480px; }
  .mkt .doc-card { position: absolute; top: 6px; right: 10px; width: 340px; border-radius: 22px; padding: 26px; background: linear-gradient(150deg, var(--a) 0%, var(--a-mid) 100%); color: white; box-shadow: var(--card-shadow); transform: rotate(3deg); }
  .mkt .doc-top { display: flex; justify-content: space-between; align-items: flex-start; }
  .mkt .doc-label { font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; opacity: 0.75; font-weight: 700; }
  .mkt .doc-status { font-size: 0.68rem; font-weight: 800; letter-spacing: 0.04em; background: rgba(255,255,255,0.22); padding: 4px 10px; border-radius: 999px; }
  .mkt .doc-amount { font-family: "Fraunces", serif; font-size: 2.5rem; font-weight: 500; margin: 22px 0 4px; letter-spacing: -0.01em; }
  .mkt .doc-customer { font-size: 0.85rem; opacity: 0.85; margin-bottom: 22px; }
  .mkt .doc-wave { display: flex; align-items: flex-end; gap: 4px; height: 40px; }
  .mkt .doc-wave span { display: block; width: 6px; border-radius: 3px; background: rgba(255,255,255,0.55); }
  .mkt .float-card { position: absolute; border-radius: 18px; background: var(--bg-soft); border: 1px solid var(--line); box-shadow: 0 20px 40px -18px rgba(23, 23, 37, 0.18); padding: 16px 18px; overflow: hidden; }
  .mkt .float-card::before { content: ""; position: absolute; inset: 0 0 auto 0; height: 3px; background: var(--edge, var(--a-2)); }
  .mkt .fc-1 { left: 0; top: 250px; width: 210px; --edge: var(--a-2); }
  .mkt .fc-2 { left: 40px; bottom: 6px; width: 240px; --edge: var(--mint); }
  .mkt .fc-label { font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--ink-dim); font-weight: 700; }
  .mkt .fc-value { font-family: "IBM Plex Mono", monospace; font-size: 1.3rem; font-weight: 500; margin-top: 4px; font-variant-numeric: tabular-nums; color: var(--ink); }
  .mkt .fc-1 .fc-value { color: var(--a-2); }
  .mkt .fc-delta { font-size: 0.78rem; font-weight: 700; color: var(--mint); margin-top: 2px; }
  .mkt .ring { width: 54px; height: 54px; border-radius: 50%; background: conic-gradient(var(--mint) 0deg 252deg, var(--line) 252deg 360deg); display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
  .mkt .ring::after { content: ""; width: 38px; height: 38px; border-radius: 50%; background: var(--bg-soft); }
  .mkt .fc-2-body { display: flex; align-items: center; gap: 14px; }
  .mkt .fc-2-text .fc-value { font-size: 1.1rem; }

  @media (prefers-reduced-motion: no-preference) {
    .mkt .doc-card { animation: mktFloat1 7s ease-in-out infinite; }
    .mkt .fc-1 { animation: mktFloat2 8s ease-in-out infinite; }
    .mkt .fc-2 { animation: mktFloat2 9s ease-in-out infinite reverse; }
  }
  @keyframes mktFloat1 { 0%,100% { transform: rotate(3deg) translateY(0); } 50% { transform: rotate(2deg) translateY(-10px); } }
  @keyframes mktFloat2 { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }

  @keyframes mktFloatA { 0%,100% { transform: rotate(-4deg) translateY(6px); } 50% { transform: rotate(-2deg) translateY(-6px); } }
  @keyframes mktFloatB { 0%,100% { transform: rotate(2deg) translateY(-14px); } 50% { transform: rotate(4deg) translateY(-4px); } }
  @keyframes mktFloatC { 0%,100% { transform: rotate(-2deg) translateY(10px); } 50% { transform: rotate(-4deg) translateY(0px); } }
  @keyframes mktFloatD { 0%,100% { transform: rotate(3deg) translateY(-6px); } 50% { transform: rotate(1deg) translateY(4px); } }
  @keyframes mktFloatE { 0%,100% { transform: rotate(-3deg) translateY(4px); } 50% { transform: rotate(-1deg) translateY(-8px); } }
  @keyframes mktFloatF { 0%,100% { transform: rotate(2deg) translateY(-10px); } 50% { transform: rotate(4deg) translateY(2px); } }

  .mkt .scatter-card { will-change: transform; }
  @media (prefers-reduced-motion: no-preference) {
    .mkt .scatter-card:nth-of-type(6n+1) { animation: mktFloatA 8s ease-in-out infinite; animation-delay: -1s; }
    .mkt .scatter-card:nth-of-type(6n+2) { animation: mktFloatB 9.5s ease-in-out infinite; animation-delay: -3s; }
    .mkt .scatter-card:nth-of-type(6n+3) { animation: mktFloatC 7s ease-in-out infinite; animation-delay: -5s; }
    .mkt .scatter-card:nth-of-type(6n+4) { animation: mktFloatD 10s ease-in-out infinite; animation-delay: -2s; }
    .mkt .scatter-card:nth-of-type(6n+5) { animation: mktFloatE 8.5s ease-in-out infinite; animation-delay: -6s; }
    .mkt .scatter-card:nth-of-type(6n+6) { animation: mktFloatF 9s ease-in-out infinite; animation-delay: -4s; }
    .mkt .scatter-card:hover { animation: none; }
  }

  .mkt .card-light { background: var(--bg-soft); border: 1px solid var(--line); color: var(--ink); }
  .mkt .card-dark { background: var(--ink); border: none; color: white; }
  .mkt .card-dark .muted { color: rgba(255,255,255,0.62); }
  .mkt .card-accent { background: linear-gradient(150deg, var(--a) 0%, var(--a-mid) 100%); border: none; color: white; box-shadow: var(--card-shadow); }
  .mkt .card-accent .muted { color: rgba(255,255,255,0.78); }
  .mkt .card-accent2 { background: linear-gradient(150deg, var(--a-2) 0%, #0d5bb8 100%); border: none; color: white; }
  .mkt .card-accent2 .muted { color: rgba(255,255,255,0.78); }
  .mkt .card-outline { background: transparent; border: 1.5px dashed var(--line); color: var(--ink); }
  .mkt .muted { color: var(--ink-dim); }

  .mkt .section { position: relative; max-width: 1180px; margin: 0 auto; padding: 70px 32px; }
  .mkt .section-head { max-width: 640px; margin: 0 auto 48px; text-align: center; }
  .mkt .kicker { display: inline-block; font-size: 0.76rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--a-2); margin-bottom: 14px; }
  .mkt .section-head h2, .mkt h2.section-title { font-family: "Fraunces", serif; font-weight: 500; font-size: clamp(1.9rem, 3vw, 2.6rem); line-height: 1.15; letter-spacing: -0.01em; margin: 0; text-wrap: balance; }
  .mkt .section-sub { margin-top: 14px; color: var(--ink-dim); font-size: 1.02rem; line-height: 1.6; }

  .mkt .feature-grid { display: flex; flex-wrap: wrap; justify-content: center; gap: 34px 26px; padding: 10px 0 30px; }
  .mkt .feature-card { position: relative; border-radius: 20px; padding: 30px; width: 300px; box-shadow: 0 16px 34px -18px rgba(23, 23, 37, 0.2); transition: box-shadow 0.25s ease; text-decoration: none; display: block; }
  .mkt .feature-card:hover { transform: rotate(0deg) translateY(-10px) !important; box-shadow: 0 26px 46px -18px rgba(23, 23, 37, 0.3); z-index: 2; }
  .mkt .feature-icon { width: 44px; height: 44px; border-radius: 13px; display: flex; align-items: center; justify-content: center; color: white; font-size: 1.25rem; margin-bottom: 20px; box-shadow: 0 10px 20px -8px color-mix(in srgb, var(--edge, var(--a)) 60%, transparent); }
  .mkt .card-dark .feature-icon, .mkt .card-accent .feature-icon, .mkt .card-accent2 .feature-icon { background: rgba(255,255,255,0.16); box-shadow: none; }
  .mkt .grad-icon { background: linear-gradient(135deg, var(--a), var(--a-mid)); }
  .mkt .feature-card h3 { font-size: 1.1rem; font-weight: 800; margin: 0 0 8px; }
  .mkt .feature-card p { margin: 0; font-size: 0.95rem; line-height: 1.55; }

  .mkt .inline-features { max-width: 760px; margin: 44px auto 0; display: grid; grid-template-columns: 1fr 1fr; gap: 30px; padding: 30px 0; border-top: 1px solid var(--line); }
  .mkt .inline-features h4 { font-size: 1rem; font-weight: 800; margin: 0 0 6px; }
  .mkt .inline-features p { margin: 0; color: var(--ink-dim); font-size: 0.92rem; line-height: 1.55; }
  .mkt .also-serving { max-width: 640px; margin: 40px auto 0; text-align: center; color: var(--ink-dim); font-size: 1rem; line-height: 1.6; }
  .mkt .also-serving strong { color: var(--ink); }
  .mkt .cta-inline { text-align: center; margin-top: 40px; }

  .mkt .how-row { display: flex; justify-content: center; gap: 48px; flex-wrap: wrap; padding-top: 10px; }
  .mkt .how-step { text-align: center; width: 240px; }
  .mkt .how-num { width: 46px; height: 46px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-family: "IBM Plex Mono", monospace; font-weight: 500; font-size: 1.1rem; margin: 0 auto 18px; }
  .mkt .how-step h3 { font-size: 1.05rem; font-weight: 800; margin: 0 0 8px; }
  .mkt .how-step p { margin: 0; color: var(--ink-dim); font-size: 0.93rem; line-height: 1.55; }

  .mkt .testimonial { max-width: 760px; margin: 0 auto; text-align: center; padding: 56px 40px; border-radius: 24px; position: relative; box-shadow: 0 24px 50px -24px rgba(23, 23, 37, 0.3); }
  .mkt .quote-mark { font-family: "Fraunces", serif; font-size: 4rem; line-height: 1; margin-bottom: 4px; opacity: 0.9; }
  .mkt .testimonial-body { font-family: "Fraunces", serif; font-weight: 500; font-size: 1.4rem; line-height: 1.45; letter-spacing: -0.005em; text-wrap: balance; }
  .mkt .testimonial-by { margin-top: 28px; display: flex; align-items: center; justify-content: center; gap: 12px; }
  .mkt .avatar { width: 40px; height: 40px; border-radius: 50%; background: linear-gradient(135deg, var(--a-2), var(--mint)); flex-shrink: 0; }
  .mkt .t-name { margin: 0; font-weight: 700; font-size: 0.9rem; text-align: left; }
  .mkt .t-role { margin: 0; font-size: 0.8rem; text-align: left; }

  .mkt .pricing-row { display: flex; justify-content: center; align-items: center; flex-wrap: wrap; gap: 30px 24px; padding: 14px 0 20px; }
  .mkt .price-card { border-radius: 20px; padding: 30px 26px; width: 250px; box-shadow: 0 16px 34px -18px rgba(23, 23, 37, 0.2); }
  .mkt .price-card:hover { box-shadow: 0 26px 46px -18px rgba(23, 23, 37, 0.3); z-index: 2; }
  .mkt .price-featured { width: 280px; z-index: 1; }
  .mkt .price-tier { font-size: 0.8rem; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; opacity: 0.7; margin: 0; }
  .mkt .price-amount { font-family: "Fraunces", serif; font-size: 1.5rem; font-weight: 500; margin: 10px 0 12px; }
  .mkt .price-desc { margin: 0; font-size: 0.9rem; line-height: 1.55; opacity: 0.85; }

  .mkt .faq-grid { display: flex; flex-wrap: wrap; justify-content: center; gap: 24px; }
  .mkt .faq-card { width: 320px; border-radius: 18px; padding: 24px; }
  .mkt .faq-card h3 { font-size: 1rem; font-weight: 800; margin: 0 0 8px; }
  .mkt .faq-card p { margin: 0; font-size: 0.92rem; line-height: 1.55; }

  .mkt .logo-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 18px; }
  .mkt .logo-chip { border-radius: 14px; padding: 18px; text-align: center; font-weight: 700; font-size: 0.9rem; }

  .mkt .cta-band { background: var(--ink); padding: 90px 32px; text-align: center; position: relative; overflow: hidden; }
  .mkt .cta-band::before { content: ""; position: absolute; left: 50%; top: -140px; width: 560px; height: 560px; transform: translateX(-50%); background: linear-gradient(135deg, var(--a), var(--a-mid)); opacity: 0.35; filter: blur(100px); border-radius: 50%; }
  .mkt .cta-band-inner { position: relative; }
  .mkt .cta-band h2 { font-family: "Fraunces", serif; font-weight: 500; font-size: clamp(2rem, 3.4vw, 2.8rem); color: white; margin: 0 0 14px; }
  .mkt .cta-band p { color: rgba(255,255,255,0.65); font-size: 1.05rem; margin: 0 0 30px; }
  .mkt .cta-band-btn { display: inline-flex; }

  /* Footer: same accent-gradient treatment as the cards (white foreground
     on pink/orange), with a solid black bar underneath for the legal line
     — the "some black elements" contrast the brief asked for, echoing the
     card-dark variant used everywhere else. */
  .mkt .footer { background: linear-gradient(150deg, var(--a) 0%, var(--a-mid) 100%); padding: 48px 32px 0; color: white; }
  .mkt .footer-inner { max-width: 1180px; margin: 0 auto; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 20px; padding-bottom: 40px; }
  .mkt .footer .brand { color: white; }
  .mkt .footer .brand .mark { background: white; box-shadow: none; }
  .mkt .footer-links { display: flex; gap: 26px; font-size: 0.88rem; font-weight: 600; color: rgba(255,255,255,0.8); }
  .mkt .footer-links a { color: inherit; text-decoration: none; }
  .mkt .footer-links a:hover { color: white; }
  .mkt .footer-bottom { background: var(--ink); padding: 16px 32px; }
  .mkt .footer-copy { margin: 0; max-width: 1180px; margin-left: auto; margin-right: auto; font-size: 0.82rem; color: rgba(255,255,255,0.55); }

  @media (max-width: 880px) {
    .mkt .hero { grid-template-columns: 1fr; }
    .mkt .stage { height: 420px; margin-top: 20px; }
    .mkt .navlinks { display: none; }
    .mkt .feature-card, .mkt .how-step, .mkt .price-card, .mkt .faq-card {
      width: 100% !important;
      max-width: 380px;
      transform: none !important;
    }
    .mkt .logo-grid { grid-template-columns: repeat(2, 1fr); }
    .mkt .footer-inner { flex-direction: column; align-items: flex-start; }
  }
`;
