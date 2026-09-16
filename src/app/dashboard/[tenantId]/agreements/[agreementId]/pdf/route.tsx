// The document itself, to print or to attach.

import { notFound } from "next/navigation";
import { AuthRequiredError, ForbiddenError, requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { getAgreement } from "@/lib/core/agreements";
import { renderAgreementPdf } from "@/lib/pdf/render";

export async function GET(_request: Request, { params }: { params: Promise<{ tenantId: string; agreementId: string }> }) {
  const { tenantId, agreementId } = await params;

  try {
    await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) return new Response("Sign in required", { status: 401 });
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const [agreement, tenant] = await Promise.all([
    getAgreement(tenantId, agreementId),
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
  ]);
  if (!agreement) notFound();

  const buffer = await renderAgreementPdf({
    agreement: { ...agreement, clauses: agreement.clauseList },
    party: agreement.party,
    tenant,
  });

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${agreement.number}.pdf"`,
    },
  });
}
