import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { listProducts } from "@/lib/core/catalog";
import { LineItemsEditor } from "../../../../quotes/new/LineItemsEditor";
import { updateInvoiceLinesAction } from "./actions";

const LOCKED_STATUSES = new Set(["PAID", "PARTIALLY_PAID", "CANCELLED"]);

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ tenantId: string; id: string }>;
}) {
  const { tenantId, id } = await params;

  const invoice = await prisma.transaction.findUnique({
    where: { id },
    include: { itemLines: { include: { item: true } }, party: true },
  });
  if (!invoice || invoice.tenantId !== tenantId || invoice.type !== "INVOICE") notFound();
  if (LOCKED_STATUSES.has(invoice.status)) redirect(`/dashboard/${tenantId}/invoices/${id}`);

  const products = await listProducts(tenantId);
  const initialLines = invoice.itemLines.map((l) => ({
    itemId: l.itemId,
    itemName: l.item.name,
    quantity: l.quantity,
    priceRand: l.unitPriceCents / 100,
  }));

  return (
    <div className="mx-auto max-w-3xl p-8">
      <Link href={`/dashboard/${tenantId}/invoices/${id}`} className="text-xs text-[var(--kb-text-dim)] hover:underline">
        &larr; Back
      </Link>
      <h1 className="mt-2 text-xl font-semibold text-[var(--kb-text)]">
        Edit invoice for {invoice.party.name}
      </h1>

      <form action={updateInvoiceLinesAction} className="kb-card mt-6 space-y-5 p-6">
        <input type="hidden" name="tenantId" value={tenantId} />
        <input type="hidden" name="invoiceId" value={id} />
        <LineItemsEditor
          products={products.map((p) => ({ id: p.id, name: p.name, unitPriceCents: p.unitPriceCents }))}
          initialLines={initialLines}
        />
        <button type="submit" className="kb-pill kb-pill-primary w-full justify-center py-3">
          Save changes
        </button>
      </form>
    </div>
  );
}
