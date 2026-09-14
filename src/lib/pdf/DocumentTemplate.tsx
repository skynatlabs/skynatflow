// The one shared, parameterized PDF renderer behind every style in styles.ts.
//
// It used to hardcode the page: header, then customer, then the table, then
// three optional blocks that could be reordered. Everything else was fixed
// code, and one of those three — terms — had no field anywhere in the app to
// write its text, so it rendered empty whatever you did with it.
//
// Now the page is built from a resolved section list (lib/pdf/sections.ts).
// Each section decides its own heading, its own body text, which of its
// fields appear, and where it sits. The renderer walks the list; it does not
// know the document's shape in advance.
//
// Still one component, so QR, view-online link and branding are gained once
// by every template rather than needing to exist in twelve hand-written files.

import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import type { PdfStyleConfig } from "./styles";
import { PAGE_MARGINS, PT_PER_INCH } from "./styles";
import { computeDocumentTotal } from "@/lib/core/pricing";
import {
  resolveSections,
  sectionsFor,
  findSection,
  fieldOn,
  SECTION_BY_KEY,
  type SectionConfig,
} from "./sections";

export interface DocumentLine {
  description: string;
  /** The lighter explanatory line under the item name. */
  notes?: string | null;
  /** "m", "pcs", "hours" — printed under the quantity. */
  unit?: string | null;
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
  tenantEmail?: string;
  tenantPhone?: string;
  tenantVatNumber?: string;
  tenantRegNumber?: string;
  partyName: string;
  partyCompany?: string;
  partyEmail?: string;
  partyPhone?: string;
  partyAddress?: string;
  partyVatNumber?: string;
  lines: DocumentLine[];
  totalCents: number;
  /** Payments already received, for the balance-due line. */
  amountPaidCents?: number;
  /** "Due on receipt", "30 days" — shown beside the dates. */
  paymentTerms?: string;
  currency?: string;
  subject?: string | null;
  poNumber?: string | null;
  documentDiscountPercent?: number | null;
  salesPerson?: { name?: string | null; email?: string | null; phone?: string | null } | null;
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
  /** The section-by-section layout. Undefined = catalogue defaults. */
  sections?: unknown;
}

function money(cents: number, currency = "ZAR") {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency });
}

export function DocumentTemplate({ style, data }: { style: PdfStyleConfig; data: DocumentData }) {
  const s = buildStyles(style);
  // No isSlip branching any more. A slip used to be "the invoice layout with
  // several blocks silently suppressed"; now a slip is a template whose
  // sections say so, which is both clearer and editable.
  const sections = resolveSections(data.sections);
  const header = sectionsFor(sections, "header");
  const body = sectionsFor(sections, "body");
  const footer = findSection(sections, "footer");

  /** A section's heading, unless the owner cleared it. */
  const heading = (section: SectionConfig) => {
    const title = section.title ?? SECTION_BY_KEY[section.key].title;
    if (!title) return null;
    return <Text style={s.sectionLabel}>{title}</Text>;
  };

  const alignOf = (section: SectionConfig) =>
    section.align === "center"
      ? ("center" as const)
      : section.align === "right"
        ? ("flex-end" as const)
        : ("flex-start" as const);

  // ------------------------------------------------------------- header parts
  const renderHeaderPart = (section: SectionConfig) => {
    if (section.key === "logo") {
      if (!data.logoDataUrl || style.logoShape === "none") return null;
      // A 36pt mark suits a minimal letterhead and looks lost on a design
      // built around the logo, which is why this is a control rather than a
      // constant.
      const size = section.size === "large" ? 132 : section.size === "medium" ? 78 : 36;
      return (
        <Image
          key="logo"
          src={data.logoDataUrl}
          style={{
            width: size,
            height: size,
            marginBottom: 8,
            objectFit: "contain",
            ...(style.logoShape === "circle" ? { borderRadius: size / 2 } : {}),
          }}
        />
      );
    }

    if (section.key === "companyDetails") {
      return (
        <View key="companyDetails" style={{ alignItems: alignOf(section) }}>
          {fieldOn(section, "name") && <Text style={s.tenantName}>{data.tenantName}</Text>}
          {fieldOn(section, "address") && data.tenantAddress && (
            <Text style={s.muted}>{data.tenantAddress}</Text>
          )}
          {fieldOn(section, "email") && data.tenantEmail && (
            <Text style={s.muted}>{data.tenantEmail}</Text>
          )}
          {fieldOn(section, "phone") && data.tenantPhone && (
            <Text style={s.muted}>{data.tenantPhone}</Text>
          )}
          {fieldOn(section, "vatNumber") && data.tenantVatNumber && (
            <Text style={s.muted}>VAT: {data.tenantVatNumber}</Text>
          )}
          {fieldOn(section, "regNumber") && data.tenantRegNumber && (
            <Text style={s.muted}>Reg: {data.tenantRegNumber}</Text>
          )}
        </View>
      );
    }

    return null;
  };

  const metaSection = header.find((h) => h.key === "documentMeta");
  const renderMeta = () =>
    metaSection ? (
      <View style={s.headerRight}>
        {fieldOn(metaSection, "docLabel") && (
          <Text style={s.docLabel}>
            {(metaSection.title || data.docLabel).toUpperCase()}
          </Text>
        )}
        {fieldOn(metaSection, "docNumber") && <Text style={s.muted}>No. {data.docNumber}</Text>}
        {fieldOn(metaSection, "date") && <Text style={s.muted}>Date: {data.date}</Text>}
        {fieldOn(metaSection, "dueDate") && data.dueDate && (
          <Text style={s.muted}>Due: {data.dueDate}</Text>
        )}
        {fieldOn(metaSection, "terms") && data.paymentTerms && (
          <Text style={s.muted}>Terms: {data.paymentTerms}</Text>
        )}
        {fieldOn(metaSection, "poNumber") && data.poNumber && (
          <Text style={s.muted}>PO #: {data.poNumber}</Text>
        )}
        {fieldOn(metaSection, "balanceDue") && (
          <View style={s.balanceHead}>
            <Text style={s.balanceHeadLabel}>Balance Due</Text>
            <Text style={s.balanceHeadValue}>
              {money(Math.max(0, data.totalCents - (data.amountPaidCents ?? 0)), data.currency)}
            </Text>
          </View>
        )}
      </View>
    ) : null;

  // --------------------------------------------------------------- body parts
  const renderBodyPart = (section: SectionConfig) => {
    switch (section.key) {
      case "customerDetails": {
        return (
          <View style={s.section} key={section.key}>
            {heading(section)}
            {fieldOn(section, "name") && <Text style={s.paragraph}>{data.partyName}</Text>}
            {fieldOn(section, "company") && data.partyCompany && (
              <Text style={s.muted}>{data.partyCompany}</Text>
            )}
            {fieldOn(section, "address") && data.partyAddress && (
              <Text style={s.muted}>{data.partyAddress}</Text>
            )}
            {fieldOn(section, "email") && data.partyEmail && (
              <Text style={s.muted}>{data.partyEmail}</Text>
            )}
            {fieldOn(section, "phone") && data.partyPhone && (
              <Text style={s.muted}>{data.partyPhone}</Text>
            )}
            {fieldOn(section, "vatNumber") && data.partyVatNumber && (
              <Text style={s.muted}>VAT: {data.partyVatNumber}</Text>
            )}
          </View>
        );
      }

      case "salesRep": {
        if (!data.salesPerson?.name) return null;
        return (
          <View style={s.section} key={section.key}>
            {heading(section)}
            {fieldOn(section, "name") && <Text style={s.paragraph}>{data.salesPerson.name}</Text>}
            {fieldOn(section, "email") && data.salesPerson.email && (
              <Text style={s.muted}>{data.salesPerson.email}</Text>
            )}
            {fieldOn(section, "phone") && data.salesPerson.phone && (
              <Text style={s.muted}>{data.salesPerson.phone}</Text>
            )}
          </View>
        );
      }

      case "subject": {
        if (!data.subject) return null;
        return (
          <View style={s.section} key={section.key}>
            {heading(section)}
            <Text style={s.paragraph}>{data.subject}</Text>
          </View>
        );
      }

      case "proposalIntro": {
        if (!data.proposal?.introText) return null;
        return (
          <View style={s.section} key={section.key}>
            {heading(section)}
            <Text style={s.paragraph}>{data.proposal.introText}</Text>
          </View>
        );
      }

      case "projectDetails": {
        if (!data.proposal) return null;
        const rows: [string, string, string | null | undefined][] = [
          ["projectLocation", "Project location", data.proposal.projectLocation],
          ["scopeOfWork", "Scope of work", data.proposal.scopeOfWork],
          ["systemInfo", "System / equipment", data.proposal.systemInfo],
          ["performanceExpectancy", "Expected performance", data.proposal.performanceExpectancy],
          ["projectTimeline", "Project timeline", data.proposal.projectTimeline],
        ];
        const shown = rows.filter(([key, , value]) => fieldOn(section, key) && value);
        if (shown.length === 0) return null;
        return (
          <View key={section.key}>
            {shown.map(([key, label, value]) => (
              <View style={s.section} key={key}>
                <Text style={s.sectionLabel}>{label}</Text>
                <Text style={s.paragraph}>{value}</Text>
              </View>
            ))}
          </View>
        );
      }

      case "itemsTable":
        return renderItems(section);

      case "totals":
        return renderTotals(section);

      case "notes":
      case "terms": {
        if (!section.body) return null;
        return (
          <View style={s.section} key={section.key}>
            {heading(section)}
            <Text style={s.muted}>{section.body}</Text>
          </View>
        );
      }

      case "bankingDetails": {
        const b = data.bankingDetails;
        if (!b?.accountNumber) return null;
        return (
          <View style={s.calloutBox} key={section.key} wrap={false}>
            {heading(section)}
            {fieldOn(section, "bankName") && b.bankName && (
              <Text style={s.muted}>Bank: {b.bankName}</Text>
            )}
            {fieldOn(section, "accountHolder") && b.accountHolder && (
              <Text style={s.muted}>Account holder: {b.accountHolder}</Text>
            )}
            {fieldOn(section, "accountNumber") && (
              <Text style={s.muted}>Account number: {b.accountNumber}</Text>
            )}
            {fieldOn(section, "branchCode") && b.branchCode && (
              <Text style={s.muted}>Branch code: {b.branchCode}</Text>
            )}
            {fieldOn(section, "swift") && b.swift && <Text style={s.muted}>SWIFT: {b.swift}</Text>}
          </View>
        );
      }

      case "signature": {
        return (
          <View style={s.section} key={section.key} wrap={false}>
            {heading(section)}
            {section.body && <Text style={s.muted}>{section.body}</Text>}
            <View style={s.signatureRow}>
              {fieldOn(section, "signature") && (
                <View style={s.signatureCell}>
                  <View style={s.signatureLine} />
                  <Text style={s.muted}>Signature</Text>
                </View>
              )}
              {fieldOn(section, "name") && (
                <View style={s.signatureCell}>
                  <View style={s.signatureLine} />
                  <Text style={s.muted}>Name</Text>
                </View>
              )}
              {fieldOn(section, "date") && (
                <View style={s.signatureCell}>
                  <View style={s.signatureLine} />
                  <Text style={s.muted}>Date</Text>
                </View>
              )}
            </View>
          </View>
        );
      }

      case "verify": {
        if (!data.verifyWhatsappNumber) return null;
        return (
          <View style={s.calloutBox} key={section.key} wrap={false}>
            {heading(section)}
            <Text style={s.muted}>
              To confirm this {data.docLabel.toLowerCase()} genuinely came from {data.tenantName},
              message {data.verifyWhatsappNumber} on WhatsApp — never pay or accept based on a
              document alone.
            </Text>
          </View>
        );
      }

      default:
        return null;
    }
  };

  // ------------------------------------------------------------- items table
  function renderItems(section: SectionConfig) {
    const cols = {
      rowNumber: fieldOn(section, "rowNumber"),
      lineNotes: fieldOn(section, "lineNotes"),
      sku: fieldOn(section, "sku"),
      quantity: fieldOn(section, "quantity"),
      unitPrice: fieldOn(section, "unitPrice"),
      discount: fieldOn(section, "discount"),
      tax: fieldOn(section, "tax"),
      amount: fieldOn(section, "amount"),
    };

    return (
      <View style={s.table} key={section.key}>
        {style.tableHeaderStyle !== "line-only" && (
          <View style={style.tableHeaderStyle === "dark" ? s.tableHeadDark : s.tableHeadAccent}>
            {cols.rowNumber && <Text style={[s.tableHeadCell, s.colIndex]}>#</Text>}
            <Text style={[s.tableHeadCell, s.colDesc]}>Description</Text>
            {cols.sku && <Text style={[s.tableHeadCell, s.colSmall]}>SKU</Text>}
            {cols.quantity && <Text style={[s.tableHeadCell, s.colQty]}>Qty</Text>}
            {cols.unitPrice && <Text style={[s.tableHeadCell, s.colAmount]}>Unit</Text>}
            {cols.discount && <Text style={[s.tableHeadCell, s.colSmall]}>Disc</Text>}
            {cols.tax && <Text style={[s.tableHeadCell, s.colSmall]}>Tax</Text>}
            {cols.amount && <Text style={[s.tableHeadCell, s.colAmount]}>Amount</Text>}
          </View>
        )}
        {data.lines.map((line, i) => {
          const gross = line.quantity * line.unitPriceCents;
          const afterDiscount = gross * (1 - (line.discountPercent ?? 0) / 100);
          const lineTotal = afterDiscount * (1 + (line.taxRatePercent ?? 0) / 100);
          return (
            <View style={s.row} key={i}>
              {cols.rowNumber && <Text style={s.colIndex}>{i + 1}</Text>}
              <View style={s.colDesc}>
                <Text>{line.description}</Text>
                {cols.lineNotes && line.notes && (
                  <Text style={s.lineNotes}>{line.notes}</Text>
                )}
              </View>
              {cols.sku && <Text style={s.colSmall}>{line.sku ?? "—"}</Text>}
              {cols.quantity && (
                <View style={s.colQty}>
                  <Text style={s.qtyValue}>{line.quantity.toFixed(2)}</Text>
                  {line.unit && <Text style={s.lineNotes}>{line.unit}</Text>}
                </View>
              )}
              {cols.unitPrice && (
                <Text style={s.colAmount}>{money(line.unitPriceCents, data.currency)}</Text>
              )}
              {cols.discount && (
                <Text style={s.colSmall}>
                  {line.discountPercent ? `${line.discountPercent}%` : "—"}
                </Text>
              )}
              {cols.tax && (
                <Text style={s.colSmall}>
                  {line.taxRatePercent ? `${line.taxRatePercent}%` : "—"}
                </Text>
              )}
              {cols.amount && (
                <Text style={s.colAmount}>{money(lineTotal, data.currency)}</Text>
              )}
            </View>
          );
        })}
      </View>
    );
  }

  // ----------------------------------------------------------------- totals
  function renderTotals(section: SectionConfig) {
    const breakdown = computeDocumentTotal(
      data.lines.map((l) => ({
        quantity: l.quantity,
        unitPriceCents: l.unitPriceCents,
        discountPercent: l.discountPercent,
        taxRatePercent: l.taxRatePercent,
      })),
      data.documentDiscountPercent ?? 0
    );

    const showSubtotal = fieldOn(section, "subtotal");
    const showLineDiscounts = fieldOn(section, "lineDiscounts") && breakdown.lineDiscountCents > 0;
    const showTax = fieldOn(section, "tax") && breakdown.taxCents > 0;
    const showDocDiscount =
      fieldOn(section, "documentDiscount") && breakdown.documentDiscountCents > 0;
    const anyBreakdown = showLineDiscounts || showTax || showDocDiscount;

    return (
      // wrap={false} keeps the whole totals block on one page. Without it the
      // subtotal lines can sit at the foot of page one and the Total land at
      // the top of page two, which on an invoice reads as a mistake.
      <View key={section.key} wrap={false}>
        {anyBreakdown && showSubtotal && (
          <View style={s.subtotalBlock}>
            <View style={s.subtotalRow}>
              <Text style={s.muted}>Subtotal</Text>
              <Text style={s.muted}>{money(breakdown.subtotalCents, data.currency)}</Text>
            </View>
            {showLineDiscounts && (
              <View style={s.subtotalRow}>
                <Text style={s.muted}>Line discounts</Text>
                <Text style={s.muted}>
                  &minus;{money(breakdown.lineDiscountCents, data.currency)}
                </Text>
              </View>
            )}
            {showTax && (
              <View style={s.subtotalRow}>
                <Text style={s.muted}>Tax</Text>
                <Text style={s.muted}>{money(breakdown.taxCents, data.currency)}</Text>
              </View>
            )}
            {showDocDiscount && (
              <View style={s.subtotalRow}>
                <Text style={s.muted}>Discount ({data.documentDiscountPercent}%)</Text>
                <Text style={s.muted}>
                  &minus;{money(breakdown.documentDiscountCents, data.currency)}
                </Text>
              </View>
            )}
          </View>
        )}
        <View style={s.totalRow}>
          <Text style={s.totalLabel}>{section.title || "Total"}</Text>
          <Text style={s.totalValue}>{money(data.totalCents, data.currency)}</Text>
        </View>

        {fieldOn(section, "paymentMade") && (data.amountPaidCents ?? 0) > 0 && (
          <View style={s.subtotalBlock}>
            <View style={s.subtotalRow}>
              <Text style={s.muted}>Payments received</Text>
              <Text style={s.paidValue}>
                &minus;{money(data.amountPaidCents ?? 0, data.currency)}
              </Text>
            </View>
          </View>
        )}

        {fieldOn(section, "balanceDue") && (
          <View style={s.balanceBand}>
            <Text style={s.balanceBandLabel}>Balance Due</Text>
            <Text style={s.balanceBandValue}>
              {money(Math.max(0, data.totalCents - (data.amountPaidCents ?? 0)), data.currency)}
            </Text>
          </View>
        )}
      </View>
    );
  }

  const headerParts = header.filter((h) => h.key !== "documentMeta");

  return (
    <Document>
      <Page
        size={style.pageSize ?? "A4"}
        orientation={style.orientation === "landscape" ? "landscape" : "portrait"}
        style={s.page}
      >
        {style.headerLayout === "band" && <View style={s.band} />}

        <View style={style.headerLayout === "split" ? s.headerSplit : s.headerBlock}>
          <View style={s.headerLeft}>{headerParts.map(renderHeaderPart)}</View>
          {renderMeta()}
        </View>

        {style.headerLayout !== "band" && <View style={s.headerDivider} />}

        {body.map(renderBodyPart)}

        {footer && (
          // Always fixed, so the footer repeats on every page. Tying this to
          // the page-numbers switch meant turning numbers off also stopped the
          // footer repeating, which is not what that checkbox says it does.
          <View
            style={[
              s.footer,
              footer.align === "center"
                ? { justifyContent: "center" }
                : footer.align === "right"
                  ? { justifyContent: "flex-end" }
                  : {},
            ]}
            fixed
          >
            <View
              style={[
                s.footerLeft,
                footer.align === "center" ? { alignItems: "center" } : {},
              ]}
            >
              {footer.body && <Text style={s.footerLink}>{footer.body}</Text>}
              {fieldOn(footer, "viewOnline") && data.viewOnlineUrl && (
                <Text style={s.footerLink}>View &amp; pay online: {data.viewOnlineUrl}</Text>
              )}
              {fieldOn(footer, "pageNumbers") && (
                <Text
                  style={s.footerLink}
                  render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`}
                />
              )}
              {fieldOn(footer, "branding") && (
                <Text style={s.footerBrand}>Generated with flow — by Skynat · flow.skynat.co</Text>
              )}
            </View>
            {fieldOn(footer, "qr") && data.qrDataUrl && (
              <Image src={data.qrDataUrl} style={s.qr} />
            )}
          </View>
        )}
      </Page>
    </Document>
  );
}

function buildStyles(style: PdfStyleConfig) {
  const font = style.fontFamily;
  // Every size runs through this, so one control scales the whole document
  // rather than the owner nudging a dozen numbers that then disagree.
  const scale = style.fontScale && style.fontScale > 0 ? style.fontScale : 1;
  const f = (size: number) => Math.round(size * scale * 10) / 10;
  // The coarse preset is the fallback; an explicitly set edge wins. Owners
  // reach for "roomy" first and for exact numbers only when they are matching
  // letterhead or a window envelope, and both have to work.
  const fallback = PAGE_MARGINS[style.pageMargin ?? "normal"] ?? PAGE_MARGINS.normal;
  const edge = (inches: number | undefined) =>
    typeof inches === "number" && Number.isFinite(inches)
      ? Math.max(0, inches) * PT_PER_INCH
      : fallback;

  const marginTop = edge(style.margins?.top);
  const marginBottom = edge(style.margins?.bottom);
  const marginLeft = edge(style.margins?.left);
  const marginRight = edge(style.margins?.right);

  return StyleSheet.create({
    page: {
      paddingTop: marginTop,
      paddingBottom: marginBottom,
      paddingLeft: marginLeft,
      paddingRight: marginRight,
      fontSize: f(10),
      color: style.textColor,
      fontFamily: font,
      ...(style.backgroundHex ? { backgroundColor: style.backgroundHex } : {}),
    },
    band: { position: "absolute", top: 0, left: 0, right: 0, height: 60, backgroundColor: style.accentColor },
    headerBlock: { marginTop: style.headerLayout === "band" ? 30 : 0, marginBottom: 20, alignItems: style.headerLayout === "centered" ? "center" : "flex-start" },
    headerSplit: { flexDirection: "row", justifyContent: "space-between", marginBottom: 20 },
    headerDivider: { height: 2, backgroundColor: style.accentColor, marginBottom: 16, opacity: 0.8 },
    // A fixed light-gray fill, not an alpha-blended accent tint — react-pdf's
    // handling of 8-digit hex alpha backgrounds is unreliable across accent
    // colors (confirmed: washed out muted text to near-invisible against a
    // bright accent like coral). A flat neutral gray guarantees contrast
    // with textColor/mutedColor regardless of which accent a tenant picks.
    calloutBox: {
      marginBottom: 14,
      padding: 10,
      backgroundColor: "#f4f4f6",
      borderLeft: `2pt solid ${style.accentColor}`,
    },
    headerLeft: { alignItems: style.headerLayout === "centered" ? "center" : "flex-start" },
    headerRight: { alignItems: style.headerLayout === "centered" ? "center" : "flex-end" },
    logoCircle: { width: 36, height: 36, borderRadius: 18, marginBottom: 6, objectFit: "cover" },
    logoSquare: { width: 36, height: 36, marginBottom: 6, objectFit: "cover" },
    // Never forced white for the "band" layout: the accent band is only
    // ~60pt tall at the very top, and this text renders well below it —
    // forcing white made the business name invisible on every band template.
    tenantName: { fontSize: f(16), fontWeight: 700, color: style.textColor },
    docLabel: { fontSize: f(18), fontWeight: 700, color: style.accentColor, marginBottom: 4 },
    // Always mutedColor. Tying this to headerLayout === "band" once made
    // every use of it anywhere in the document render white-on-white.
    muted: { fontSize: f(9), color: style.mutedColor },
    section: { marginBottom: 14 },
    sectionLabel: { fontSize: f(8), textTransform: "uppercase", letterSpacing: 0.5, color: style.mutedColor, marginBottom: 3 },
    paragraph: { fontSize: f(10), lineHeight: 1.5 },
    table: { marginTop: 10, marginBottom: 6 },
    tableHeadDark: { flexDirection: "row", backgroundColor: style.textColor, padding: 6 },
    tableHeadAccent: { flexDirection: "row", backgroundColor: style.accentColor, padding: 6 },
    tableHeadCell: { fontSize: f(9), fontWeight: 700, color: "#ffffff", textTransform: "uppercase" },
    row: { flexDirection: "row", paddingVertical: 6, borderBottom: `1pt solid ${style.mutedColor}55` },
    colIndex: { flex: 0.4, textAlign: "center", fontSize: f(9) },
    colDesc: { flex: 3 },
    colSmall: { flex: 1, textAlign: "center", fontSize: f(9) },
    colQty: { flex: 0.8, alignItems: "center" },
    qtyValue: { fontSize: f(10) },
    lineNotes: { fontSize: f(8), color: style.mutedColor, marginTop: 2, lineHeight: 1.4 },
    // The headline pair in the document-details block, and the banded one at
    // the foot of the totals — the two places a reader looks first to answer
    // "what do I actually owe".
    balanceHead: { marginTop: 8, alignItems: "flex-end" },
    balanceHeadLabel: { fontSize: f(9), fontWeight: 700, color: style.textColor },
    balanceHeadValue: { fontSize: f(15), fontWeight: 700, color: style.textColor },
    paidValue: { fontSize: f(9), color: "#c0392b" },
    balanceBand: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignSelf: "flex-end",
      width: 260,
      marginTop: 8,
      marginBottom: 14,
      paddingVertical: 8,
      paddingHorizontal: 12,
      backgroundColor: "#f4f4f6",
    },
    balanceBandLabel: { fontSize: f(11), fontWeight: 700 },
    balanceBandValue: { fontSize: f(11), fontWeight: 700 },
    colAmount: { flex: 1.3, textAlign: "right" },
    totalRow: { flexDirection: "row", justifyContent: "space-between", paddingTop: 10, marginTop: 6, marginBottom: 14, borderTop: `1pt solid ${style.textColor}` },
    totalLabel: { fontSize: f(12), fontWeight: 700 },
    totalValue: { fontSize: f(12), fontWeight: 700, color: style.accentColor },
    subtotalBlock: { marginTop: 8, alignItems: "flex-end" },
    subtotalRow: { flexDirection: "row", justifyContent: "space-between", width: 180, paddingVertical: 2 },
    signatureRow: { flexDirection: "row", gap: 18, marginTop: 26 },
    signatureCell: { flex: 1 },
    signatureLine: { borderTop: `1pt solid ${style.mutedColor}`, marginBottom: 4 },
    footer: { position: "absolute", bottom: Math.max(18, marginBottom / 2), left: marginLeft, right: marginRight, flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" },
    footerLeft: { flexDirection: "column", gap: 2 },
    footerLink: { fontSize: f(8), color: style.mutedColor },
    footerBrand: { fontSize: f(7), color: style.mutedColor, marginTop: 4 },
    qr: { width: 46, height: 46 },
  });
}
