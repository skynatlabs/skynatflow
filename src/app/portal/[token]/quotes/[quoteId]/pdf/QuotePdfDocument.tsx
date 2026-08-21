import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { Transaction, TransactionLine, Item, Party } from "@prisma/client";

type QuoteWithLines = Transaction & {
  itemLines: (TransactionLine & { item: Item })[];
};

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

const styles = StyleSheet.create({
  page: { padding: 40, fontSize: 11, color: "#1a1a1a" },
  tenantName: { fontSize: 10, color: "#666", marginBottom: 4 },
  title: { fontSize: 20, fontWeight: 700, marginBottom: 16 },
  section: { marginBottom: 16 },
  sectionLabel: { fontSize: 9, textTransform: "uppercase", color: "#666", marginBottom: 4, letterSpacing: 0.5 },
  paragraph: { fontSize: 11, lineHeight: 1.5 },
  table: { marginTop: 8, borderTop: "1pt solid #ddd" },
  row: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 6, borderBottom: "1pt solid #eee" },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingTop: 10, marginTop: 4, borderTop: "1pt solid #1a1a1a" },
  totalLabel: { fontSize: 12, fontWeight: 700 },
  totalValue: { fontSize: 12, fontWeight: 700 },
});

export function QuotePdfDocument({
  quote,
  party,
  tenantName,
}: {
  quote: QuoteWithLines;
  party: Party;
  tenantName: string;
}) {
  const isProposal = quote.quoteKind === "PROPOSAL";

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.tenantName}>{tenantName}</Text>
        <Text style={styles.title}>
          {isProposal ? "Proposal" : "Quote"} for {party.name}
        </Text>

        {isProposal && quote.introText && (
          <View style={styles.section}>
            <Text style={styles.paragraph}>{quote.introText}</Text>
          </View>
        )}

        {isProposal && quote.scopeOfWork && (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Scope of work</Text>
            <Text style={styles.paragraph}>{quote.scopeOfWork}</Text>
          </View>
        )}

        <View style={styles.table}>
          {quote.itemLines.map((line) => (
            <View style={styles.row} key={line.id}>
              <Text>
                {line.quantity} x {line.item.name}
              </Text>
              <Text>{money(line.quantity * line.unitPriceCents)}</Text>
            </View>
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Total</Text>
            <Text style={styles.totalValue}>{money(quote.amountCents)}</Text>
          </View>
        </View>
      </Page>
    </Document>
  );
}
