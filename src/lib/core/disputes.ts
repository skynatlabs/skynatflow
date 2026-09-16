// When a customer says something is wrong.
//
// A dispute is the most time-sensitive thing a small business receives and
// the easiest to lose: it arrives through the portal, lands in a table, and
// is seen only by whoever happens to open the disputes page. Until now that
// table had no module at all — the portal wrote to it directly, the dashboard
// read from it directly, and nothing else in the platform knew it existed.
// Which meant the agent could tell you your overdue balance to the cent and
// had no idea a customer was disputing half of it.

import { DisputeStatus } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createNotification } from "./notifications2";

export interface DisputeView {
  id: string;
  status: DisputeStatus;
  message: string;
  resolutionNote: string | null;
  createdAt: Date;
  resolvedAt: Date | null;
  partyId: string;
  partyName: string;
  transactionId: string;
  documentType: string | null;
  amountCents: number | null;
  /** Days it has been open, or how long it took to settle. */
  ageDays: number;
}

function ageOf(dispute: { createdAt: Date; resolvedAt: Date | null }, now: Date): number {
  return Math.max(0, Math.round(((dispute.resolvedAt ?? now).getTime() - dispute.createdAt.getTime()) / 86_400_000));
}

export async function listDisputes(
  tenantId: string,
  opts: { status?: DisputeStatus; partyId?: string; take?: number } = {},
  now = new Date()
): Promise<DisputeView[]> {
  const rows = await prisma.dispute.findMany({
    where: { tenantId, ...(opts.status ? { status: opts.status } : {}), ...(opts.partyId ? { partyId: opts.partyId } : {}) },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: opts.take ?? 100,
    include: { party: { select: { id: true, name: true, companyName: true } } },
  });

  // The document a dispute is against, in one query rather than one each.
  const documents = await prisma.transaction.findMany({
    where: { id: { in: [...new Set(rows.map((r) => r.transactionId))] }, tenantId },
    select: { id: true, type: true, amountCents: true },
  });
  const byId = new Map(documents.map((d) => [d.id, d]));

  return rows.map((r) => ({
    id: r.id,
    status: r.status,
    message: r.message,
    resolutionNote: r.resolutionNote,
    createdAt: r.createdAt,
    resolvedAt: r.resolvedAt,
    partyId: r.partyId,
    partyName: r.party.companyName ?? r.party.name,
    transactionId: r.transactionId,
    documentType: byId.get(r.transactionId)?.type ?? null,
    amountCents: byId.get(r.transactionId)?.amountCents ?? null,
    ageDays: ageOf(r, now),
  }));
}

/**
 * Raised by a customer, through their own portal link.
 *
 * The party comes from the token the caller already resolved; nothing here
 * takes one from a request. The business is told at once, because a dispute
 * nobody reads for four days is a dispute that has become a phone call.
 */
export async function raiseDispute(params: {
  tenantId: string;
  transactionId: string;
  partyId: string;
  message: string;
}) {
  const message = params.message.trim();
  if (!message) throw new Error("Tell us what is wrong before sending it.");

  const document = await prisma.transaction.findFirst({
    where: { id: params.transactionId, tenantId: params.tenantId, partyId: params.partyId },
    select: { id: true, type: true },
  });
  if (!document) throw new Error("That document does not belong to this link.");

  const party = await prisma.party.findUniqueOrThrow({ where: { id: params.partyId }, select: { name: true } });
  const dispute = await prisma.dispute.create({
    data: { tenantId: params.tenantId, transactionId: document.id, partyId: params.partyId, message },
  });

  await createNotification({
    tenantId: params.tenantId,
    type: "GENERAL",
    title: `${party.name} says something is wrong`,
    body: message.slice(0, 200),
    linkHref: `/dashboard/${params.tenantId}/disputes`,
  });

  return dispute;
}

export async function resolveDispute(params: {
  tenantId: string;
  disputeId: string;
  note?: string | null;
  /** Put it back to open — a dispute settled too early is settled twice. */
  reopen?: boolean;
}) {
  const existing = await prisma.dispute.findFirst({
    where: { id: params.disputeId, tenantId: params.tenantId },
    select: { id: true },
  });
  if (!existing) throw new Error("That dispute is not in this workspace.");

  return prisma.dispute.update({
    where: { id: params.disputeId },
    data: params.reopen
      ? { status: DisputeStatus.OPEN, resolvedAt: null }
      : { status: DisputeStatus.RESOLVED, resolvedAt: new Date(), resolutionNote: params.note?.trim() || null },
  });
}

/** How the business is doing at answering complaints. For the officers. */
export async function disputeHealth(tenantId: string, now = new Date()) {
  const rows = await prisma.dispute.findMany({
    where: { tenantId },
    select: { status: true, createdAt: true, resolvedAt: true },
  });
  const open = rows.filter((r) => r.status === DisputeStatus.OPEN);
  const settled = rows.filter((r) => r.resolvedAt !== null);
  const averageDaysToSettle =
    settled.length === 0 ? null : Math.round(settled.reduce((s, r) => s + ageOf(r, now), 0) / settled.length);

  return {
    open: open.length,
    resolved: settled.length,
    // The one that matters: the oldest thing somebody is still waiting on.
    oldestOpenDays: open.length === 0 ? 0 : Math.max(...open.map((r) => ageOf(r, now))),
    averageDaysToSettle,
  };
}
