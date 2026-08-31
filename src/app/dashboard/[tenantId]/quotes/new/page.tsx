import { prisma } from "@/lib/db";
import { nicheConfig } from "@/lib/niches/config";
import { listProducts } from "@/lib/core/catalog";
import { listProposalTemplates } from "@/lib/core/templates";
import { getProposalUsage } from "@/lib/ai/proposal";
import { suggestSalesPersonForNewLead } from "@/lib/core/salesReporting";
import { createQuoteAction } from "./actions";
import { LineItemsEditor } from "./LineItemsEditor";
import { TemplatePicker } from "./TemplatePicker";
import { QuoteTypeSection } from "./QuoteTypeSection";
import { SmartEntryBox } from "./SmartEntryBox";

const inputClass =
  "mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)] placeholder:text-[var(--kb-text-dim)] focus:border-[var(--kb-accent-a)] focus:outline-none";
const labelClass = "block text-sm font-medium text-[var(--kb-text)]";

export default async function NewQuotePage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ duplicate?: string }>;
}) {
  const { tenantId } = await params;
  const { duplicate } = await searchParams;
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const niche = nicheConfig(tenant.niche);
  const products = await listProducts(tenantId);
  const templates = await listProposalTemplates(tenantId);
  const proposalUsage = await getProposalUsage(tenantId);

  // Duplicating an existing quote — same line items (handy for repeat
  // service jobs), blank customer so the owner just swaps who it's for.
  const source = duplicate
    ? await prisma.transaction.findFirst({
        where: { id: duplicate, tenantId, type: "QUOTE" },
        include: { itemLines: { include: { item: true } } },
      })
    : null;

  const initialLines = source?.itemLines.map((l) => ({
    itemId: l.itemId,
    itemName: l.item.name,
    quantity: l.quantity,
    priceRand: l.unitPriceCents / 100,
    discountPercent: l.discountPercent ?? 0,
    taxRatePercent: l.taxRatePercent ?? undefined,
  }));

  const memberships = await prisma.membership.findMany({ where: { tenantId }, include: { user: true } });
  const suggestedRep = source ? null : await suggestSalesPersonForNewLead(tenantId);

  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">
        {source ? "Duplicate quote" : `New quote for a ${niche.customerLabel.toLowerCase()}`}
      </h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        {source
          ? "Same line items, ready to send to a different customer — adjust anything before sending."
          : `This creates the ${niche.customerLabel.toLowerCase()} if they're new, and marks the quote as sent — the follow-up engine picks it up automatically if it goes unanswered.`}
      </p>

      <SmartEntryBox tenantId={tenantId} />

      <form action={createQuoteAction} className="kb-card mt-6 space-y-5 p-6">
        <input type="hidden" name="tenantId" value={tenantId} />
        <QuoteTypeSection
          tenantId={tenantId}
          usageRemaining={proposalUsage.remaining}
          usageLimit={proposalUsage.limit}
          defaultKind={source?.quoteKind ?? undefined}
          defaultIntroText={source?.introText ?? undefined}
          defaultScopeOfWork={source?.scopeOfWork ?? undefined}
        />
        <TemplatePicker
          templates={templates.map((t) => ({
            id: t.id,
            name: t.name,
            introText: t.introText,
            scopeOfWork: t.scopeOfWork,
          }))}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className={labelClass}>{niche.customerLabel} name</label>
            <input name="customerName" required className={inputClass} autoFocus={!!source} />
          </div>
          <div>
            <label className={labelClass}>
              WhatsApp number{" "}
              <span className="text-[var(--kb-text-dim)]">(E.164, e.g. +27821234567)</span>
            </label>
            <input name="customerPhone" className={inputClass} />
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          <div>
            <label className={labelClass}>
              Subject <span className="text-[var(--kb-text-dim)]">(optional)</span>
            </label>
            <input name="subject" defaultValue={source?.subject ?? ""} className={inputClass} placeholder="What's this quote for?" />
          </div>
          <div>
            <label className={labelClass}>
              PO / reference # <span className="text-[var(--kb-text-dim)]">(optional)</span>
            </label>
            <input name="poNumber" defaultValue={source?.poNumber ?? ""} className={inputClass} />
          </div>
          <div>
            <label className={labelClass}>
              Salesperson <span className="text-[var(--kb-text-dim)]">(optional)</span>
            </label>
            <select
              name="salesPersonMembershipId"
              defaultValue={source?.salesPersonMembershipId ?? suggestedRep?.membershipId ?? ""}
              className={inputClass}
            >
              <option value="">Not assigned</option>
              {memberships.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.user.name ?? m.user.email}
                  {suggestedRep?.membershipId === m.id ? " (suggested — lightest current load)" : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
        <LineItemsEditor
          products={products.map((p) => ({
            id: p.id,
            name: p.name,
            unitPriceCents: p.unitPriceCents,
            sku: p.sku,
            taxRatePercent: p.taxRatePercent,
          }))}
          initialLines={initialLines}
          initialDocumentDiscountPercent={source?.discountPercent ?? 0}
        />
        <button type="submit" className="kb-pill kb-pill-primary w-full justify-center py-3">
          Send quote
        </button>
      </form>
    </main>
  );
}
