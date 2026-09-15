// Accruals and deferred revenue — the gap between cash and profit.
//
// A bill for March that arrives in April is a March cost. A deposit taken in
// March for work done in April is April's income. Both are one entry now and
// its mirror image on the first of the next month, so the books say the
// right thing in each month and nothing is ever double-counted. The reversal
// is written at the same time as the accrual, dated forward, which is the
// only way to be sure it happens.

import { JournalSource } from "@prisma/client";
import { prisma } from "@/lib/db";
import { postEntry, SYSTEM_ACCOUNTS } from "./ledger";

const ACCRUED_LIABILITY_CODE = "2000"; // Money we owe suppliers
const DEFERRED_INCOME_CODE = "2300";

async function ensureAccount(tenantId: string, code: string, name: string, type: "LIABILITY" | "ASSET") {
  const existing = await prisma.account.findFirst({ where: { tenantId, code } });
  if (existing) return existing;
  return prisma.account.create({ data: { tenantId, code, name, type, subtype: "accrual" } });
}

function firstOfNextMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 12));
}

/**
 * A cost that belongs to this month though nothing has been paid or billed.
 * Posts the expense now against an accrued liability, and the reversal on
 * the first of next month so the real bill lands cleanly when it arrives.
 */
export async function accrueExpense(params: {
  tenantId: string;
  on: Date;
  amountCents: number;
  expenseAccountCode: string;
  memo: string;
  createdById?: string | null;
}) {
  if (params.amountCents <= 0) throw new Error("An accrual needs an amount.");
  await ensureAccount(params.tenantId, ACCRUED_LIABILITY_CODE, "Money we owe suppliers", "LIABILITY");
  const entry = await postEntry({
    tenantId: params.tenantId,
    entryDate: params.on,
    memo: `Accrual: ${params.memo}`,
    source: JournalSource.MANUAL,
    sourceType: "accrual",
    lines: [
      { accountCode: params.expenseAccountCode, debitCents: params.amountCents },
      { accountCode: ACCRUED_LIABILITY_CODE, creditCents: params.amountCents },
    ],
    createdById: params.createdById ?? null,
  });
  const reversal = await postEntry({
    tenantId: params.tenantId,
    entryDate: firstOfNextMonth(params.on),
    memo: `Reversal of accrual: ${params.memo}`,
    source: JournalSource.REVERSAL,
    sourceType: "accrual",
    sourceId: entry.id,
    lines: [
      { accountCode: ACCRUED_LIABILITY_CODE, debitCents: params.amountCents },
      { accountCode: params.expenseAccountCode, creditCents: params.amountCents },
    ],
    createdById: params.createdById ?? null,
  });
  await prisma.journalEntry.update({ where: { id: reversal.id }, data: { reversesId: entry.id } });
  return { entry, reversal };
}

/**
 * Money received for work not yet done. Moves it out of sales into deferred
 * income now, and back into sales on the date the work is expected — so the
 * month that earned it is the month that shows it.
 */
export async function deferRevenue(params: {
  tenantId: string;
  on: Date;
  amountCents: number;
  earnedOn: Date;
  memo: string;
  createdById?: string | null;
}) {
  if (params.amountCents <= 0) throw new Error("A deferral needs an amount.");
  if (params.earnedOn <= params.on) throw new Error("Deferred income has to be earned after it was received.");
  await ensureAccount(params.tenantId, DEFERRED_INCOME_CODE, "Income received in advance", "LIABILITY");
  const entry = await postEntry({
    tenantId: params.tenantId,
    entryDate: params.on,
    memo: `Deferred: ${params.memo}`,
    sourceType: "deferral",
    lines: [
      { accountCode: SYSTEM_ACCOUNTS.sales, debitCents: params.amountCents },
      { accountCode: DEFERRED_INCOME_CODE, creditCents: params.amountCents },
    ],
    createdById: params.createdById ?? null,
  });
  const release = await postEntry({
    tenantId: params.tenantId,
    entryDate: params.earnedOn,
    memo: `Earned: ${params.memo}`,
    sourceType: "deferral",
    sourceId: entry.id,
    lines: [
      { accountCode: DEFERRED_INCOME_CODE, debitCents: params.amountCents },
      { accountCode: SYSTEM_ACCOUNTS.sales, creditCents: params.amountCents },
    ],
    createdById: params.createdById ?? null,
  });
  return { entry, release };
}

/** What is accrued or deferred and still open at a date. */
export async function accrualPosition(tenantId: string, at = new Date()) {
  const [accrued, deferred] = await Promise.all([
    prisma.journalLine.aggregate({
      where: { entry: { tenantId, entryDate: { lte: at } }, account: { tenantId, code: ACCRUED_LIABILITY_CODE } },
      _sum: { creditCents: true, debitCents: true },
    }),
    prisma.journalLine.aggregate({
      where: { entry: { tenantId, entryDate: { lte: at } }, account: { tenantId, code: DEFERRED_INCOME_CODE } },
      _sum: { creditCents: true, debitCents: true },
    }),
  ]);
  return {
    accruedExpensesCents: (accrued._sum.creditCents ?? 0) - (accrued._sum.debitCents ?? 0),
    deferredIncomeCents: (deferred._sum.creditCents ?? 0) - (deferred._sum.debitCents ?? 0),
  };
}

export async function listAccruals(tenantId: string, take = 30) {
  return prisma.journalEntry.findMany({
    where: { tenantId, sourceType: { in: ["accrual", "deferral"] } },
    orderBy: { entryDate: "desc" },
    take,
    include: { lines: { include: { account: { select: { code: true, name: true } } } } },
  });
}
