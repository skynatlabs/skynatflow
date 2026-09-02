import MotionLink from "@/components/marketing/MotionLink";
import { PRICING_PLANS, TRIAL_DAYS } from "@/lib/marketing/pricing";

const ELASTIC_HOVER = { whileHover: { scale: 1.05 }, whileTap: { scale: 0.96 }, transition: { type: "spring" as const, stiffness: 400, damping: 15 } };

// Mounted once at the bottom of every marketing page (see (marketing)/layout.tsx)
// so pricing is never more than one scroll away, regardless of which page
// brought someone in. Skipped on /pricing itself, which already has its
// own full CMS-driven pricing section — showing this teaser there too
// would just repeat the same three plans back to back.
export default function PricingCards() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-16">
      <div className="text-center">
        <h2 className="text-3xl font-extrabold text-[var(--kb-text)]">
          {TRIAL_DAYS} days free, then pick a plan that fits
        </h2>
        <p className="mx-auto mt-3 max-w-xl text-[var(--kb-text-dim)]">
          No credit card required to start. Cancel any time.
        </p>
      </div>

      <div className="mt-10 flex flex-wrap items-center justify-center gap-7">
        {PRICING_PLANS.map((plan) => {
          const isDark = plan.cardVariant !== "kb-card-outline";
          const mutedClass = isDark ? "kb-muted" : "text-[var(--kb-text-dim)]";
          return (
            <div key={plan.id} className={`kb-scatter ${plan.cardVariant} w-[280px] rounded-[20px] p-7`}>
              <p className="text-xs font-bold uppercase tracking-wide opacity-70">{plan.name}</p>
              <p className="mt-2 font-serif text-2xl font-semibold">{plan.price}</p>
              <p className={`text-xs ${mutedClass}`}>{plan.priceNote}</p>
              <p className={`mt-4 text-sm ${mutedClass}`}>{plan.description}</p>
              <ul className="mt-4 space-y-1.5 text-sm">
                {plan.features.map((f) => (
                  <li key={f} className="flex gap-2">
                    <span aria-hidden>&#10003;</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
              {plan.extraSeatPrice && (
                <p className={`mt-4 text-xs ${mutedClass}`}>Extra seats: {plan.extraSeatPrice}</p>
              )}
              <MotionLink
                href={plan.ctaHref}
                className={`kb-pill mt-6 w-full justify-center text-sm ${isDark ? "border border-white/25 text-white" : "kb-pill-primary"}`}
                {...ELASTIC_HOVER}
              >
                {plan.ctaLabel} &rarr;
              </MotionLink>
            </div>
          );
        })}
      </div>
    </section>
  );
}
