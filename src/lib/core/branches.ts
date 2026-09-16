// Branches — a dimension, not a hierarchy.
//
// The question a multi-site business cannot answer is which branch actually
// makes money. Averaging them together is how a profitable site carries a
// loss-making one for years without anybody noticing, and it is why "we're
// doing fine overall" is the most expensive sentence in a growing business.
//
// Everything here treats a branch as optional. A single-site business never
// sees a branch field, rows with no branch stay valid, and — importantly —
// unassigned money is reported as its own figure rather than being spread
// across branches or quietly dropped. Assigning it is a decision somebody has
// to make; guessing on their behalf is how a branch report becomes fiction.

import { prisma } from "@/lib/db";
import { postEntry } from "./ledger";
import { profitAndLoss, type ProfitAndLoss } from "./financialReports";
import { tenantCurrency } from "./currency";
import { formatMoney } from "@/lib/format/money";

export async function createBranch(params: {
  tenantId: string;
  name: string;
  code?: string | null;
}) {
  const name = params.name.trim();
  if (!name) throw new Error("Give the branch a name.");

  const clash = await prisma.branch.findFirst({ where: { tenantId: params.tenantId, name } });
  if (clash) throw new Error(`There is already a branch called ${name}.`);

  return prisma.branch.create({
    data: { tenantId: params.tenantId, name, code: params.code?.trim() || null },
  });
}

export async function listBranches(tenantId: string, opts: { activeOnly?: boolean } = {}) {
  return prisma.branch.findMany({
    where: { tenantId, ...(opts.activeOnly ? { isActive: true } : {}) },
    orderBy: { name: "asc" },
  });
}

/**
 * Retire a branch rather than delete it.
 *
 * Its history is real trading that belongs in last year's figures, and
 * deleting the row would orphan every transaction, expense and journal entry
 * that pointed at it.
 */
export async function closeBranch(tenantId: string, branchId: string) {
  const branch = await prisma.branch.findUnique({ where: { id: branchId } });
  if (!branch || branch.tenantId !== tenantId) throw new Error("Branch not found.");
  return prisma.branch.update({ where: { id: branchId }, data: { isActive: false } });
}

// -------------------------------------------------------------- assignment

export async function assignToBranch(params: {
  tenantId: string;
  branchId: string | null;
  transactionIds?: string[];
  expenseIds?: string[];
  membershipIds?: string[];
  assetIds?: string[];
}) {
  if (params.branchId) {
    const branch = await prisma.branch.findUnique({
      where: { id: params.branchId },
      select: { tenantId: true },
    });
    if (!branch || branch.tenantId !== params.tenantId) throw new Error("Branch not found.");
  }

  const { tenantId, branchId } = params;
  const results = await Promise.all([
    params.transactionIds?.length
      ? prisma.transaction.updateMany({
          where: { tenantId, id: { in: params.transactionIds } },
          data: { branchId },
        })
      : { count: 0 },
    params.expenseIds?.length
      ? prisma.expense.updateMany({
          where: { tenantId, id: { in: params.expenseIds } },
          data: { branchId },
        })
      : { count: 0 },
    params.membershipIds?.length
      ? prisma.membership.updateMany({
          where: { tenantId, id: { in: params.membershipIds } },
          data: { branchId },
        })
      : { count: 0 },
    params.assetIds?.length
      ? prisma.asset.updateMany({
          where: { tenantId, id: { in: params.assetIds } },
          data: { branchId },
        })
      : { count: 0 },
  ]);

  return {
    transactions: results[0].count,
    expenses: results[1].count,
    people: results[2].count,
    assets: results[3].count,
  };
}

// ----------------------------------------------------------------- reading

export interface BranchPerformance {
  branchId: string | null;
  name: string;
  incomeCents: number;
  costOfSalesCents: number;
  grossProfitCents: number;
  expensesCents: number;
  netProfitCents: number;
  grossMarginPercent: number | null;
  people: number;
  assets: number;
}

export interface BranchComparison {
  branches: BranchPerformance[];
  /** Money on the books that nobody has assigned to a branch. */
  unassigned: BranchPerformance | null;
  from: Date;
  to: Date;
  summary: string;
  caveats: string[];
}

function sectionTotals(pl: ProfitAndLoss) {
  return {
    incomeCents: pl.income.totalCents,
    costOfSalesCents: pl.costOfSales.totalCents,
    grossProfitCents: pl.grossProfitCents,
    expensesCents: pl.expenses.totalCents,
    netProfitCents: pl.netProfitCents,
    grossMarginPercent: pl.grossMarginPercent,
  };
}

/**
 * Compare branches over a period.
 *
 * Runs the same profit and loss the whole business uses, filtered by branch,
 * so a branch figure and the company figure can never disagree about what an
 * expense account means.
 *
 * Unassigned is reported as its own row rather than apportioned. Spreading it
 * pro-rata would make every branch's number look precise and be wrong, and
 * the honest answer — "R40,000 of costs belong to nobody yet" — is also the
 * one that prompts somebody to go and assign them.
 */
export async function compareBranches(
  tenantId: string,
  opts: { from?: Date; to?: Date } = {}
): Promise<BranchComparison> {
  const to = opts.to ?? new Date();
  const from = opts.from ?? new Date(Date.UTC(to.getUTCFullYear(), 0, 1));

  const branches = await listBranches(tenantId);
  const currency = await tenantCurrency(tenantId);

  const [perBranch, unassignedPl, headcount, assetCounts, unassignedCounts] = await Promise.all([
    Promise.all(
      branches.map(async (b) => ({
        branch: b,
        pl: await profitAndLoss(tenantId, { from, to, branchId: b.id }),
      }))
    ),
    profitAndLoss(tenantId, { from, to, branchId: null, onlyUnassigned: true }),
    prisma.membership.groupBy({ by: ["branchId"], where: { tenantId }, _count: { _all: true } }),
    prisma.asset.groupBy({
      by: ["branchId"],
      where: { tenantId, status: { not: "RETIRED" } },
      _count: { _all: true },
    }),
    Promise.all([
      prisma.membership.count({ where: { tenantId, branchId: null } }),
      prisma.asset.count({ where: { tenantId, branchId: null, status: { not: "RETIRED" } } }),
    ]),
  ]);

  const peopleBy = new Map(headcount.map((h) => [h.branchId, h._count._all]));
  const assetsBy = new Map(assetCounts.map((a) => [a.branchId, a._count._all]));

  const rows: BranchPerformance[] = perBranch.map(({ branch, pl }) => ({
    branchId: branch.id,
    name: branch.name,
    ...sectionTotals(pl),
    people: peopleBy.get(branch.id) ?? 0,
    assets: assetsBy.get(branch.id) ?? 0,
  }));

  rows.sort((a, b) => b.netProfitCents - a.netProfitCents);

  const hasUnassigned =
    unassignedPl.income.totalCents !== 0 ||
    unassignedPl.expenses.totalCents !== 0 ||
    unassignedPl.costOfSales.totalCents !== 0;

  const unassigned: BranchPerformance | null = hasUnassigned
    ? {
        branchId: null,
        name: "Not assigned to a branch",
        ...sectionTotals(unassignedPl),
        people: unassignedCounts[0],
        assets: unassignedCounts[1],
      }
    : null;

  return {
    branches: rows,
    unassigned,
    from,
    to,
    summary: summarise(rows, unassigned, currency),
    caveats: caveatsFor(rows, unassigned),
  };
}

// The currency is passed in rather than looked up, so this stays a pure
// function of its inputs — and so it is impossible to call without having
// said whose money these figures are.
function summarise(rows: BranchPerformance[], unassigned: BranchPerformance | null, currency: string): string {
  if (rows.length === 0) return "";

  const money = (c: number) => formatMoney(Math.abs(c), currency);

  const losing = rows.filter((r) => r.netProfitCents < 0);
  if (losing.length > 0) {
    const worst = losing[losing.length - 1];
    // The point of the whole feature: naming the one the average was hiding.
    return `${worst.name} lost ${money(worst.netProfitCents)} over this period${
      rows.length > 1 ? ", which the combined figure hides" : ""
    }.`;
  }

  const best = rows[0];
  const extra =
    unassigned && unassigned.netProfitCents !== 0
      ? ` ${money(unassigned.netProfitCents)} is not assigned to any branch.`
      : "";
  return `${best.name} is the strongest at ${money(best.netProfitCents)}.${extra}`;
}

function caveatsFor(rows: BranchPerformance[], unassigned: BranchPerformance | null): string[] {
  const caveats = [
    "Only money tagged with a branch appears against it. Anything untagged sits in its own row rather than being spread across branches, because spreading it would look precise and be wrong.",
  ];
  if (unassigned) {
    caveats.push(
      "Assign the unassigned rows before comparing branches seriously — until then each branch's figure is a floor, not a total."
    );
  }
  if (rows.some((r) => r.people === 0)) {
    caveats.push(
      "A branch with nobody assigned to it is probably missing its staff rather than genuinely unstaffed, and its costs will look too low."
    );
  }
  return caveats;
}

// --------------------------------------------------------------- transfers

/**
 * Move money between branches so both sides balance.
 *
 * An inter-branch transfer is not income to one and a cost to the other —
 * that would inflate turnover on both sides of the same business. It is a
 * movement between two branch-tagged sides of one account, which nets to
 * nothing at company level and to something real at branch level.
 */
export async function transferBetweenBranches(params: {
  tenantId: string;
  fromBranchId: string;
  toBranchId: string;
  amountCents: number;
  accountCode: string;
  memo: string;
  on?: Date;
  userId?: string | null;
}) {
  if (params.fromBranchId === params.toBranchId) {
    throw new Error("A transfer needs two different branches.");
  }
  if (params.amountCents <= 0) throw new Error("A transfer needs an amount.");

  const branches = await prisma.branch.findMany({
    where: { tenantId: params.tenantId, id: { in: [params.fromBranchId, params.toBranchId] } },
    select: { id: true, name: true },
  });
  if (branches.length !== 2) throw new Error("Branch not found.");

  const name = (id: string) => branches.find((b) => b.id === id)!.name;

  // Two entries rather than one, because a journal entry carries a single
  // branch: one moves the value out of the sending branch, the other moves it
  // into the receiving one. Together they net to zero for the company.
  const out = await postEntry({
    tenantId: params.tenantId,
    entryDate: params.on ?? new Date(),
    memo: `${params.memo} — out of ${name(params.fromBranchId)}`,
    sourceType: "branch_transfer",
    createdById: params.userId ?? null,
    lines: [
      { accountCode: "3000", debitCents: params.amountCents },
      { accountCode: params.accountCode, creditCents: params.amountCents },
    ],
  });
  await prisma.journalEntry.update({
    where: { id: out.id },
    data: { branchId: params.fromBranchId },
  });

  const into = await postEntry({
    tenantId: params.tenantId,
    entryDate: params.on ?? new Date(),
    memo: `${params.memo} — into ${name(params.toBranchId)}`,
    sourceType: "branch_transfer",
    sourceId: out.id,
    createdById: params.userId ?? null,
    lines: [
      { accountCode: params.accountCode, debitCents: params.amountCents },
      { accountCode: "3000", creditCents: params.amountCents },
    ],
  });
  await prisma.journalEntry.update({
    where: { id: into.id },
    data: { branchId: params.toBranchId },
  });

  return { outEntryId: out.id, inEntryId: into.id };
}
