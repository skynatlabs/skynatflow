import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { listProducts } from "@/lib/core/catalog";
import { LineItemsEditor } from "../../../new/LineItemsEditor";
import { updateQuoteLinesAction } from "./actions";

const LOCKED_STATUSES = new Set(["ACCEPTED", "DECLINED", "CANCELLED"]);

export default async function EditQuotePage({
  params,
}: {
  params: Promise<{ tenantId: string; id: string }>;
}) {
  const { tenantId, id } = await params;

  const quote = await prisma.transaction.findUnique({
    where: { id },
    include: { itemLines: { include: { item: true } }, party: true },
  });
  if (!quote || quote.tenantId !== tenantId || quote.type !== "QUOTE") notFound();
  if (LOCKED_STATUSES.has(quote.status)) redirect(`/dashboard/${tenantId}/quotes/${id}`);

  const products = await listProducts(tenantId);
  const initialLines = quote.itemLines.map((l) => ({
    itemId: l.itemId,
    itemName: l.item.name,
    quantity: l.quantity,
    priceRand: l.unitPriceCents / 100,
    discountPercent: l.discountPercent ?? 0,
    taxRatePercent: l.taxRatePercent ?? undefined,
  }));

  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link href={`/dashboard/${tenantId}/quotes/${id}`} className="text-xs text-[var(--kb-text-dim)] hover:underline">
        &larr; Back
      </Link>
      <h1 className="mt-2 text-xl font-semibold text-[var(--kb-text)]">
        Edit quote for {quote.party.name}
      </h1>

      <form action={updateQuoteLinesAction} className="kb-card mt-6 space-y-5 p-6">
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="quoteId" value={id} />
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-[var(--kb-text)]">Subject</label>
            <input
              name="subject"
              defaultValue={quote.subject ?? ""}
              className="mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)]"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--kb-text)]">PO / reference #</label>
            <input
              name="poNumber"
              defaultValue={quote.poNumber ?? ""}
              className="mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)]"
            />
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
          initialDocumentDiscountPercent={quote.discountPercent ?? 0}
        />
        <button type="submit" className="kb-pill kb-pill-primary w-full justify-center py-3">
          Save changes
        </button>
      </form>
    </div>
  );
}
