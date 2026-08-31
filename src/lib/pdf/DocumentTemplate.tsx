// The one shared, parameterized PDF renderer behind every style in
// styles.ts — genuine layout variation comes from headerLayout/
// tableHeaderStyle/logoShape branching below, not just a color swap, but
// it's one component so every template gets QR code, view-online link,
// and flow branding for free and consistently, rather than needing to be
// added to 12 separate hand-written files.

import { Document, Page, Text, View, StyleSheet, Image, Font } from "@react-pdf/renderer";
import type { PdfStyleConfig } from "./styles";
import { computeDocumentTotal } from "@/lib/core/pricing";

export interface DocumentLine {
  description: string;
  sku?: string | null;
  quantity: number;
  unitPriceCents: number;
  discountPercent?: number | null;
  taxRatePercent?: number | null;
}

export interface DocumentData {
  docLabel: string; // "Quote" | "Proposal" | "Invoice" | "Delivery Slip" | "Receipt"
  docNumber: string;
  date: string;
  dueDate?: string;
  tenantName: string;
  tenantAddress?: string;
  partyName: string;
  partyEmail?: string;
  partyPhone?: string;
  lines: DocumentLine[];
  totalCents: number;
  currency?: string;
  terms?: string;
  subject?: string | null;
  poNumber?: string | null;
  documentDiscountPercent?: number | null;
  salesPerson?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  proposal?: {
    introText?: string | null;
    scopeOfWork?: string | null;
    projectLocation?: string | null;
    performanceExpectancy?: string | null;
    projectTimeline?: string | null;
    systemInfo?: string | null;
  };
  qrDataUrl?: string;
  viewOnlineUrl?: string;
  logoDataUrl?: string;
  bankingDetails?: {
    bankName?: string | null;
    accountHolder?: string | null;
    accountNumber?: string | null;
    branchCode?: string | null;
    swift?: string | null;
  };
  verifyWhatsappNumber?: string;
  // Drag-to-reorder builder output: which of the optional blocks below
  // the items table appear, and in what order. Missing = the historical
  // fixed order with nothing hidden, so existing templates render exactly
  // as before this feature existed.
  sectionOrder?: OptionalSectionKey[];
  hiddenSections?: OptionalSectionKey[];
}

export type OptionalSectionKey = "terms" | "bankingDetails" | "verify";
export const DEFAULT_SECTION_ORDER: OptionalSectionKey[] = ["terms", "bankingDetails", "verify"];

function money(cents: number, currency = "ZAR") {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency });
}

export function DocumentTemplate({ style, data }: { style: PdfStyleConfig; data: DocumentData }) {
  const s = buildStyles(style);
  const isSlip = style.isSlip;

  return (
    <Document>
      <Page size="A4" style={s.page}>
        {style.headerLayout === "band" && <View style={s.band} />}

        <View style={style.headerLayout === "split" ? s.headerSplit : s.headerBlock}>
          <View style={s.headerLeft}>
            {data.logoDataUrl && (
              <Image
                src={data.logoDataUrl}
                style={style.logoShape === "circle" ? s.logoCircle : s.logoSquare}
              />
            )}
            <Text style={s.tenantName}>{data.tenantName}</Text>
            {data.tenantAddress && <Text style={s.muted}>{data.tenantAddress}</Text>}
          </View>
          <View style={s.headerRight}>
            <Text style={s.docLabel}>{data.docLabel.toUpperCase()}</Text>
            <Text style={s.muted}>No. {data.docNumber}</Text>
            <Text style={s.muted}>Date: {data.date}</Text>
            {data.dueDate && <Text style={s.muted}>Due: {data.dueDate}</Text>}
            {data.poNumber && <Text style={s.muted}>PO #: {data.poNumber}</Text>}
          </View>
        </View>

        {data.subject && !isSlip && (
          <View style={s.section}>
            <Text style={s.paragraph}>{data.subject}</Text>
          </View>
        )}

        {!isSlip && (
          <View style={style.headerLayout === "split" ? s.headerSplit : undefined}>
            <View style={s.section}>
              <Text style={s.sectionLabel}>To</Text>
              <Text style={s.paragraph}>{data.partyName}</Text>
              {data.partyEmail && <Text style={s.muted}>{data.partyEmail}</Text>}
              {data.partyPhone && <Text style={s.muted}>{data.partyPhone}</Text>}
            </View>
            {data.salesPerson?.name && (
              <View style={s.section}>
                <Text style={s.sectionLabel}>Sales rep</Text>
                <Text style={s.paragraph}>{data.salesPerson.name}</Text>
                {data.salesPerson.email && <Text style={s.muted}>{data.salesPerson.email}</Text>}
                {data.salesPerson.phone && <Text style={s.muted}>{data.salesPerson.phone}</Text>}
              </View>
            )}
          </View>
        )}

        {data.proposal && (
          <>
            {data.proposal.introText && (
              <View style={s.section}>
                <Text style={s.paragraph}>{data.proposal.introText}</Text>
              </View>
            )}
            {data.proposal.projectLocation && (
              <View style={s.section}>
                <Text style={s.sectionLabel}>Project location</Text>
                <Text style={s.paragraph}>{data.proposal.projectLocation}</Text>
              </View>
            )}
            {data.proposal.scopeOfWork && (
              <View style={s.section}>
                <Text style={s.sectionLabel}>Scope of work</Text>
                <Text style={s.paragraph}>{data.proposal.scopeOfWork}</Text>
              </View>
            )}
            {data.proposal.systemInfo && (
              <View style={s.section}>
                <Text style={s.sectionLabel}>System / equipment</Text>
                <Text style={s.paragraph}>{data.proposal.systemInfo}</Text>
              </View>
            )}
            {data.proposal.performanceExpectancy && (
              <View style={s.section}>
                <Text style={s.sectionLabel}>Expected performance</Text>
                <Text style={s.paragraph}>{data.proposal.performanceExpectancy}</Text>
              </View>
            )}
            {data.proposal.projectTimeline && (
              <View style={s.section}>
                <Text style={s.sectionLabel}>Project timeline</Text>
                <Text style={s.paragraph}>{data.proposal.projectTimeline}</Text>
              </View>
            )}
          </>
        )}

        <View style={s.table}>
          {style.tableHeaderStyle !== "line-only" && (
            <View style={style.tableHeaderStyle === "dark" ? s.tableHeadDark : s.tableHeadAccent}>
              <Text style={[s.tableHeadCell, s.colDesc]}>Description</Text>
              <Text style={[s.tableHeadCell, s.colQty]}>Qty</Text>
              <Text style={[s.tableHeadCell, s.colAmount]}>Amount</Text>
            </View>
          )}
          {data.lines.map((line, i) => {
            const gross = line.quantity * line.unitPriceCents;
            const afterDiscount = gross * (1 - (line.discountPercent ?? 0) / 100);
            const lineTotal = afterDiscount * (1 + (line.taxRatePercent ?? 0) / 100);
            return (
              <View style={s.row} key={i}>
                <View style={s.colDesc}>
                  <Text>{line.description}</Text>
                  {(line.sku || line.discountPercent || line.taxRatePercent) && (
                    <Text style={s.lineSubtext}>
                      {[
                        line.sku && `SKU: ${line.sku}`,
                        line.discountPercent ? `${line.discountPercent}% disc` : null,
                        line.taxRatePercent ? `${line.taxRatePercent}% tax` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </Text>
                  )}
                </View>
                <Text style={s.colQty}>{line.quantity}</Text>
                <Text style={s.colAmount}>{money(lineTotal, data.currency)}</Text>
              </View>
            );
          })}
          {(() => {
            const breakdown = computeDocumentTotal(
              data.lines.map((l) => ({
                quantity: l.quantity,
                unitPriceCents: l.unitPriceCents,
                discountPercent: l.discountPercent,
                taxRatePercent: l.taxRatePercent,
              })),
              data.documentDiscountPercent ?? 0
            );
            return (
              <>
                {(breakdown.lineDiscountCents > 0 || breakdown.taxCents > 0 || breakdown.documentDiscountCents > 0) && (
                  <View style={s.subtotalBlock}>
                    <View style={s.subtotalRow}>
                      <Text style={s.muted}>Subtotal</Text>
                      <Text style={s.muted}>{money(breakdown.subtotalCents, data.currency)}</Text>
                    </View>
                    {breakdown.lineDiscountCents > 0 && (
                      <View style={s.subtotalRow}>
                        <Text style={s.muted}>Line discounts</Text>
                        <Text style={s.muted}>&minus;{money(breakdown.lineDiscountCents, data.currency)}</Text>
                      </View>
                    )}
                    {breakdown.taxCents > 0 && (
                      <View style={s.subtotalRow}>
                        <Text style={s.muted}>Tax</Text>
                        <Text style={s.muted}>{money(breakdown.taxCents, data.currency)}</Text>
                      </View>
                    )}
                    {breakdown.documentDiscountCents > 0 && (
                      <View style={s.subtotalRow}>
                        <Text style={s.muted}>Discount ({data.documentDiscountPercent}%)</Text>
                        <Text style={s.muted}>&minus;{money(breakdown.documentDiscountCents, data.currency)}</Text>
                      </View>
                    )}
                  </View>
                )}
                <View style={s.totalRow}>
                  <Text style={s.totalLabel}>Total</Text>
                  <Text style={s.totalValue}>{money(data.totalCents, data.currency)}</Text>
                </View>
              </>
            );
          })()}
        </View>

        {!isSlip &&
          (data.sectionOrder ?? DEFAULT_SECTION_ORDER)
            .filter((key) => !data.hiddenSections?.includes(key))
            .map((key) => {
              if (key === "terms" && data.terms) {
                return (
                  <View style={s.section} key={key}>
                    <Text style={s.sectionLabel}>Terms</Text>
                    <Text style={s.muted}>{data.terms}</Text>
                  </View>
                );
              }
              if (key === "bankingDetails" && data.bankingDetails?.accountNumber) {
                const b = data.bankingDetails;
                return (
                  <View style={s.section} key={key}>
                    <Text style={s.sectionLabel}>Banking details</Text>
                    {b.bankName && <Text style={s.muted}>Bank: {b.bankName}</Text>}
                    {b.accountHolder && <Text style={s.muted}>Account holder: {b.accountHolder}</Text>}
                    <Text style={s.muted}>Account number: {b.accountNumber}</Text>
                    {b.branchCode && <Text style={s.muted}>Branch code: {b.branchCode}</Text>}
                    {b.swift && <Text style={s.muted}>SWIFT: {b.swift}</Text>}
                  </View>
                );
              }
              if (key === "verify" && data.verifyWhatsappNumber) {
                return (
                  <View style={s.section} key={key}>
                    <Text style={s.sectionLabel}>Verify this document</Text>
                    <Text style={s.muted}>
                      To confirm this {data.docLabel.toLowerCase()} genuinely came from{" "}
                      {data.tenantName}, message {data.verifyWhatsappNumber} on WhatsApp — never pay
                      or accept based on a document alone.
                    </Text>
                  </View>
                );
              }
              return null;
            })}

        <View style={s.footer}>
          <View style={s.footerLeft}>
            {data.viewOnlineUrl && (
              <Text style={s.footerLink}>View &amp; pay online: {data.viewOnlineUrl}</Text>
            )}
            <Text style={s.footerBrand}>Generated with flow — by Skynat · flow.skynat.co</Text>
          </View>
          {data.qrDataUrl && <Image src={data.qrDataUrl} style={s.qr} />}
        </View>
      </Page>
    </Document>
  );
}

function buildStyles(style: PdfStyleConfig) {
  const font = style.fontFamily;
  return StyleSheet.create({
    page: { padding: 40, fontSize: 10, color: style.textColor, fontFamily: font },
    band: { position: "absolute", top: 0, left: 0, right: 0, height: 60, backgroundColor: style.accentColor },
    headerBlock: { marginTop: style.headerLayout === "band" ? 30 : 0, marginBottom: 20, alignItems: style.headerLayout === "centered" ? "center" : "flex-start" },
    headerSplit: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
    headerLeft: { alignItems: style.headerLayout === "centered" ? "center" : "flex-start" },
    headerRight: { alignItems: style.headerLayout === "centered" ? "center" : "flex-end" },
    logoCircle: { width: 36, height: 36, borderRadius: 18, marginBottom: 6, objectFit: "cover" },
    logoSquare: { width: 36, height: 36, marginBottom: 6, objectFit: "cover" },
    tenantName: { fontSize: 16, fontWeight: 700, color: style.headerLayout === "band" ? "#ffffff" : style.textColor },
    docLabel: { fontSize: 18, fontWeight: 700, color: style.accentColor, marginBottom: 4 },
    muted: { fontSize: 9, color: style.headerLayout === "band" ? "#ffffff" : style.mutedColor },
    section: { marginBottom: 14 },
    sectionLabel: { fontSize: 8, textTransform: "uppercase", letterSpacing: 0.5, color: style.mutedColor, marginBottom: 3 },
    paragraph: { fontSize: 10, lineHeight: 1.5 },
    table: { marginTop: 10 },
    tableHeadDark: { flexDirection: "row", backgroundColor: style.textColor, padding: 6 },
    tableHeadAccent: { flexDirection: "row", backgroundColor: style.accentColor, padding: 6 },
    tableHeadCell: { fontSize: 9, fontWeight: 700, color: "#ffffff", textTransform: "uppercase" },
    row: { flexDirection: "row", paddingVertical: 6, borderBottom: `1pt solid ${style.mutedColor}55` },
    colDesc: { flex: 3 },
    colQty: { flex: 1, textAlign: "center" },
    colAmount: { flex: 1, textAlign: "right" },
    totalRow: { flexDirection: "row", justifyContent: "space-between", paddingTop: 10, marginTop: 6, borderTop: `1pt solid ${style.textColor}` },
    totalLabel: { fontSize: 12, fontWeight: 700 },
    totalValue: { fontSize: 12, fontWeight: 700, color: style.accentColor },
    lineSubtext: { fontSize: 7.5, color: style.mutedColor, marginTop: 2 },
    subtotalBlock: { marginTop: 8, alignItems: "flex-end" },
    subtotalRow: { flexDirection: "row", justifyContent: "space-between", width: 180, paddingVertical: 2 },
    footer: { position: "absolute", bottom: 30, left: 40, right: 40, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
    footerLeft: { flexDirection: "column", gap: 2 },
    footerLink: { fontSize: 8, color: style.mutedColor },
    footerBrand: { fontSize: 7, color: style.mutedColor, marginTop: 4 },
    qr: { width: 46, height: 46 },
  });
}
