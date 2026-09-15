// The general ledger.
//
// Everything that can write to the books goes through postEntry(), and
// postEntry() refuses three things: an unbalanced entry, an entry into a
// closed month, and an edit to something already posted. Those three
// refusals are the entire safety story for letting an agent keep books.
//
// The reason they live here rather than in a UI validator is that there are
// four kinds of caller — a person on a form, a server action, a cron job and
// an agent tool — and a rule enforced anywhere else is a rule three of them
// can miss.

import { prisma } from "@/lib/db";
import { AccountType, JournalSource, type Account } from "@prisma/client";

// ------------------------------------------------------------------ errors

export class UnbalancedEntryError extends Error {
  constructor(debits: number, credits: number) {
    super(
      `That entry doesn't balance: ${(debits / 100).toFixed(2)} in debits against ` +
        `${(credits / 100).toFixed(2)} in credits.`
    );
    this.name = "UnbalancedEntryError";
  }
}

export class PeriodClosedError extends Error {
  constructor(year: number, month: number) {
    super(
      `${year}-${String(month).padStart(2, "0")} is closed. Post a correction in an open month ` +
        `instead of reopening a month that has been reported on.`
    );
    this.name = "PeriodClosedError";
  }
}

// ---------------------------------------------------------- chart of accounts

/**
 * The default chart.
 *
 * Deliberately small. A forty-account chart is what makes people abandon
 * bookkeeping software in week two, and every account here is one the system
 * itself posts to or one a small business genuinely uses. Anything else they
 * can add.
 *
 * Structure, unlike tax filings, really is near-universal — assets, then
 * liabilities, equity, income, expenses — so this is safe to define in code
 * in a way the obligation library was not.
 */
export const DEFAULT_CHART: Array<{
  code: string;
  name: string;
  type: AccountType;
  subtype?: string;
  isSystem?: boolean;
}> = [
  { code: "1000", name: "Bank", type: "ASSET", subtype: "cash", isSystem: true },
  { code: "1010", name: "Cash on hand", type: "ASSET", subtype: "cash", isSystem: true },
  { code: "1100", name: "Money owed to us", type: "ASSET", subtype: "receivable", isSystem: true },
  { code: "1200", name: "Stock on hand", type: "ASSET", subtype: "inventory" },
  { code: "1500", name: "Equipment and vehicles", type: "ASSET", subtype: "fixed" },
  { code: "1590", name: "Accumulated depreciation", type: "ASSET", subtype: "contra" },

  { code: "2000", name: "Money we owe suppliers", type: "LIABILITY", subtype: "payable", isSystem: true },
  { code: "2100", name: "Sales tax collected", type: "LIABILITY", subtype: "tax", isSystem: true },
  { code: "2200", name: "Payroll owed", type: "LIABILITY", subtype: "payroll" },
  { code: "2500", name: "Loans", type: "LIABILITY", subtype: "loan" },

  { code: "3000", name: "Owner's capital", type: "EQUITY" },
  { code: "3100", name: "Owner's drawings", type: "EQUITY", isSystem: true },
  { code: "3900", name: "Retained earnings", type: "EQUITY", isSystem: true },

  { code: "4000", name: "Sales", type: "INCOME", isSystem: true },
  { code: "4100", name: "Other income", type: "INCOME" },
  { code: "4900", name: "Discounts given", type: "INCOME", subtype: "contra" },

  { code: "5000", name: "Cost of sales", type: "EXPENSE", subtype: "cogs" },
  { code: "5100", name: "Wages and salaries", type: "EXPENSE" },
  { code: "5200", name: "Rent", type: "EXPENSE" },
  { code: "5300", name: "Vehicle and fuel", type: "EXPENSE" },
  { code: "5400", name: "Utilities and communications", type: "EXPENSE" },
  { code: "5500", name: "Professional fees", type: "EXPENSE" },
  { code: "5600", name: "Marketing", type: "EXPENSE" },
  { code: "5700", name: "Insurance", type: "EXPENSE" },
  { code: "5800", name: "Bank charges", type: "EXPENSE" },
  { code: "5900", name: "Other expenses", type: "EXPENSE", isSystem: true },
];

/** Codes the rest of the system posts to by name rather than by lookup. */
export const SYSTEM_ACCOUNTS = {
  bank: "1000",
  cash: "1010",
  receivable: "1100",
  payable: "2000",
  salesTax: "2100",
  drawings: "3100",
  retained: "3900",
  sales: "4000",
  otherExpense: "5900",
} as const;

export interface EnsureChartResult {
  created: number;
  existing: number;
}

/**
 * Give a workspace a chart if it has none.
 *
 * Idempotent, and additive on re-run: a code that already exists is left
 * exactly as the business edited it. Renaming "Sales" to "Fees" must survive
 * the next deploy.
 */
export async function ensureChartOfAccounts(tenantId: string): Promise<EnsureChartResult> {
  const existing = await prisma.account.findMany({
    where: { tenantId },
    select: { code: true },
  });
  const have = new Set(existing.map((a) => a.code));

  const missing = DEFAULT_CHART.filter((a) => !have.has(a.code));
  if (missing.length > 0) {
    await prisma.account.createMany({
      data: missing.map((a) => ({
        tenantId,
        code: a.code,
        name: a.name,
        type: a.type,
        subtype: a.subtype ?? null,
        isSystem: a.isSystem ?? false,
      })),
    });
  }

  return { created: missing.length, existing: have.size };
}

export async function listAccounts(tenantId: string, opts: { activeOnly?: boolean } = {}) {
  return prisma.account.findMany({
    where: { tenantId, ...(opts.activeOnly ? { isActive: true } : {}) },
    orderBy: { code: "asc" },
  });
}

export async function accountByCode(tenantId: string, code: string): Promise<Account | null> {
  return prisma.account.findFirst({ where: { tenantId, code } });
}

export async function createAccount(params: {
  tenantId: string;
  code: string;
  name: string;
  type: AccountType;
  subtype?: string | null;
}) {
  const code = params.code.trim();
  const clash = await prisma.account.findFirst({ where: { tenantId: params.tenantId, code } });
  if (clash) throw new Error(`Account ${code} already exists.`);

  return prisma.account.create({
    data: {
      tenantId: params.tenantId,
      code,
      name: params.name.trim(),
      type: params.type,
      subtype: params.subtype ?? null,
    },
  });
}

/**
 * Retire an account rather than delete it.
 *
 * Deleting an account that has been posted to would orphan history, and a
 * system account is one the app itself posts to — losing it breaks every
 * future invoice, not just this screen.
 */
export async function deactivateAccount(tenantId: string, accountId: string) {
  const account = await prisma.account.findUnique({ where: { id: accountId } });
  if (!account || account.tenantId !== tenantId) throw new Error("Account not found.");
  if (account.isSystem) throw new Error("This account is one the system posts to — it can't be retired.");
  return prisma.account.update({ where: { id: accountId }, data: { isActive: false } });
}

// ---------------------------------------------------------------- periods

export async function isPeriodClosed(tenantId: string, date: Date): Promise<boolean> {
  const period = await prisma.accountingPeriod.findFirst({
    where: { tenantId, year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 },
    select: { id: true },
  });
  return period !== null;
}

export async function closePeriod(params: {
  tenantId: string;
  year: number;
  month: number;
  closedBy?: string;
  note?: string;
}) {
  return prisma.accountingPeriod.create({
    data: {
      tenantId: params.tenantId,
      year: params.year,
      month: params.month,
      closedBy: params.closedBy ?? null,
      note: params.note ?? null,
    },
  });
}

/**
 * Reopen a closed month.
 *
 * Exists because a genuine mistake sometimes has to be fixed at source, but
 * it is a person's decision: no agent tool exposes it, and it is capability
 * gated wherever it is called.
 */
export async function reopenPeriod(tenantId: string, year: number, month: number) {
  const period = await prisma.accountingPeriod.findFirst({ where: { tenantId, year, month } });
  if (!period) return null;
  return prisma.accountingPeriod.delete({ where: { id: period.id } });
}

export async function listClosedPeriods(tenantId: string) {
  return prisma.accountingPeriod.findMany({
    where: { tenantId },
    orderBy: [{ year: "desc" }, { month: "desc" }],
  });
}

// ---------------------------------------------------------------- posting

export interface PostLine {
  /** Either the account id or its code — codes are what a human or an agent naturally has. */
  accountId?: string;
  accountCode?: string;
  debitCents?: number;
  creditCents?: number;
  memo?: string;
}

export interface PostEntryParams {
  tenantId: string;
  entryDate: Date;
  memo?: string | null;
  source?: JournalSource;
  sourceType?: string | null;
  sourceId?: string | null;
  lines: PostLine[];
  createdById?: string | null;
  byAgent?: boolean;
}

/**
 * Write one balanced entry, or write nothing.
 *
 * The entry and its lines are created inside a transaction so a crash halfway
 * cannot leave a header with no lines — which would be an unbalanced book
 * produced by the very function meant to prevent one.
 */
export async function postEntry(params: PostEntryParams) {
  if (params.lines.length < 2) {
    throw new Error("An entry needs at least two lines — something given and something received.");
  }

  if (await isPeriodClosed(params.tenantId, params.entryDate)) {
    throw new PeriodClosedError(
      params.entryDate.getUTCFullYear(),
      params.entryDate.getUTCMonth() + 1
    );
  }

  // Resolve codes to ids once, up front, so a typo fails before anything is
  // written rather than halfway through.
  const codes = params.lines.map((l) => l.accountCode).filter(Boolean) as string[];
  const byCode = new Map<string, string>();
  if (codes.length > 0) {
    const found = await prisma.account.findMany({
      where: { tenantId: params.tenantId, code: { in: codes } },
      select: { id: true, code: true },
    });
    for (const a of found) byCode.set(a.code, a.id);
    const missing = codes.filter((c) => !byCode.has(c));
    if (missing.length > 0) throw new Error(`No such account: ${missing.join(", ")}.`);
  }

  const resolved = params.lines.map((l) => {
    const accountId = l.accountId ?? (l.accountCode ? byCode.get(l.accountCode) : undefined);
    if (!accountId) throw new Error("Every line needs an account.");
    const debitCents = Math.round(l.debitCents ?? 0);
    const creditCents = Math.round(l.creditCents ?? 0);
    if (debitCents < 0 || creditCents < 0) {
      // A negative debit is a credit wearing a disguise, and allowing it
      // makes every report that sums a column silently wrong.
      throw new Error("Amounts can't be negative — put it on the other side instead.");
    }
    if (debitCents > 0 && creditCents > 0) {
      throw new Error("A line is either a debit or a credit, not both.");
    }
    if (debitCents === 0 && creditCents === 0) {
      throw new Error("A line with no amount does nothing.");
    }
    return { accountId, debitCents, creditCents, memo: l.memo ?? null };
  });

  const debits = resolved.reduce((sum, l) => sum + l.debitCents, 0);
  const credits = resolved.reduce((sum, l) => sum + l.creditCents, 0);
  if (debits !== credits) throw new UnbalancedEntryError(debits, credits);

  // Verify every account belongs to this workspace. Without it, an id passed
  // from outside could post into another business's books.
  const owned = await prisma.account.count({
    where: { tenantId: params.tenantId, id: { in: resolved.map((l) => l.accountId) } },
  });
  if (owned !== new Set(resolved.map((l) => l.accountId)).size) {
    throw new Error("One of those accounts isn't in your chart.");
  }

  return prisma.$transaction(async (tx) => {
    const entry = await tx.journalEntry.create({
      data: {
        tenantId: params.tenantId,
        entryDate: params.entryDate,
        memo: params.memo ?? null,
        source: params.source ?? JournalSource.MANUAL,
        sourceType: params.sourceType ?? null,
        sourceId: params.sourceId ?? null,
        createdById: params.createdById ?? null,
        byAgent: params.byAgent ?? false,
      },
    });

    await tx.journalLine.createMany({
      data: resolved.map((l) => ({ ...l, entryId: entry.id })),
    });

    return entry;
  });
}

/**
 * Undo a posted entry by posting its mirror image.
 *
 * Never a delete. The original stays, the reversal points at it, and anyone
 * reading the books later can see both what was believed and when it was
 * corrected — which is the difference between an auditable agent and one you
 * have to take on trust.
 */
export async function reverseEntry(params: {
  tenantId: string;
  entryId: string;
  on?: Date;
  memo?: string;
  createdById?: string | null;
}) {
  const original = await prisma.journalEntry.findUnique({
    where: { id: params.entryId },
    include: { lines: true, reversedBy: { select: { id: true } } },
  });
  if (!original || original.tenantId !== params.tenantId) throw new Error("Entry not found.");
  if (original.reversedBy) throw new Error("That entry has already been reversed.");

  // Reversing into the original month would silently reopen a closed period,
  // so the default is today — which is also where the correction belongs.
  const on = params.on ?? new Date();

  const entry = await postEntry({
    tenantId: params.tenantId,
    entryDate: on,
    memo: params.memo ?? `Reversal of ${original.memo ?? "an earlier entry"}`,
    source: JournalSource.REVERSAL,
    sourceType: original.sourceType,
    sourceId: original.sourceId,
    createdById: params.createdById ?? null,
    lines: original.lines.map((l) => ({
      accountId: l.accountId,
      debitCents: l.creditCents,
      creditCents: l.debitCents,
    })),
  });

  await prisma.journalEntry.update({
    where: { id: entry.id },
    data: { reversesId: original.id },
  });

  return entry;
}
