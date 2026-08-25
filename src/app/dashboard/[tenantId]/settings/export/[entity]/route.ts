// One-click full data export — deliberately easy to find and use. The
// promise this backs up: nothing here is locked in, you can leave with
// everything, any time, no support ticket required.

import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireTenantAccess, AuthRequiredError, ForbiddenError } from "@/lib/auth/tenant-access";
import { toCsv } from "@/lib/export/csv";
import { getTaxSummary } from "@/lib/core/tax";

function money(cents: number) {
  return (cents / 100).toFixed(2);
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ tenantId: string; entity: string }> }
) {
  const { tenantId, entity } = await params;

  try {
    await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) return new Response("Sign in required", { status: 401 });
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  let csv: string;
  let filename: string;

  if (entity === "customers") {
    const parties = await prisma.party.findMany({ where: { tenantId }, orderBy: { createdAt: "asc" } });
    csv = toCsv(
      ["Name", "Role", "Phone", "Created"],
      parties.map((p) => [p.name, p.role, p.phone, p.createdAt.toISOString()])
    );
    filename = "customers.csv";
  } else if (entity === "products") {
    const items = await prisma.item.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
    csv = toCsv(
      ["Name", "SKU", "Category", "Price", "Cost", "Tax %", "Stock", "Active"],
      items.map((i) => [
        i.name,
        i.sku,
        i.category,
        money(i.unitPriceCents),
        i.costCents != null ? money(i.costCents) : "",
        i.taxRatePercent,
        i.stockQty,
        i.isActive ? "yes" : "no",
      ])
    );
    filename = "products.csv";
  } else if (entity === "transactions") {
    const transactions = await prisma.transaction.findMany({
      where: { tenantId },
      include: { party: true, itemLines: { include: { item: true } } },
      orderBy: { createdAt: "asc" },
    });
    csv = toCsv(
      ["Date", "Type", "Status", "Customer", "Amount", "Items", "Due", "Paid/Responded"],
      transactions.map((t) => [
        t.createdAt.toISOString(),
        t.type,
        t.status,
        t.party.name,
        money(t.amountCents),
        t.itemLines.map((l) => `${l.quantity}x ${l.item.name}`).join("; "),
        t.dueAt?.toISOString() ?? "",
        t.respondedAt?.toISOString() ?? "",
      ])
    );
    filename = "transactions.csv";
  } else if (entity === "tax-summary") {
    const grouping = new URL(request.url).searchParams.get("grouping") === "sars"
      ? "sars-bimonthly"
      : "monthly";
    const rows = await getTaxSummary(tenantId, { grouping });
    csv = toCsv(
      ["Period", "Tax Rate %", "Taxable Sales", "Tax Collected"],
      rows.map((r) => [r.periodLabel, r.taxRatePercent, money(r.taxableSalesCents), money(r.taxCollectedCents)])
    );
    filename = "tax-summary.csv";
  } else {
    notFound();
  }

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
