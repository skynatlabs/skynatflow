// Shared renderer behind every PDF download in the app — resolves the
// tenant's chosen template (or the plain default if they haven't picked
// one), builds the QR/view-online link, and hands off to the one
// DocumentTemplate component so every document type gets the same
// branding/QR treatment for free.

import { renderToBuffer } from "@react-pdf/renderer";
import type { Transaction, TransactionLine, Item, Party, Tenant, Membership, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DocumentTemplate, type DocumentData, type OptionalSectionKey } from "./DocumentTemplate";
import { getPdfStyle, type PdfStyleConfig } from "./styles";
import { generateQrDataUrl } from "./qr";

type TxWithLines = Transaction & {
  itemLines: (TransactionLine & { item: Item })[];
  salesPersonMembership?: (Membership & { user: User }) | null;
};

export async function getDefaultTemplate(tenantId: string) {
  return prisma.tenantPdfTemplate.findFirst({
    where: { tenantId, isDefault: true },
  });
}

export async function renderTransactionPdf(params: {
  transaction: TxWithLines;
  party: Party;
  tenant: Tenant;
  docLabel: string;
  viewOnlineUrl?: string;
  isSlip?: boolean;
}) {
  const template = await getDefaultTemplate(params.tenant.id);
  const baseStyle = getPdfStyle(template?.styleKey ?? (params.isSlip ? "slip-classic" : "minimal-mono"));
  // Per-field overrides on top of the base style — null/unset falls back
  // to whatever the chosen base style already says, so a template that's
  // never been touched beyond picking a style renders identically to before.
  const resolvedStyle: PdfStyleConfig = {
    ...baseStyle,
    ...(template?.accentColorHex ? { accentColor: template.accentColorHex } : {}),
    ...(template?.fontFamily ? { fontFamily: template.fontFamily as PdfStyleConfig["fontFamily"] } : {}),
    ...(template?.headerLayout ? { headerLayout: template.headerLayout as PdfStyleConfig["headerLayout"] } : {}),
    ...(template?.tableHeaderStyle
      ? { tableHeaderStyle: template.tableHeaderStyle as PdfStyleConfig["tableHeaderStyle"] }
      : {}),
    ...(template?.logoShape ? { logoShape: template.logoShape as PdfStyleConfig["logoShape"] } : {}),
  };

  const qrDataUrl = params.viewOnlineUrl ? await generateQrDataUrl(params.viewOnlineUrl) : undefined;

  const isProposal = params.transaction.quoteKind === "PROPOSAL";
  const data: DocumentData = {
    docLabel: params.docLabel,
    docNumber: params.transaction.id.slice(-8).toUpperCase(),
    date: params.transaction.createdAt.toLocaleDateString(),
    dueDate: params.transaction.dueAt?.toLocaleDateString(),
    tenantName: params.tenant.name,
    partyName: params.party.name,
    partyEmail: params.party.email ?? undefined,
    partyPhone: params.party.phone ?? undefined,
    lines: params.transaction.itemLines.map((l) => ({
      description: l.item.name,
      sku: l.item.sku,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      discountPercent: l.discountPercent,
      taxRatePercent: l.taxRatePercent,
    })),
    totalCents: params.transaction.amountCents,
    subject: params.transaction.subject,
    poNumber: params.transaction.poNumber,
    documentDiscountPercent: params.transaction.discountPercent,
    salesPerson: params.transaction.salesPersonMembership
      ? {
          name: params.transaction.salesPersonMembership.user.name,
          email: params.transaction.salesPersonMembership.user.email,
          phone: params.transaction.salesPersonMembership.user.phone,
        }
      : undefined,
    proposal: isProposal
      ? {
          introText: params.transaction.introText,
          scopeOfWork: params.transaction.scopeOfWork,
          projectLocation: params.transaction.projectLocation,
          performanceExpectancy: params.transaction.performanceExpectancy,
          projectTimeline: params.transaction.projectTimeline,
          systemInfo: params.transaction.systemInfo,
        }
      : undefined,
    qrDataUrl,
    viewOnlineUrl: params.viewOnlineUrl,
    logoDataUrl: template?.logoDataUrl ?? undefined,
    bankingDetails: params.tenant.bankAccountNumber
      ? {
          bankName: params.tenant.bankName,
          accountHolder: params.tenant.bankAccountHolder,
          accountNumber: params.tenant.bankAccountNumber,
          branchCode: params.tenant.bankBranchCode,
          swift: params.tenant.bankSwift,
        }
      : undefined,
    verifyWhatsappNumber: params.tenant.whatsappVerifyNumber ?? undefined,
    sectionOrder: (template?.sectionOrder as OptionalSectionKey[] | null) ?? undefined,
    hiddenSections: (template?.hiddenSections as OptionalSectionKey[] | null) ?? undefined,
  };

  return renderToBuffer(DocumentTemplate({ style: resolvedStyle, data }));
}
