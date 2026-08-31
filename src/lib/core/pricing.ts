// Single pricing formula used everywhere a quote/invoice total is
// computed or displayed — the new-quote form's live total, the PDF, the
// online view, and createQuote/convertToInvoice's persisted amountCents
// all call this, so the number a customer sees is always the same number
// that got charged. Nothing here is stored redundantly on Transaction;
// itemLines + their rates are the only source of truth, and the
// breakdown (subtotal/tax/discount) is recomputed on demand from them.

export interface PricingLine {
  quantity: number;
  unitPriceCents: number;
  discountPercent?: number | null;
  taxRatePercent?: number | null;
}

export interface PricingBreakdown {
  subtotalCents: number; // sum of qty*unitPrice, before any discount/tax
  lineDiscountCents: number;
  taxCents: number;
  documentDiscountCents: number;
  totalCents: number;
}

export function computeLineTotal(line: PricingLine): { beforeTaxCents: number; taxCents: number } {
  const gross = line.quantity * line.unitPriceCents;
  const discount = gross * ((line.discountPercent ?? 0) / 100);
  const beforeTaxCents = gross - discount;
  const taxCents = beforeTaxCents * ((line.taxRatePercent ?? 0) / 100);
  return { beforeTaxCents, taxCents };
}

export function computeDocumentTotal(lines: PricingLine[], documentDiscountPercent = 0): PricingBreakdown {
  let subtotalCents = 0;
  let lineDiscountCents = 0;
  let taxCents = 0;

  for (const line of lines) {
    const gross = line.quantity * line.unitPriceCents;
    const { beforeTaxCents, taxCents: lineTax } = computeLineTotal(line);
    subtotalCents += gross;
    lineDiscountCents += gross - beforeTaxCents;
    taxCents += lineTax;
  }

  const afterLineDiscounts = subtotalCents - lineDiscountCents + taxCents;
  const documentDiscountCents = afterLineDiscounts * (documentDiscountPercent / 100);
  const totalCents = Math.round(afterLineDiscounts - documentDiscountCents);

  return {
    subtotalCents: Math.round(subtotalCents),
    lineDiscountCents: Math.round(lineDiscountCents),
    taxCents: Math.round(taxCents),
    documentDiscountCents: Math.round(documentDiscountCents),
    totalCents,
  };
}
