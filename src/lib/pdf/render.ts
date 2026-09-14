// Shared renderer behind every PDF download in the app — resolves the
// tenant's chosen template (or the plain default if they haven't picked
// one), builds the QR/view-online link, and hands off to the one
// DocumentTemplate component so every document type gets the same
// branding/QR treatment for free.

import { renderToBuffer } from "@react-pdf/renderer";
import type { Transaction, TransactionLine, Item, Party, Tenant, Membership, User } from "@prisma/client";
import { prisma } from "@/lib/db";
import { DocumentTemplate, type DocumentData } from "./DocumentTemplate";
import { getPdfStyle, type PdfStyleConfig } from "./styles";
import { generateQrDataUrl } from "./qr";
import { totalPaid, totalRefunded } from "@/lib/core/money";

type TxWithLines = Transaction & {
  itemLines: (TransactionLine & { item: Item })[];
  salesPersonMembership?: (Membership & { user: User }) | null;
};

export type DocKind = "QUOTE" | "INVOICE" | "SLIP";

export async function getDefaultTemplate(tenantId: string) {
  return prisma.tenantPdfTemplate.findFirst({ where: { tenantId, isDefault: true } });
}

/**
 * The template this kind of document should use.
 *
 * A workspace wants a delivery slip to look nothing like a proposal, which a
 * single workspace-wide default could never express — before this, saving any
 * template meant slips rendered with the invoice design. A template scoped to
 * this document kind wins; otherwise the general default; otherwise nothing
 * and the base style stands in.
 */
export async function getTemplateFor(tenantId: string, kind: DocKind) {
  const scoped = await prisma.tenantPdfTemplate.findFirst({
    where: { tenantId, appliesTo: kind },
    orderBy: { createdAt: "asc" },
  });
  if (scoped) return scoped;

  return prisma.tenantPdfTemplate.findFirst({
    where: { tenantId, appliesTo: "ALL", isDefault: true },
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
  const kind: DocKind = params.isSlip
    ? "SLIP"
    : params.docLabel.toLowerCase().includes("invoice")
      ? "INVOICE"
      : "QUOTE";
  const template = await getTemplateFor(params.tenant.id, kind);
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
    ...(template?.textColorHex ? { textColor: template.textColorHex } : {}),
    ...(template?.mutedColorHex ? { mutedColor: template.mutedColorHex } : {}),
    ...(template?.fontScale ? { fontScale: template.fontScale } : {}),
    ...(template?.pageSize ? { pageSize: template.pageSize as PdfStyleConfig["pageSize"] } : {}),
    ...(template?.pageMargin
      ? { pageMargin: template.pageMargin as PdfStyleConfig["pageMargin"] }
      : {}),
    ...(template?.orientation
      ? { orientation: template.orientation as PdfStyleConfig["orientation"] }
      : {}),
    ...(template?.backgroundHex ? { backgroundHex: template.backgroundHex } : {}),
    margins: {
      top: template?.marginTopIn ?? undefined,
      bottom: template?.marginBottomIn ?? undefined,
      left: template?.marginLeftIn ?? undefined,
      right: template?.marginRightIn ?? undefined,
    },
  };

  const qrDataUrl = params.viewOnlineUrl ? await generateQrDataUrl(params.viewOnlineUrl) : undefined;

  // What has actually been received against this document, so "balance due"
  // is a real number rather than a repeat of the total.
  const [paid, refunded] = await Promise.all([
    totalPaid(params.transaction.id),
    totalRefunded(params.transaction.id),
  ]);
  const netPaidCents = Math.max(0, paid - refunded);

  const isProposal = params.transaction.quoteKind === "PROPOSAL";
  const data: DocumentData = {
    docLabel: params.docLabel,
    docNumber: params.transaction.id.slice(-8).toUpperCase(),
    date: params.transaction.createdAt.toLocaleDateString(),
    dueDate: params.transaction.dueAt?.toLocaleDateString(),
    tenantName: params.tenant.name,
    tenantAddress: params.tenant.businessAddress ?? undefined,
    tenantEmail: params.tenant.businessEmail ?? undefined,
    tenantPhone: params.tenant.businessPhone ?? undefined,
    tenantVatNumber: params.tenant.vatNumber ?? undefined,
    tenantRegNumber: params.tenant.registrationNumber ?? undefined,
    partyName: params.party.name,
    partyCompany: params.party.companyName ?? undefined,
    partyEmail: params.party.email ?? undefined,
    partyPhone: params.party.phone ?? undefined,
    partyAddress:
      [params.party.addressLine, params.party.city, params.party.postalCode]
        .filter(Boolean)
        .join(", ") || undefined,
    partyVatNumber: params.party.vatNumber ?? undefined,
    lines: params.transaction.itemLines.map((l) => ({
      description: l.item.name,
      notes: l.item.description,
      unit: l.item.unit,
      sku: l.item.sku,
      quantity: l.quantity,
      unitPriceCents: l.unitPriceCents,
      discountPercent: l.discountPercent,
      taxRatePercent: l.taxRatePercent,
    })),
    totalCents: params.transaction.amountCents,
    amountPaidCents: netPaidCents,
    paymentTerms: describeTerms(params.transaction.createdAt, params.transaction.dueAt),
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
    sections: template?.sections ?? undefined,
  };

  return renderToBuffer(DocumentTemplate({ style: resolvedStyle, data }));
}

/**
 * A believable document, for the template editor's preview.
 *
 * Real-looking data rather than "Lorem ipsum / Item 1": the whole point of a
 * preview is judging whether the layout works, and you cannot judge column
 * widths against placeholder text that is all the same length. Every optional
 * section has content here, so switching one on always shows something —
 * a preview where a toggle appears to do nothing is worse than no preview.
 */
export async function renderTemplatePreview(params: {
  tenantId: string;
  templateId: string;
}): Promise<Buffer> {
  const [template, tenant] = await Promise.all([
    prisma.tenantPdfTemplate.findFirst({
      where: { id: params.templateId, tenantId: params.tenantId },
    }),
    prisma.tenant.findUniqueOrThrow({ where: { id: params.tenantId } }),
  ]);
  if (!template) throw new Error("Template not found.");

  const baseStyle = getPdfStyle(template.styleKey);
  const style: PdfStyleConfig = {
    ...baseStyle,
    ...(template.accentColorHex ? { accentColor: template.accentColorHex } : {}),
    ...(template.textColorHex ? { textColor: template.textColorHex } : {}),
    ...(template.mutedColorHex ? { mutedColor: template.mutedColorHex } : {}),
    ...(template.fontFamily ? { fontFamily: template.fontFamily as PdfStyleConfig["fontFamily"] } : {}),
    ...(template.headerLayout ? { headerLayout: template.headerLayout as PdfStyleConfig["headerLayout"] } : {}),
    ...(template.tableHeaderStyle
      ? { tableHeaderStyle: template.tableHeaderStyle as PdfStyleConfig["tableHeaderStyle"] }
      : {}),
    ...(template.logoShape ? { logoShape: template.logoShape as PdfStyleConfig["logoShape"] } : {}),
    ...(template.fontScale ? { fontScale: template.fontScale } : {}),
    ...(template.pageSize ? { pageSize: template.pageSize as PdfStyleConfig["pageSize"] } : {}),
    ...(template.pageMargin ? { pageMargin: template.pageMargin as PdfStyleConfig["pageMargin"] } : {}),
    ...(template.orientation
      ? { orientation: template.orientation as PdfStyleConfig["orientation"] }
      : {}),
    ...(template.backgroundHex ? { backgroundHex: template.backgroundHex } : {}),
    margins: {
      top: template.marginTopIn ?? undefined,
      bottom: template.marginBottomIn ?? undefined,
      left: template.marginLeftIn ?? undefined,
      right: template.marginRightIn ?? undefined,
    },
  };

  const label =
    template.appliesTo === "INVOICE"
      ? "Invoice"
      : template.appliesTo === "SLIP"
        ? "Delivery Slip"
        : "Quote";

  const data: DocumentData = {
    docLabel: label,
    docNumber: "PREVIEW-1042",
    date: new Date().toLocaleDateString(),
    dueDate: new Date(Date.now() + 30 * 86_400_000).toLocaleDateString(),
    tenantName: tenant.name,
    tenantAddress: tenant.businessAddress ?? "12 Long Street, Cape Town, 8001",
    tenantEmail: tenant.businessEmail ?? "accounts@yourbusiness.co.za",
    tenantPhone: tenant.businessPhone ?? "+27 21 555 0100",
    tenantVatNumber: tenant.vatNumber ?? "4123456789",
    tenantRegNumber: tenant.registrationNumber ?? "2019/123456/07",
    partyName: "Isaac Dlamini",
    partyCompany: "Acme Trading (Pty) Ltd",
    partyEmail: "isaac@acmetrading.co.za",
    partyPhone: "+27 82 555 1234",
    partyAddress: "48 Marine Drive, Durban, 4001",
    partyVatNumber: "4987654321",
    subject: "Rooftop solar installation — phase one",
    poNumber: "PO-88213",
    lines: [
      {
        description: "Solar panel 450W",
        notes: "Tier-1 monocrystalline, 25-year performance warranty.",
        unit: "panels",
        sku: "SP-450",
        quantity: 12,
        unitPriceCents: 125_000,
        taxRatePercent: 15,
      },
      {
        description: "Hybrid inverter 8kVA",
        notes: "Grid-tied with battery backup and load management.",
        sku: "INV-8K",
        quantity: 1,
        unitPriceCents: 2_450_000,
        discountPercent: 5,
        taxRatePercent: 15,
      },
      {
        description: "Mounting rails and fixings",
        unit: "m",
        sku: "MNT-STD",
        quantity: 24,
        unitPriceCents: 18_500,
        taxRatePercent: 15,
      },
      {
        description: "Installation and commissioning",
        notes: "Includes CoC certificate and handover.",
        quantity: 1,
        unitPriceCents: 1_850_000,
        taxRatePercent: 15,
      },
    ],
    totalCents: 6_012_750,
    // A part payment, so the payments-received and balance-due switches show
    // something when they are turned on.
    amountPaidCents: 2_000_000,
    paymentTerms: "Due in 30 days",
    documentDiscountPercent: 2.5,
    salesPerson: { name: "Thandi Nkosi", email: "thandi@yourbusiness.co.za", phone: "+27 83 555 9090" },
    proposal: {
      introText:
        "Thank you for the opportunity to quote. The system below is sized for your current consumption with room to expand.",
      projectLocation: "48 Marine Drive, Durban",
      scopeOfWork:
        "Supply and install a 5.4kWp rooftop array with an 8kVA hybrid inverter, including mounting, DC/AC reticulation, and CoC certification.",
      systemInfo: "12 x 450W panels, 8kVA hybrid inverter, 10.2kWh lithium storage.",
      performanceExpectancy: "Approximately 780kWh per month, weather dependent.",
      projectTimeline: "Three working days on site, within four weeks of acceptance.",
    },
    viewOnlineUrl: "https://flow.skynat.co/portal/preview",
    // A real QR, so switching the footer's QR off visibly does something.
    qrDataUrl: await generateQrDataUrl("https://flow.skynat.co/portal/preview"),
    logoDataUrl: template.logoDataUrl ?? undefined,
    bankingDetails: tenant.bankAccountNumber
      ? {
          bankName: tenant.bankName,
          accountHolder: tenant.bankAccountHolder,
          accountNumber: tenant.bankAccountNumber,
          branchCode: tenant.bankBranchCode,
          swift: tenant.bankSwift,
        }
      : {
          bankName: "Standard Bank",
          accountHolder: tenant.name,
          accountNumber: "001 234 567",
          branchCode: "051001",
          swift: "SBZAZAJJ",
        },
    verifyWhatsappNumber: tenant.whatsappVerifyNumber ?? "+27 21 555 0100",
    sections: template.sections ?? undefined,
  };

  return renderToBuffer(DocumentTemplate({ style, data }));
}

/** "Due on receipt" / "Due in 30 days", read off the dates we already have. */
function describeTerms(issuedAt: Date, dueAt: Date | null): string | undefined {
  if (!dueAt) return undefined;
  const days = Math.round((dueAt.getTime() - issuedAt.getTime()) / 86_400_000);
  if (days <= 0) return "Due on receipt";
  if (days === 1) return "Due in 1 day";
  return `Due in ${days} days`;
}
