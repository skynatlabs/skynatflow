// Shared renderer behind every PDF download in the app — resolves the
// tenant's chosen template (or the plain default if they haven't picked
// one), builds the QR/view-online link, and hands off to the one
// DocumentTemplate component so every document type gets the same
// branding/QR treatment for free.

import { renderToBuffer } from "@react-pdf/renderer";
import type { Transaction, TransactionLine, Item, Party, Tenant } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DocumentTemplate, type DocumentData } from "./DocumentTemplate";
import { getPdfStyle } from "./styles";
import { generateQrDataUrl } from "./qr";

type TxWithLines = Transaction & { itemLines: (TransactionLine & { item: Item })[] };

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
  const style = getPdfStyle(template?.styleKey ?? (params.isSlip ? "slip-classic" : "minimal-mono"));
  const resolvedStyle = template?.accentColorHex ? { ...style, accentColor: template.accentColorHex } : style;

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
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
    })),
    totalCents: params.transaction.amountCents,
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
  };

  return renderToBuffer(DocumentTemplate({ style: resolvedStyle, data }));
}
