// "Send it in Word" — the invoice as an editable document.

import { notFound } from "next/navigation";
import { AuthRequiredError, ForbiddenError, requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { DOCX_CONTENT_TYPE } from "@/lib/export/docx";
import { documentToDocx } from "@/lib/export/documentDocx";

export async function GET(_request: Request, { params }: { params: Promise<{ tenantId: string; id: string }> }) {
  const { tenantId, id } = await params;
  try {
    await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) return new Response("Sign in required", { status: 401 });
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const [invoice, tenant] = await Promise.all([
    prisma.transaction.findFirst({
      where: { id, tenantId, type: "INVOICE" },
      include: { itemLines: { include: { item: true }, orderBy: { sortOrder: "asc" } }, party: true },
    }),
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
  ]);
  if (!invoice) notFound();

  const { fileName, data } = documentToDocx({
    kind: "Invoice",
    number: invoice.externalRef ?? `INV-${invoice.id.slice(-6).toUpperCase()}`,
    issuedAt: invoice.createdAt,
    dueAt: invoice.dueAt,
    currency: invoice.currency ?? tenant.currency,
    subject: invoice.subject,
    poNumber: invoice.poNumber,
    amountCents: invoice.amountCents,
    discountPercent: invoice.discountPercent,
    business: tenant,
    customer: invoice.party,
    lines: invoice.itemLines.map((l) => ({
      name: l.description ?? l.item.name,
      description: l.description ? l.item.name : l.item.description,
      quantity: l.quantity,
      unit: l.unit ?? l.item.unit,
      unitPriceCents: l.unitPriceCents,
      discountPercent: l.discountPercent,
      taxRatePercent: l.taxRatePercent,
    })),
    proposal: null,
  });

  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": DOCX_CONTENT_TYPE, "Content-Disposition": `attachment; filename="${fileName}"` },
  });
}
