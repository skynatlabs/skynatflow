// Every rand, recorded.
//
// A cost figure built on two thirds of the costs is worse than no figure, so
// this module's job is to make recording a cost cheaper than losing the slip,
// by whatever route the cost arrives — typed at a desk, photographed at a
// pump, forwarded from a mailbox, or read off a bank statement — and to tag
// it at that moment with what it was for. The moment of spend is the only
// time anybody knows which vehicle, which job, which trip. Ask later and the
// answer is a guess; ask never and cost per kilometre is a guess too.
//
// The same expense arriving twice by two routes is recognised as one, because
// it will: the driver photographs the fuel slip on Monday and the bank line
// lands on Wednesday. A slip number is a certain match; supplier, amount and
// day together are a probable one, which is flagged rather than decided.

import { createHash } from "node:crypto";
import { ExpenseSource, ExpenseStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { accountByCode } from "./ledger";
import { formatMoney, tenantCurrency } from "./currency";

export interface ExpenseLineInput {
  description: string;
  quantity?: number;
  unit?: string | null;
  unitCents: number;
  totalCents?: number;
  itemId?: string | null;
}

export interface SubmitExpenseParams {
  tenantId: string;
  submittedById: string;
  descriptionText: string;
  amountCents: number;
  category?: string;
  receiptDataUrl?: string;

  /** The day the money left. Defaults to now, which is right for a slip photographed at the till. */
  spentOn?: Date;
  source?: ExpenseSource;
  supplierId?: string | null;
  supplierName?: string | null;
  taxCents?: number | null;
  /** Slip or invoice number — the strongest duplicate signal there is. */
  reference?: string | null;
  accountId?: string | null;
  /** "5300" — resolved to the workspace's own account of that code. */
  accountCode?: string | null;
  assetId?: string | null;
  tripId?: string | null;
  jobCardId?: string | null;
  transactionId?: string | null;
  incurredById?: string | null;
  quantity?: number | null;
  unit?: string | null;
  odometerKm?: number | null;
  isOwnerDrawing?: boolean | null;
  branchId?: string | null;
  lines?: ExpenseLineInput[];
  receiptReading?: unknown;
}

/** How far apart two "same day" spends may sit — a slip's date and the bank's rarely agree. */
const DUPLICATE_WINDOW_DAYS = 3;

function normaliseName(name: string | null | undefined): string {
  return (name ?? "")
    .toLowerCase()
    .replace(/\(pty\)|ltd|cc|inc|\bthe\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Same supplier, same amount. The day is deliberately not in the key: a slip
 * dated Monday and the bank line that lands on Wednesday are the same spend,
 * and the lookup applies a window of days around it instead.
 *
 * Requires a supplier. Two R200 spends with nobody named are as likely to be
 * two coffees as one, and a fingerprint that merged them would silently lose
 * a real cost — the opposite of the point.
 */
export function expenseFingerprint(params: {
  supplierId?: string | null;
  supplierName?: string | null;
  amountCents: number;
}): string | null {
  const who = params.supplierId ?? normaliseName(params.supplierName);
  if (!who) return null;
  return createHash("sha1").update(`${who}|${params.amountCents}`).digest("hex");
}

async function requireOwned<T extends { tenantId: string }>(
  row: T | null,
  what: string
): Promise<T> {
  if (!row) throw new Error(`${what} not found.`);
  return row;
}

/**
 * Record a cost, tagged with what it was for.
 *
 * Fills in what it can infer so the person capturing types less: a trip
 * implies its vehicle and driver, a job card implies its invoice. Then looks
 * for the same spend arriving by another route. A matching slip number makes
 * the new row a DUPLICATE outright; a matching supplier-amount-day only marks
 * it as probable and leaves the decision to a person on the approvals screen.
 *
 * Returns the row. Callers that care whether it was recognised as a duplicate
 * read `status` and `duplicateOfId` off it.
 */
export async function submitExpense(params: SubmitExpenseParams) {
  const { tenantId } = params;
  if (!params.descriptionText.trim()) throw new Error("Say what it was for.");
  if (!(params.amountCents > 0)) throw new Error("The amount has to be more than nothing.");

  const spentOn = params.spentOn ?? new Date();

  // Every id that arrives from outside is checked against the workspace
  // before it is written. A cost tagged to another business's vehicle is a
  // leak in both directions.
  let assetId = params.assetId ?? null;
  let transactionId = params.transactionId ?? null;
  let incurredById = params.incurredById ?? null;

  if (params.tripId) {
    const trip = await requireOwned(
      await prisma.trip.findFirst({
        where: { id: params.tripId, tenantId },
        select: { tenantId: true, assetId: true, driverId: true },
      }),
      "Trip"
    );
    assetId ??= trip.assetId;
    incurredById ??= trip.driverId;
  }
  if (params.jobCardId) {
    const job = await requireOwned(
      await prisma.jobCard.findFirst({
        where: { id: params.jobCardId, tenantId },
        select: { tenantId: true, transactionId: true },
      }),
      "Job card"
    );
    transactionId ??= job.transactionId;
  }
  if (assetId) {
    await requireOwned(
      await prisma.asset.findFirst({ where: { id: assetId, tenantId }, select: { tenantId: true } }),
      "Asset"
    );
  }
  if (transactionId) {
    await requireOwned(
      await prisma.transaction.findFirst({
        where: { id: transactionId, tenantId },
        select: { tenantId: true },
      }),
      "Document"
    );
  }
  if (params.supplierId) {
    await requireOwned(
      await prisma.party.findFirst({
        where: { id: params.supplierId, tenantId },
        select: { tenantId: true },
      }),
      "Supplier"
    );
  }

  let accountId = params.accountId ?? null;
  if (!accountId && params.accountCode) {
    accountId = (await accountByCode(tenantId, params.accountCode))?.id ?? null;
  }
  if (accountId) {
    await requireOwned(
      await prisma.account.findFirst({ where: { id: accountId, tenantId }, select: { tenantId: true } }),
      "Account"
    );
  }

  const reference = params.reference?.trim() || null;
  const fingerprint = expenseFingerprint({
    supplierId: params.supplierId,
    supplierName: params.supplierName,
    amountCents: params.amountCents,
  });

  // ---- the same spend, arriving again ------------------------------------
  let duplicateOfId: string | null = null;
  let status: ExpenseStatus = ExpenseStatus.PENDING;

  if (reference) {
    const certain = await prisma.expense.findFirst({
      where: {
        tenantId,
        reference,
        amountCents: params.amountCents,
        status: { not: ExpenseStatus.DUPLICATE },
      },
      select: { id: true },
    });
    if (certain) {
      duplicateOfId = certain.id;
      status = ExpenseStatus.DUPLICATE;
    }
  }
  if (!duplicateOfId && fingerprint) {
    const window = DUPLICATE_WINDOW_DAYS * 86_400_000;
    const probable = await prisma.expense.findFirst({
      where: {
        tenantId,
        fingerprint,
        status: { not: ExpenseStatus.DUPLICATE },
        spentOn: { gte: new Date(spentOn.getTime() - window), lte: new Date(spentOn.getTime() + window) },
      },
      select: { id: true },
    });
    if (probable) duplicateOfId = probable.id;
  }

  const lines = (params.lines ?? [])
    .filter((l) => l.description.trim())
    .map((l, i) => {
      const quantity = l.quantity ?? 1;
      return {
        description: l.description.trim(),
        quantity,
        unit: l.unit?.trim() || null,
        unitCents: Math.round(l.unitCents),
        totalCents: Math.round(l.totalCents ?? l.unitCents * quantity),
        itemId: l.itemId ?? null,
        sortOrder: i,
      };
    });

  return prisma.expense.create({
    data: {
      tenantId,
      submittedById: params.submittedById,
      descriptionText: params.descriptionText.trim(),
      amountCents: Math.round(params.amountCents),
      category: params.category?.trim() || null,
      receiptDataUrl: params.receiptDataUrl || null,
      spentOn,
      source: params.source ?? ExpenseSource.DESKTOP,
      supplierId: params.supplierId ?? null,
      supplierName: params.supplierName?.trim() || null,
      taxCents: params.taxCents ?? null,
      reference,
      accountId,
      assetId,
      tripId: params.tripId ?? null,
      jobCardId: params.jobCardId ?? null,
      transactionId,
      incurredById: incurredById ?? params.submittedById,
      quantity: params.quantity ?? null,
      unit: params.unit?.trim() || null,
      odometerKm: params.odometerKm ?? null,
      isOwnerDrawing: params.isOwnerDrawing ?? null,
      branchId: params.branchId ?? null,
      fingerprint,
      duplicateOfId,
      status,
      receiptReading: (params.receiptReading as Prisma.InputJsonValue | undefined) ?? undefined,
      receiptReadAt: params.receiptReading ? new Date() : null,
      lines: lines.length > 0 ? { create: lines } : undefined,
    },
    include: { lines: true },
  });
}

async function requireOwnedExpense(tenantId: string, expenseId: string) {
  const expense = await prisma.expense.findUnique({ where: { id: expenseId } });
  if (!expense || expense.tenantId !== tenantId) throw new Error("Expense not found.");
  return expense;
}

export async function approveExpense(tenantId: string, expenseId: string, approvedById: string) {
  const row = await requireOwnedExpense(tenantId, expenseId);
  if (row.status === ExpenseStatus.DUPLICATE) {
    throw new Error("This is a second copy of a cost already recorded. Keep both first if it is not.");
  }
  return prisma.expense.update({
    where: { id: expenseId },
    data: { status: "APPROVED", approvedById },
  });
}

export async function rejectExpense(tenantId: string, expenseId: string, approvedById: string) {
  await requireOwnedExpense(tenantId, expenseId);
  return prisma.expense.update({
    where: { id: expenseId },
    data: { status: "REJECTED", approvedById },
  });
}

/**
 * A person confirms two rows are one spend. The later row is kept and marked
 * rather than deleted: the fact that it arrived twice is itself worth knowing
 * about a route, and a deleted row cannot be un-deleted when they were wrong.
 */
export async function markDuplicate(tenantId: string, expenseId: string, ofExpenseId: string) {
  if (expenseId === ofExpenseId) throw new Error("A cost cannot be a duplicate of itself.");
  await requireOwnedExpense(tenantId, expenseId);
  const original = await requireOwnedExpense(tenantId, ofExpenseId);
  if (original.status === ExpenseStatus.DUPLICATE) {
    throw new Error("That row is itself a duplicate — point at the original.");
  }
  return prisma.expense.update({
    where: { id: expenseId },
    data: { status: ExpenseStatus.DUPLICATE, duplicateOfId: ofExpenseId },
  });
}

/** A person says two similar rows are genuinely two spends. */
export async function keepBoth(tenantId: string, expenseId: string) {
  const row = await requireOwnedExpense(tenantId, expenseId);
  return prisma.expense.update({
    where: { id: expenseId },
    data: {
      duplicateOfId: null,
      // A row auto-marked on a slip number comes back as pending; a person
      // has now said it is real, so it queues for approval like any other.
      status: row.status === ExpenseStatus.DUPLICATE ? ExpenseStatus.PENDING : row.status,
    },
  });
}

/**
 * Rows that look like a second arrival of something already recorded and
 * have not been decided either way.
 */
export async function possibleDuplicates(tenantId: string, limit = 20) {
  const rows = await prisma.expense.findMany({
    where: {
      tenantId,
      duplicateOfId: { not: null },
      status: { in: [ExpenseStatus.PENDING, ExpenseStatus.APPROVED] },
    },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  const originals = await prisma.expense.findMany({
    where: { id: { in: rows.map((r) => r.duplicateOfId!).filter(Boolean) } },
  });
  const byId = new Map(originals.map((o) => [o.id, o]));
  return rows.map((r) => ({ expense: r, lookalike: byId.get(r.duplicateOfId!) ?? null }));
}

const EXPENSES_PAGE_SIZE = 25;

export async function listExpenses(
  tenantId: string,
  status?: "PENDING" | "APPROVED" | "REJECTED" | "DUPLICATE",
  page = 1
) {
  const where = { tenantId, status };
  const [expenses, total] = await Promise.all([
    prisma.expense.findMany({
      where,
      orderBy: { spentOn: "desc" },
      skip: (page - 1) * EXPENSES_PAGE_SIZE,
      take: EXPENSES_PAGE_SIZE,
      include: {
        asset: { select: { name: true } },
        supplier: { select: { name: true } },
        transaction: { select: { id: true, type: true, party: { select: { name: true } } } },
      },
    }),
    prisma.expense.count({ where }),
  ]);
  const memberships = await prisma.membership.findMany({
    where: { id: { in: expenses.map((e) => e.submittedById) } },
    include: { user: true },
  });
  const nameById = new Map(memberships.map((m) => [m.id, m.user.name ?? m.user.email]));
  return {
    items: expenses.map((e) => ({ ...e, submittedByName: nameById.get(e.submittedById) ?? "Someone" })),
    total,
    pageCount: Math.max(1, Math.ceil(total / EXPENSES_PAGE_SIZE)),
  };
}

/** What counts as money that actually left: not refused, not a second copy. */
export const SPENT: { notIn: ExpenseStatus[] } = {
  notIn: [ExpenseStatus.REJECTED, ExpenseStatus.DUPLICATE],
};

// ------------------------------------------------- business vs the owner's own

/**
 * Say whether a payment was a cost of running the business or the owner
 * taking money out of it.
 *
 * These look identical on a bank statement and get booked identically by
 * almost every small business, which is the single biggest reason an owner
 * cannot answer "what does it actually cost to run this". Drawings recorded
 * as expenses make a profitable business look like it is barely surviving,
 * and the error compounds every month nobody separates them.
 */
export async function classifyExpense(params: {
  tenantId: string;
  expenseId: string;
  isOwnerDrawing: boolean;
}) {
  await requireOwnedExpense(params.tenantId, params.expenseId);
  return prisma.expense.update({
    where: { id: params.expenseId },
    data: { isOwnerDrawing: params.isOwnerDrawing },
  });
}

export interface SpendSplit {
  businessCents: number;
  drawingsCents: number;
  /** Not yet classified either way. The number that makes the other two honest. */
  unreviewedCents: number;
  unreviewedCount: number;
  from: Date;
  to: Date;
  /** One sentence, or empty when there is nothing worth saying. */
  summary: string;
}

/**
 * What went out, split three ways.
 *
 * The unreviewed bucket is reported rather than folded into either side.
 * Quietly counting unclassified spend as a business cost is precisely the
 * error this feature exists to correct, and doing it inside the fix would be
 * worse than not having the fix.
 */
export async function spendSplit(
  tenantId: string,
  opts: { from?: Date; to?: Date } = {}
): Promise<SpendSplit> {
  // The upper bound is the end of today, not this instant. A few seconds of
  // clock skew between the app and the database is ordinary, and an expense
  // recorded moments ago silently falling outside "the last twelve months"
  // is the kind of wrong total nobody reports and everybody stops trusting.
  const now = opts.to ?? new Date();
  const to = opts.to ?? new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const from = opts.from ?? new Date(now.getFullYear(), now.getMonth() - 11, 1);

  const rows = await prisma.expense.findMany({
    where: { tenantId, status: SPENT, spentOn: { gte: from, lte: to } },
    select: { amountCents: true, isOwnerDrawing: true },
  });

  let businessCents = 0;
  let drawingsCents = 0;
  let unreviewedCents = 0;
  let unreviewedCount = 0;

  for (const r of rows) {
    if (r.isOwnerDrawing === true) drawingsCents += r.amountCents;
    else if (r.isOwnerDrawing === false) businessCents += r.amountCents;
    else {
      unreviewedCents += r.amountCents;
      unreviewedCount++;
    }
  }

  const currency = await tenantCurrency(tenantId);
  const money = (c: number) => formatMoney(c, currency);

  let summary = "";
  if (drawingsCents > 0 || unreviewedCount > 0) {
    const parts: string[] = [];
    if (drawingsCents > 0) {
      parts.push(`${money(drawingsCents)} of what looks like spending was you, not the business`);
    }
    if (unreviewedCount > 0) {
      parts.push(
        `${unreviewedCount} payment${unreviewedCount === 1 ? "" : "s"} worth ` +
          `${money(unreviewedCents)} ${unreviewedCount === 1 ? "has" : "have"} not been split either way`
      );
    }
    summary = `${parts.join(", and ")}.`;
  }

  return { businessCents, drawingsCents, unreviewedCents, unreviewedCount, from, to, summary };
}

/**
 * Payments nobody has split yet, newest first.
 *
 * This is what the agent works through: it can usually tell a fuel stop from
 * a restaurant, and asking about the handful it genuinely cannot is a far
 * better use of someone's attention than asking about all of them.
 */
export async function unclassifiedExpenses(tenantId: string, limit = 20) {
  return prisma.expense.findMany({
    where: { tenantId, status: SPENT, isOwnerDrawing: null },
    orderBy: { spentOn: "desc" },
    take: limit,
    select: {
      id: true,
      descriptionText: true,
      amountCents: true,
      category: true,
      createdAt: true,
      spentOn: true,
    },
  });
}

/**
 * Costs that were recorded without being told what they were for.
 *
 * Untagged is not wrong — a coffee is for nobody — but a fuel slip with no
 * vehicle is a rand that can never become a cost per kilometre, and this is
 * the list a person works through to fix that.
 */
export async function untaggedCosts(tenantId: string, opts: { since?: Date; limit?: number } = {}) {
  const since = opts.since ?? new Date(Date.now() - 30 * 86_400_000);
  return prisma.expense.findMany({
    where: {
      tenantId,
      status: SPENT,
      spentOn: { gte: since },
      assetId: null,
      tripId: null,
      jobCardId: null,
      transactionId: null,
      isOwnerDrawing: { not: true },
    },
    orderBy: { amountCents: "desc" },
    take: opts.limit ?? 20,
    select: {
      id: true,
      descriptionText: true,
      amountCents: true,
      category: true,
      spentOn: true,
      supplierName: true,
    },
  });
}
