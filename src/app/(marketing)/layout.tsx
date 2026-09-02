import { Fraunces } from "next/font/google";
import { MotionConfig } from "motion/react";
import MarketingHeader from "@/components/marketing/MarketingHeader";
import MarketingFooter from "@/components/marketing/MarketingFooter";
import PricingCardsGate from "@/components/marketing/PricingCardsGate";

// A characterful display serif for marketing headlines only — the product
// dashboard stays on Geist sans, but the marketing site gets its own voice.
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["500", "600"],
  style: ["normal", "italic"],
});

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <MotionConfig reducedMotion="user">
      <div className={`kb-shell kb-marketing flex min-h-screen flex-col ${fraunces.variable}`} data-theme="light">
        <MarketingHeader />
        <main className="flex-1">
          {children}
          <PricingCardsGate />
        </main>
        <MarketingFooter />
      </div>
    </MotionConfig>
  );
}
