// The editable copy — the one the other side's attorney marks up.

import { notFound } from "next/navigation";
import { AuthRequiredError, ForbiddenError, requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { getAgreement } from "@/lib/core/agreements";
import { agreementToDocx } from "@/lib/export/agreementDocx";
import { DOCX_CONTENT_TYPE } from "@/lib/export/docx";

const KIND_LABEL: Record<string, string> = {
  PROPOSAL: "Proposal",
  SERVICE: "Service agreement",
  RETAINER: "Maintenance agreement",
  SUPPLY: "Supply agreement",
  NDA: "Non-disclosure agreement",
  SUBCONTRACT: "Sub-contract",
  OTHER: "Agreement",
};

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

  const { fileName, data } = agreementToDocx({
    number: agreement.number,
    title: agreement.title,
    kindLabel: KIND_LABEL[agreement.kind] ?? "Agreement",
    createdAt: agreement.createdAt,
    startsAt: agreement.startsAt,
    endsAt: agreement.endsAt,
    validUntil: agreement.validUntil,
    valueCents: agreement.valueCents,
    recurrence: agreement.recurrence,
    currency: agreement.currency ?? tenant.currency,
    clauses: agreement.clauseList,
    business: {
      name: tenant.name,
      registrationNumber: tenant.registrationNumber,
      vatNumber: tenant.vatNumber,
      address: tenant.businessAddress,
      email: tenant.businessEmail,
      phone: tenant.businessPhone,
    },
    customer: {
      name: agreement.party.name,
      companyName: agreement.party.companyName,
      vatNumber: agreement.party.vatNumber,
      address: agreement.party.addressLine,
      email: agreement.party.email,
      phone: agreement.party.phone,
    },
    signature:
      agreement.signedAt && agreement.signerName
        ? { signerName: agreement.signerName, signedAt: agreement.signedAt, hash: agreement.acceptanceHash }
        : null,
    ourSignerName: agreement.ourSignerName,
  });

  return new Response(new Uint8Array(data), {
    headers: { "Content-Type": DOCX_CONTENT_TYPE, "Content-Disposition": `attachment; filename="${fileName}"` },
  });
}
