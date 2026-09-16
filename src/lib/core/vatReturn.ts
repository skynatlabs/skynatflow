// The return itself.
//
// tax.ts already aggregates what was charged. This is the next thing, and the
// harder one: a return for a period, with the boxes a revenue service asks
// for, an audit trail from each box back to the documents underneath it, and
// — the part that actually matters — figures that stop moving once it is
// filed.
//
// A return that silently restates when a backdated invoice arrives is worse
// than no return, because it disagrees with the one the revenue service
// already has and nobody can tell which was sent. So: recompute freely while
// it is a draft, freeze at filing, and show the drift afterwards rather than
// absorbing it.
//
// Output tax is on invoices issued in the period. Input tax is on costs
// recorded in the period. That is the invoice basis, which is the default
// nearly everywhere; a business on the payments basis is a setting this does
// not have yet, and the summary says so rather than quietly being wrong.

import { prisma } from "@/lib/db";
import { formatMoney } from "@/lib/format/money";

export interface VatBox {
  code: string;
  label: string;
  cents: number;
  /** What was counted, so a figure can be argued with. */
  basis: string;
}

export interface VatComputation {
  periodStart: Date;
  periodEnd: Date;
  boxes: VatBox[];
  outputCents: number;
  inputCents: number;
  /** Positive is payable to the revenue service; negative is a refund due. */
  netCents: number;
  currency: string;
  caveats: string[];
}

/** The two-month periods most small South African vendors are on. */
export function vatPeriodFor(date: Date): { start: Date; end: Date; label: string } {
  const year = date.getUTCFullYear();
  const first = Math.floor(date.getUTCMonth() / 2) * 2;
  const start = new Date(Date.UTC(year, first, 1));
  const end = new Date(Date.UTC(year, first + 2, 0, 23, 59, 59, 999));
  const label = `${start.toLocaleString("en", { month: "short", timeZone: "UTC" })}–${new Date(
    Date.UTC(year, first + 1, 1)
  ).toLocaleString("en", { month: "short", timeZone: "UTC" })} ${year}`;
  return { start, end, label };
}

/**
 * The boxes, computed from the ledger.
 *
 * Zero-rated and exempt supplies are separated from standard-rated ones
 * because the form asks for them separately and because a business that
 * exports has a very different return from one that does not.
 */
export async function computeVatReturn(tenantId: string, periodStart: Date, periodEnd: Date): Promise<VatComputation> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { currency: true, vatNumber: true },
  });

  const [saleLines, costs, refunds] = await Promise.all([
    prisma.transactionLine.findMany({
      where: {
        item: { tenantId },
        transaction: {
          tenantId,
          type: "INVOICE",
          status: { notIn: ["DRAFT", "CANCELLED"] },
          createdAt: { gte: periodStart, lte: periodEnd },
        },
      },
      select: {
        quantity: true,
        unitPriceCents: true,
        discountPercent: true,
        taxRatePercent: true,
        item: { select: { taxRatePercent: true } },
      },
    }),
    prisma.expense.findMany({
      where: { tenantId, status: { not: "REJECTED" }, spentOn: { gte: periodStart, lte: periodEnd } },
      select: { amountCents: true, taxCents: true, isOwnerDrawing: true },
    }),
    prisma.transaction.findMany({
      where: { tenantId, type: "REFUND", createdAt: { gte: periodStart, lte: periodEnd } },
      select: { amountCents: true },
    }),
  ]);

  let standardSales = 0;
  let standardOutput = 0;
  let zeroRatedSales = 0;

  for (const line of saleLines) {
    const rate = line.taxRatePercent ?? line.item.taxRatePercent ?? 0;
    const gross = line.unitPriceCents * line.quantity;
    const net = Math.round(gross * (1 - (line.discountPercent ?? 0) / 100));
    if (rate > 0) {
      standardSales += net;
      standardOutput += Math.round((net * rate) / 100);
    } else {
      zeroRatedSales += net;
    }
  }

  const creditNotes = refunds.reduce((s, r) => s + r.amountCents, 0);

  // Only costs with the tax actually shown on the slip carry input tax. A
  // guess at the VAT inside an untaxed total is how a return becomes a
  // liability, so an untagged cost contributes nothing and is counted for the
  // caveat instead.
  let inputTax = 0;
  let costsWithoutTax = 0;
  let drawings = 0;
  for (const cost of costs) {
    if (cost.isOwnerDrawing) {
      drawings += cost.amountCents;
      continue;
    }
    if (cost.taxCents && cost.taxCents > 0) inputTax += cost.taxCents;
    else costsWithoutTax += 1;
  }

  const outputCents = standardOutput;
  const inputCents = inputTax;

  const boxes: VatBox[] = [
    { code: "1", label: "Standard-rated supplies", cents: standardSales, basis: "Invoice lines with a tax rate, issued in the period, less line discounts." },
    { code: "2", label: "Zero-rated supplies", cents: zeroRatedSales, basis: "Invoice lines with no tax rate." },
    { code: "4", label: "Output tax", cents: outputCents, basis: "Tax charged on standard-rated lines." },
    { code: "5", label: "Credit notes issued", cents: creditNotes, basis: "Refunds recorded in the period." },
    { code: "14", label: "Input tax", cents: inputCents, basis: "Tax shown on costs recorded in the period, excluding owner drawings." },
    { code: "20", label: "Payable / (refundable)", cents: outputCents - inputCents, basis: "Output tax less input tax." },
  ];

  const caveats: string[] = [];
  if (!tenant.vatNumber) caveats.push("This workspace has no VAT number on it, so this is a working figure rather than a return.");
  if (costsWithoutTax > 0) {
    caveats.push(
      `${costsWithoutTax} ${costsWithoutTax === 1 ? "cost has" : "costs have"} no tax amount recorded, so no input tax was claimed on ${
        costsWithoutTax === 1 ? "it" : "them"
      }.`
    );
  }
  if (drawings > 0) caveats.push(`${formatMoney(drawings, tenant.currency)} of owner drawings was left out, which is correct.`);
  caveats.push("Worked out on the invoice basis: sales when invoiced, costs when recorded. A business on the payments basis needs different figures.");

  return { periodStart, periodEnd, boxes, outputCents, inputCents, netCents: outputCents - inputCents, currency: tenant.currency, caveats };
}

/** Save the working figures, so a part-finished return survives a closed tab. */
export async function saveDraftReturn(tenantId: string, periodStart: Date, periodEnd: Date) {
  const computed = await computeVatReturn(tenantId, periodStart, periodEnd);
  const existing = await prisma.vatReturn.findUnique({
    where: { tenantId_periodStart_periodEnd: { tenantId, periodStart, periodEnd } },
  });
  if (existing?.status === "FILED") throw new Error("That period has been filed. A filed return does not change.");

  return prisma.vatReturn.upsert({
    where: { tenantId_periodStart_periodEnd: { tenantId, periodStart, periodEnd } },
    create: {
      tenantId,
      periodStart,
      periodEnd,
      boxes: computed.boxes as unknown as object[],
      outputCents: computed.outputCents,
      inputCents: computed.inputCents,
      netCents: computed.netCents,
    },
    update: {
      boxes: computed.boxes as unknown as object[],
      outputCents: computed.outputCents,
      inputCents: computed.inputCents,
      netCents: computed.netCents,
    },
  });
}

/** Filed. From here the numbers are a record, not a calculation. */
export async function fileVatReturn(params: {
  tenantId: string;
  periodStart: Date;
  periodEnd: Date;
  reference?: string | null;
  filedById?: string | null;
}) {
  const draft = await saveDraftReturn(params.tenantId, params.periodStart, params.periodEnd);
  return prisma.vatReturn.update({
    where: { id: draft.id },
    data: {
      status: "FILED",
      filedAt: new Date(),
      filedById: params.filedById ?? null,
      reference: params.reference?.trim() || null,
    },
  });
}

export async function listVatReturns(tenantId: string) {
  return prisma.vatReturn.findMany({ where: { tenantId }, orderBy: { periodStart: "desc" }, take: 24 });
}

/**
 * What has moved since a return was filed.
 *
 * Backdated documents are ordinary — a supplier invoice arrives three weeks
 * late — and the filed return must not absorb them. This says what the period
 * would come to now, so the difference can be carried into the next return
 * deliberately rather than discovered in an audit.
 */
export async function driftSinceFiling(tenantId: string, returnId: string) {
  const filed = await prisma.vatReturn.findFirst({ where: { id: returnId, tenantId } });
  if (!filed) throw new Error("That return is not in this workspace.");
  if (filed.status !== "FILED") return null;

  const now = await computeVatReturn(tenantId, filed.periodStart, filed.periodEnd);
  const difference = now.netCents - filed.netCents;
  return {
    filedNetCents: filed.netCents,
    wouldBeNetCents: now.netCents,
    differenceCents: difference,
    changed: difference !== 0,
    note:
      difference === 0
        ? "Nothing has changed in that period since it was filed."
        : `${formatMoney(Math.abs(difference), now.currency)} has ${
            difference > 0 ? "been added to" : "come out of"
          } that period since it was filed. Carry it into the next return rather than restating this one.`,
  };
}
