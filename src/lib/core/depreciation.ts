// Depreciation — the monthly charge an accountant has to remember.
//
// Fed by the asset register: anything with a purchase price and a stated
// life is written down by a twelfth of a year's share each month, until it
// is written off. One entry per asset per month, keyed so a second run of
// the same month posts nothing. Straight line, because it is what a small
// business's accountant will use and because the register does not hold the
// information any other method would need.

import { JournalSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { isPeriodClosed, postEntry } from "./ledger";

const EXPENSE_CODE = "5950";
const ACCUMULATED_CODE = "1590";

async function ensureExpenseAccount(tenantId: string) {
  const existing = await prisma.account.findFirst({ where: { tenantId, code: EXPENSE_CODE } });
  if (existing) return;
  await prisma.account.create({ data: { tenantId, code: EXPENSE_CODE, name: "Depreciation", type: "EXPENSE", subtype: "non-cash" } });
}

export interface DepreciationRun {
  year: number;
  month: number;
  posted: number;
  skipped: number;
  totalCents: number;
  problems: string[];
}

/** Charge for one asset for one month, or zero when it is outside its life. */
export function monthlyCharge(asset: { purchaseCents: number | null; usefulLifeMonths: number | null; purchasedOn: Date | null }, year: number, month: number): number {
  if (!asset.purchaseCents || !asset.usefulLifeMonths || asset.usefulLifeMonths <= 0) return 0;
  const monthStart = new Date(Date.UTC(year, month - 1, 1));
  if (asset.purchasedOn && asset.purchasedOn > new Date(Date.UTC(year, month, 0, 23, 59))) return 0;
  if (asset.purchasedOn) {
    const monthsSince = (year - asset.purchasedOn.getUTCFullYear()) * 12 + (month - 1 - asset.purchasedOn.getUTCMonth());
    if (monthsSince >= asset.usefulLifeMonths) return 0;
  }
  void monthStart;
  return Math.round(asset.purchaseCents / asset.usefulLifeMonths);
}

export async function runMonthlyDepreciation(tenantId: string, year: number, month: number): Promise<DepreciationRun> {
  const result: DepreciationRun = { year, month, posted: 0, skipped: 0, totalCents: 0, problems: [] };
  const on = new Date(Date.UTC(year, month, 0, 12)); // last day of the month
  if (await isPeriodClosed(tenantId, on)) {
    result.problems.push("That month is closed.");
    return result;
  }
  await ensureExpenseAccount(tenantId);

  const assets = await prisma.asset.findMany({
    where: { tenantId, status: { notIn: ["LOST", "RETIRED"] }, purchaseCents: { not: null }, usefulLifeMonths: { not: null } },
    select: { id: true, name: true, purchaseCents: true, usefulLifeMonths: true, purchasedOn: true },
  });

  for (const a of assets) {
    const cents = monthlyCharge(a, year, month);
    if (cents <= 0) { result.skipped++; continue; }
    const sourceId = `${a.id}:${year}-${String(month).padStart(2, "0")}`;
    const done = await prisma.journalEntry.findFirst({ where: { tenantId, sourceType: "depreciation", sourceId }, select: { id: true } });
    if (done) { result.skipped++; continue; }
    try {
      await postEntry({
        tenantId,
        entryDate: on,
        memo: `Depreciation — ${a.name}`,
        source: JournalSource.MANUAL,
        sourceType: "depreciation",
        sourceId,
        byAgent: true,
        lines: [
          { accountCode: EXPENSE_CODE, debitCents: cents },
          { accountCode: ACCUMULATED_CODE, creditCents: cents },
        ],
      });
      result.posted++;
      result.totalCents += cents;
    } catch (err) {
      result.problems.push(`${a.name}: ${err instanceof Error ? err.message : "could not post"}`);
    }
  }
  return result;
}

/** Book value of every asset now: cost less what has been written off. */
export async function bookValues(tenantId: string) {
  const assets = await prisma.asset.findMany({
    where: { tenantId, status: { notIn: ["LOST", "RETIRED"] }, purchaseCents: { not: null } },
    select: { id: true, name: true, purchaseCents: true, usefulLifeMonths: true, purchasedOn: true },
  });
  const posted = await prisma.journalEntry.findMany({
    where: { tenantId, sourceType: "depreciation" },
    select: { sourceId: true, lines: { select: { debitCents: true } } },
  });
  const written = new Map<string, number>();
  for (const e of posted) {
    const assetId = e.sourceId?.split(":")[0];
    if (!assetId) continue;
    written.set(assetId, (written.get(assetId) ?? 0) + e.lines.reduce((s, l) => s + l.debitCents, 0));
  }
  return assets.map((a) => ({
    assetId: a.id,
    name: a.name,
    costCents: a.purchaseCents ?? 0,
    writtenOffCents: written.get(a.id) ?? 0,
    bookValueCents: (a.purchaseCents ?? 0) - (written.get(a.id) ?? 0),
    monthlyCents: monthlyCharge(a, new Date().getUTCFullYear(), new Date().getUTCMonth() + 1),
  }));
}
