// A contract, as a PDF.
//
// Deliberately not the invoice template with the table hidden. An agreement
// is prose read end to end and argued over line by line, so it wants the
// things prose wants and an invoice does not: numbered clauses that can be
// cited ("clause 7 says"), a page number on every page, room in the margin,
// and a signature block that does not start halfway up a page.
//
// It takes the same PdfStyleConfig as everything else, so a workspace's
// accent, typeface and paper size carry across from its invoices.

import { Document, Page, Text, View, StyleSheet, Image } from "@react-pdf/renderer";
import type { PdfStyleConfig } from "./styles";
import { PAGE_MARGINS, PT_PER_INCH } from "./styles";

export interface AgreementParty {
  name: string;
  companyName?: string | null;
  registrationNumber?: string | null;
  vatNumber?: string | null;
  address?: string | null;
  email?: string | null;
  phone?: string | null;
}

export interface AgreementData {
  kindLabel: string;
  number: string;
  title: string;
  date: string;
  startsAt?: string | null;
  endsAt?: string | null;
  validUntil?: string | null;
  valueLine?: string | null;
  business: AgreementParty;
  customer: AgreementParty;
  clauses: Array<{ heading: string; body: string }>;
  logoDataUrl?: string | null;
  /** Filled in once it has been signed; otherwise the blank block prints. */
  signature?: {
    signerName: string;
    signedAt: string;
    signatureDataUrl?: string | null;
    hash?: string | null;
  } | null;
  ourSignature?: { signerName: string; signatureDataUrl?: string | null } | null;
}

function buildStyles(style: PdfStyleConfig) {
  const scale = style.fontScale && style.fontScale > 0 ? style.fontScale : 1;
  const f = (size: number) => Math.round(size * scale * 10) / 10;
  const fallback = PAGE_MARGINS[style.pageMargin ?? "roomy"] ?? PAGE_MARGINS.roomy;
  const edge = (inches: number | undefined) =>
    typeof inches === "number" && Number.isFinite(inches) ? Math.max(0, inches) * PT_PER_INCH : fallback;

  return StyleSheet.create({
    page: {
      paddingTop: edge(style.margins?.top),
      paddingBottom: edge(style.margins?.bottom),
      paddingLeft: edge(style.margins?.left),
      paddingRight: edge(style.margins?.right),
      fontSize: f(10),
      lineHeight: 1.5,
      color: style.textColor,
      fontFamily: style.fontFamily,
      ...(style.backgroundHex ? { backgroundColor: style.backgroundHex } : {}),
    },
    logo: { width: 64, height: 64, objectFit: "contain", marginBottom: 10 },
    kindLabel: { fontSize: f(8), letterSpacing: 1.6, color: style.accentColor },
    title: { fontSize: f(17), marginTop: 6, marginBottom: 2 },
    meta: { fontSize: f(9), color: style.mutedColor },
    rule: { height: 1.5, backgroundColor: style.accentColor, marginTop: 14, marginBottom: 16, opacity: 0.85 },

    partiesRow: { flexDirection: "row", gap: 24, marginBottom: 6 },
    partyCol: { flex: 1 },
    partyRole: { fontSize: f(8), letterSpacing: 1.2, color: style.mutedColor, marginBottom: 3 },
    partyName: { fontSize: f(11) },
    partyLine: { fontSize: f(9), color: style.mutedColor },

    termsBox: { marginTop: 12, marginBottom: 4, padding: 10, backgroundColor: "#f4f4f6", borderLeft: `2pt solid ${style.accentColor}` },
    termLine: { fontSize: f(9.5) },

    clause: { marginTop: 14 },
    clauseHeading: { fontSize: f(10.5), color: style.accentColor, marginBottom: 3 },
    clauseBody: { fontSize: f(10), textAlign: "justify" },

    signatures: { marginTop: 26, flexDirection: "row", gap: 28 },
    signBlock: { flex: 1 },
    signImage: { height: 42, marginBottom: 2, objectFit: "contain" },
    signLine: { borderTop: `1pt solid ${style.mutedColor}`, marginTop: 34, paddingTop: 4 },
    signLineSigned: { borderTop: `1pt solid ${style.mutedColor}`, marginTop: 2, paddingTop: 4 },
    signLabel: { fontSize: f(8.5), color: style.mutedColor },
    signName: { fontSize: f(10) },
    hash: { marginTop: 16, fontSize: f(7), color: style.mutedColor },
    pageNumber: { position: "absolute", bottom: 24, left: 0, right: 0, textAlign: "center", fontSize: f(8), color: style.mutedColor },
  });
}

function partyBlock(s: ReturnType<typeof buildStyles>, role: string, p: AgreementParty) {
  return (
    <View style={s.partyCol}>
      <Text style={s.partyRole}>{role.toUpperCase()}</Text>
      <Text style={s.partyName}>{p.companyName ?? p.name}</Text>
      {p.companyName && p.name !== p.companyName && <Text style={s.partyLine}>{p.name}</Text>}
      {p.registrationNumber && <Text style={s.partyLine}>Reg: {p.registrationNumber}</Text>}
      {p.vatNumber && <Text style={s.partyLine}>VAT: {p.vatNumber}</Text>}
      {p.address && <Text style={s.partyLine}>{p.address}</Text>}
      {p.email && <Text style={s.partyLine}>{p.email}</Text>}
      {p.phone && <Text style={s.partyLine}>{p.phone}</Text>}
    </View>
  );
}

export function AgreementTemplate({ style, data }: { style: PdfStyleConfig; data: AgreementData }) {
  const s = buildStyles(style);
  const terms = [
    data.valueLine ? `Value: ${data.valueLine}` : null,
    data.startsAt ? `Starts: ${data.startsAt}` : null,
    data.endsAt ? `Ends: ${data.endsAt}` : null,
    data.validUntil ? `Valid until: ${data.validUntil}` : null,
  ].filter(Boolean) as string[];

  return (
    <Document title={`${data.number} ${data.title}`}>
      <Page size={style.pageSize ?? "A4"} orientation={style.orientation ?? "portrait"} style={s.page}>
        {data.logoDataUrl && style.logoShape !== "none" && <Image src={data.logoDataUrl} style={s.logo} />}
        <Text style={s.kindLabel}>{data.kindLabel.toUpperCase()}</Text>
        <Text style={s.title}>{data.title}</Text>
        <Text style={s.meta}>
          No. {data.number} · {data.date}
        </Text>
        <View style={s.rule} />

        <View style={s.partiesRow}>
          {partyBlock(s, "Between", data.business)}
          {partyBlock(s, "And", data.customer)}
        </View>

        {terms.length > 0 && (
          <View style={s.termsBox}>
            {terms.map((t) => (
              <Text key={t} style={s.termLine}>
                {t}
              </Text>
            ))}
          </View>
        )}

        {/* Numbered so a clause can be cited in an email six months later. */}
        {data.clauses.map((c, i) => (
          <View key={`${i}-${c.heading}`} style={s.clause} wrap={false}>
            <Text style={s.clauseHeading}>
              {i + 1}. {c.heading}
            </Text>
            <Text style={s.clauseBody}>{c.body}</Text>
          </View>
        ))}

        {/* Kept whole: a signature block split across a page break is the one
            part of a contract where the layout can cost somebody an argument. */}
        <View style={s.signatures} wrap={false}>
          <View style={s.signBlock}>
            {data.ourSignature?.signatureDataUrl && <Image src={data.ourSignature.signatureDataUrl} style={s.signImage} />}
            <View style={data.ourSignature?.signatureDataUrl ? s.signLineSigned : s.signLine}>
              <Text style={s.signName}>{data.ourSignature?.signerName ?? " "}</Text>
              <Text style={s.signLabel}>
                For and on behalf of {data.business.companyName ?? data.business.name}
              </Text>
              <Text style={s.signLabel}>Date: {data.ourSignature ? data.date : "                    "}</Text>
            </View>
          </View>

          <View style={s.signBlock}>
            {data.signature?.signatureDataUrl && <Image src={data.signature.signatureDataUrl} style={s.signImage} />}
            <View style={data.signature?.signatureDataUrl ? s.signLineSigned : s.signLine}>
              <Text style={s.signName}>{data.signature?.signerName ?? " "}</Text>
              <Text style={s.signLabel}>
                For and on behalf of {data.customer.companyName ?? data.customer.name}
              </Text>
              <Text style={s.signLabel}>Date: {data.signature?.signedAt ?? "                    "}</Text>
            </View>
          </View>
        </View>

        {data.signature?.hash && (
          <Text style={s.hash}>
            Signed record — this acceptance is bound to {data.signature.hash}. Any later change to the wording above no
            longer matches it.
          </Text>
        )}

        <Text style={s.pageNumber} render={({ pageNumber, totalPages }) => `${pageNumber} of ${totalPages}`} fixed />
      </Page>
    </Document>
  );
}
