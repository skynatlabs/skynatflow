import { MarketingFonts, MarketingNav, MarketingFooterStatic, MARKETING_CSS } from "@/components/marketing/chrome";

// Every page under this group is now hand-built HTML/CSS matching the
// approved concept mockup (see chrome.tsx) rather than CMS-driven — the
// home page (src/app/page.tsx) uses the same visual language but sits
// outside this group with its own copy of the chrome, since it needs a
// fully custom hero the shared nav/footer wrapper doesn't provide.
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="mkt">
      <MarketingFonts />
      <style>{MARKETING_CSS}</style>
      <MarketingNav />
      <main>{children}</main>
      <MarketingFooterStatic />
    </div>
  );
}
