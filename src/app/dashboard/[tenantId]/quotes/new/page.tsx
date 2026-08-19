import { prisma } from "@/lib/db";
import { nicheConfig } from "@/lib/niches/config";
import { createQuoteAction } from "./actions";

const inputClass =
  "mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)] placeholder:text-[var(--kb-text-dim)] focus:border-[var(--kb-accent-a)] focus:outline-none";
const labelClass = "block text-sm font-medium text-[var(--kb-text)]";

export default async function NewQuotePage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const niche = nicheConfig(tenant.niche);

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">
        New quote for a {niche.customerLabel.toLowerCase()}
      </h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        This creates the {niche.customerLabel.toLowerCase()} if they&apos;re new, and
        marks the quote as sent — the follow-up engine picks it up automatically
        if it goes unanswered.
      </p>

      <form action={createQuoteAction} className="kb-card mt-6 space-y-4 p-6">
        <input type="hidden" name="tenantId" value={tenantId} />
        <div>
          <label className={labelClass}>{niche.customerLabel} name</label>
          <input name="customerName" required className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>
            WhatsApp number{" "}
            <span className="text-[var(--kb-text-dim)]">(E.164, e.g. +27821234567)</span>
          </label>
          <input name="customerPhone" className={inputClass} />
        </div>
        <div>
          <label className={labelClass}>What&apos;s the quote for</label>
          <input name="itemName" required className={inputClass} />
        </div>
        <div className="flex gap-4">
          <div className="flex-1">
            <label className={labelClass}>Quantity</label>
            <input
              name="quantity"
              type="number"
              defaultValue={1}
              min={1}
              className={inputClass}
            />
          </div>
          <div className="flex-1">
            <label className={labelClass}>Price (ZAR)</label>
            <input name="priceRand" type="number" step="0.01" required className={inputClass} />
          </div>
        </div>
        <button type="submit" className="kb-pill kb-pill-primary w-full justify-center py-3">
          Send quote
        </button>
      </form>
    </main>
  );
}
