// "Send it in Word" — the quote or proposal as an editable document.

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

  const [quote, tenant] = await Promise.all([
    prisma.transaction.findFirst({
      where: { id, tenantId, type: "QUOTE" },
      include: { itemLines: { include: { item: true }, orderBy: { sortOrder: "asc" } }, party: true },
    }),
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
  ]);
  if (!quote) notFound();

  const { fileName, data } = documentToDocx({
    kind: quote.quoteKind === "PROPOSAL" ? "Proposal" : "Quote",
    number: quote.externalRef ?? `QT-${quote.id.slice(-6).toUpperCase()}`,
    issuedAt: quote.createdAt,
    dueAt: quote.dueAt,
    currency: quote.currency ?? tenant.currency,
    subject: quote.subject,
    poNumber: quote.poNumber,
    amountCents: quote.amountCents,
    discountPercent: quote.discountPercent,
    business: tenant,
    customer: quote.party,
    lines: quote.itemLines.map((l) => ({
      name: l.description ?? l.item.name,
      description: l.description ? l.item.name : l.item.description,
      quantity: l.quantity,
      unit: l.unit ?? l.item.unit,
      unitPriceCents: l.unitPriceCents,
      discountPercent: l.discountPercent,
      taxRatePercent: l.taxRatePercent,
    })),
    proposal:
      quote.quoteKind === "PROPOSAL"
        ? {
            introText: quote.introText,
            scopeOfWork: quote.scopeOfWork,
            projectLocation: quote.projectLocation,
            projectTimeline: quote.projectTimeline,
            performanceExpectancy: quote.performanceExpectancy,
            systemInfo: quote.systemInfo,
          }
        : null,
  });

  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": DOCX_CONTENT_TYPE, "Content-Disposition": `attachment; filename="${fileName}"` },
  });
}
