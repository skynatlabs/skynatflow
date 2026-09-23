// Paying people who have no login, no bank account and no payslip.
//
// Every payroll product assumes an employee: a contract, an email address, a
// bank account, a monthly cycle. Most of the people being paid in this
// economy have none of those. They are farm labour hired for a week, guards
// on a daily rate, packers paid by the crate, loaders paid when the truck is
// empty — and they are paid in cash from a tin, or into a wallet, off a
// clipboard that nobody keeps.
//
// The business consequence is not sentimental, it is an audit problem: there
// is no record of who worked, no record of what was owed, and no record of
// what was handed over. When a worker says they were short-paid there is
// nothing to look at, and when SARS asks who the labour cost went to there
// is nothing to show.
//
// So this module does one narrow thing properly: it records a day of work by
// somebody with no account, what it earned at the rate in force THAT DAY,
// who approved it, and when it was paid.
//
// THE RATE IS SNAPSHOTTED, ALWAYS.
//
// A rate that goes up next month must not silently rewrite what somebody was
// owed last month. This is the same rule the catalogue follows when a tax
// rate changes after an invoice has gone out, and it exists for the same
// reason: the past is not a view of the present.
//
// WHAT THIS DELIBERATELY IS NOT.
//
// It does not move money. Paying somebody is marked here and done wherever
// the business actually pays — a wallet, a bank, a tin. A module that both
// recorded and paid would be a payment rail, and a payment rail is a licence
// we do not hold and do not want.

import { CasualPayKind, WorkLogStatus } from "@prisma/client";
import { prisma } from "@/lib/db";

export interface FieldWorkerInput {
  tenantId: string;
  workerId?: string;
  name: string;
  phone?: string | null;
  idNumber?: string | null;
  payKind?: CasualPayKind;
  rateCents?: number;
  payoutNumber?: string | null;
  isActive?: boolean;
}

export async function saveFieldWorker(input: FieldWorkerInput) {
  const name = input.name.trim();
  if (!name) throw new Error("A worker needs a name.");

  const data = {
    name,
    phone: input.phone?.trim() || null,
    idNumber: input.idNumber?.trim() || null,
    ...(input.payKind ? { payKind: input.payKind } : {}),
    ...(input.rateCents === undefined ? {} : { rateCents: Math.max(0, Math.round(input.rateCents)) }),
    payoutNumber: input.payoutNumber?.trim() || null,
    ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
  };

  if (input.workerId) {
    const existing = await prisma.fieldWorker.findFirst({
      where: { id: input.workerId, tenantId: input.tenantId },
      select: { id: true },
    });
    if (!existing) throw new Error("Worker not found.");
    return prisma.fieldWorker.update({ where: { id: input.workerId }, data });
  }

  return prisma.fieldWorker.create({ data: { tenantId: input.tenantId, ...data } });
}

export async function listFieldWorkers(tenantId: string, activeOnly = true) {
  return prisma.fieldWorker.findMany({
    where: { tenantId, ...(activeOnly ? { isActive: true } : {}) },
    orderBy: { name: "asc" },
    take: 1000,
  });
}

export interface LogWorkResult {
  workLogId: string;
  workerName: string;
  units: number;
  amountCents: number;
}

/**
 * A day of work, by somebody with no account.
 *
 * The date is the day WORKED, not the day recorded, because a clipboard gets
 * typed up on Friday for a week that started on Monday and a system that
 * cannot express that will be fed wrong dates forever.
 */
export async function logWork(params: {
  tenantId: string;
  fieldWorkerId: string;
  workedOn: Date;
  units: number;
  workSiteId?: string | null;
  note?: string | null;
  /** Override the worker's standing rate for this log only. */
  rateCents?: number;
}): Promise<LogWorkResult> {
  const worker = await prisma.fieldWorker.findFirst({
    where: { id: params.fieldWorkerId, tenantId: params.tenantId },
  });
  if (!worker) throw new Error("Worker not found.");

  const units = Math.round(params.units * 100) / 100;
  if (units <= 0) throw new Error("A log has to be for some work.");

  const rate = params.rateCents == null ? worker.rateCents : Math.max(0, Math.round(params.rateCents));
  const amountCents = Math.round(units * rate);

  if (params.workSiteId) {
    const site = await prisma.workSite.findFirst({
      where: { id: params.workSiteId, tenantId: params.tenantId },
      select: { id: true },
    });
    if (!site) throw new Error("That site is not in this workspace.");
  }

  const log = await prisma.workLog.create({
    data: {
      tenantId: params.tenantId,
      fieldWorkerId: params.fieldWorkerId,
      workSiteId: params.workSiteId ?? null,
      workedOn: params.workedOn,
      units,
      rateCentsAtTime: rate,
      amountCents,
      note: params.note?.trim().slice(0, 300) || null,
    },
  });

  return { workLogId: log.id, workerName: worker.name, units, amountCents };
}

/**
 * Approve work before it can be paid.
 *
 * The gate exists because the person writing the clipboard up and the person
 * handing out money are usually the same person, and that is exactly the
 * arrangement that quietly grows a worker who does not exist.
 */
export async function approveWork(params: {
  tenantId: string;
  workLogIds: string[];
  approvedById: string;
}): Promise<number> {
  const { count } = await prisma.workLog.updateMany({
    where: {
      tenantId: params.tenantId,
      id: { in: params.workLogIds },
      status: WorkLogStatus.LOGGED,
    },
    data: {
      status: WorkLogStatus.APPROVED,
      approvedById: params.approvedById,
      approvedAt: new Date(),
    },
  });
  return count;
}

/**
 * Mark approved work as paid.
 *
 * Marks only. No money moves from here — see the note at the top of the
 * file. Refuses anything not approved, so the gate cannot be walked around
 * by going straight to "paid".
 */
export async function markPaid(params: {
  tenantId: string;
  workLogIds: string[];
  paidAt?: Date;
}): Promise<{ marked: number; skipped: number }> {
  const eligible = await prisma.workLog.findMany({
    where: {
      tenantId: params.tenantId,
      id: { in: params.workLogIds },
      status: WorkLogStatus.APPROVED,
    },
    select: { id: true },
    take: 1000,
  });

  const { count } = await prisma.workLog.updateMany({
    where: { tenantId: params.tenantId, id: { in: eligible.map((e) => e.id) } },
    data: { status: WorkLogStatus.PAID, paidAt: params.paidAt ?? new Date() },
  });

  return { marked: count, skipped: params.workLogIds.length - count };
}

export interface PayoutRow {
  fieldWorkerId: string;
  name: string;
  phone: string | null;
  payoutNumber: string | null;
  days: number;
  units: number;
  amountCents: number;
  logIds: string[];
}

export interface PayoutRun {
  rows: PayoutRow[];
  totalCents: number;
  workers: number;
  summary: string;
}

/**
 * What is owed, per person, right now.
 *
 * Approved and unpaid only. Work still waiting for approval is deliberately
 * not here — a run that quietly included it would make the approval gate
 * decorative.
 */
export async function whatIsOwed(
  tenantId: string,
  opts: { from?: Date; to?: Date } = {}
): Promise<PayoutRun> {
  const logs = await prisma.workLog.findMany({
    where: {
      tenantId,
      status: WorkLogStatus.APPROVED,
      ...(opts.from || opts.to
        ? { workedOn: { ...(opts.from ? { gte: opts.from } : {}), ...(opts.to ? { lt: opts.to } : {}) } }
        : {}),
    },
    orderBy: { workedOn: "asc" },
    take: 5000,
    include: { fieldWorker: { select: { name: true, phone: true, payoutNumber: true } } },
  });

  const byWorker = new Map<string, PayoutRow>();
  for (const log of logs) {
    const row =
      byWorker.get(log.fieldWorkerId) ??
      ({
        fieldWorkerId: log.fieldWorkerId,
        name: log.fieldWorker.name,
        phone: log.fieldWorker.phone,
        payoutNumber: log.fieldWorker.payoutNumber,
        days: 0,
        units: 0,
        amountCents: 0,
        logIds: [],
      } satisfies PayoutRow);
    row.days += 1;
    row.units += log.units;
    row.amountCents += log.amountCents;
    row.logIds.push(log.id);
    byWorker.set(log.fieldWorkerId, row);
  }

  const rows = [...byWorker.values()].sort((a, b) => b.amountCents - a.amountCents);
  const total = rows.reduce((sum, r) => sum + r.amountCents, 0);

  return {
    rows,
    totalCents: total,
    workers: rows.length,
    summary:
      rows.length === 0
        ? "Nothing approved and waiting to be paid."
        : `${rows.length} ${rows.length === 1 ? "person" : "people"} waiting to be paid.`,
  };
}

export interface CasualCost {
  logs: number;
  workers: number;
  amountCents: number;
  awaitingApprovalCents: number;
  bySite: Array<{ workSiteId: string | null; siteName: string; amountCents: number }>;
  summary: string;
}

/** What casual labour actually cost over a window, and where it went. */
export async function casualLabourCost(params: {
  tenantId: string;
  from: Date;
  to: Date;
}): Promise<CasualCost> {
  const [logs, sites] = await Promise.all([
    prisma.workLog.findMany({
      where: { tenantId: params.tenantId, workedOn: { gte: params.from, lt: params.to } },
      select: {
        fieldWorkerId: true,
        amountCents: true,
        status: true,
        workSiteId: true,
      },
      take: 20000,
    }),
    prisma.workSite.findMany({
      where: { tenantId: params.tenantId },
      select: { id: true, name: true },
      take: 1000,
    }),
  ]);

  const siteName = new Map(sites.map((s) => [s.id, s.name]));
  const bySite = new Map<string, number>();
  let amount = 0;
  let awaiting = 0;
  const workers = new Set<string>();

  for (const log of logs) {
    workers.add(log.fieldWorkerId);
    amount += log.amountCents;
    if (log.status === WorkLogStatus.LOGGED) awaiting += log.amountCents;
    const key = log.workSiteId ?? "";
    bySite.set(key, (bySite.get(key) ?? 0) + log.amountCents);
  }

  return {
    logs: logs.length,
    workers: workers.size,
    amountCents: amount,
    awaitingApprovalCents: awaiting,
    bySite: [...bySite.entries()]
      .map(([id, amountCents]) => ({
        workSiteId: id || null,
        siteName: id ? (siteName.get(id) ?? "Unknown site") : "No site recorded",
        amountCents,
      }))
      .sort((a, b) => b.amountCents - a.amountCents),
    summary:
      logs.length === 0
        ? "No casual work recorded in this window."
        : `${workers.size} ${workers.size === 1 ? "person" : "people"}, ${logs.length} days logged.`,
  };
}

/** One person's record, which is what settles a dispute about being short-paid. */
export async function workerHistory(tenantId: string, fieldWorkerId: string, limit = 100) {
  const worker = await prisma.fieldWorker.findFirst({
    where: { id: fieldWorkerId, tenantId },
  });
  if (!worker) return null;

  const logs = await prisma.workLog.findMany({
    where: { tenantId, fieldWorkerId },
    orderBy: { workedOn: "desc" },
    take: Math.min(limit, 500),
  });

  return {
    worker,
    logs,
    owedCents: logs
      .filter((l) => l.status === WorkLogStatus.APPROVED)
      .reduce((sum, l) => sum + l.amountCents, 0),
    paidCents: logs
      .filter((l) => l.status === WorkLogStatus.PAID)
      .reduce((sum, l) => sum + l.amountCents, 0),
  };
}
