// What the phone did while it had no signal.
//
// Trips and proof already sync through their own route. This is the general
// version, so anything a phone can do without a connection queues the same
// way and is applied by the same rules — which matters because the rules are
// the hard part and having two sets of them is how one of them rots.
//
// Three properties, and all three are about not making things worse:
//
//   IDEMPOTENT. Every change carries a key the phone generated. A phone that
//   retries because it never saw the response must not do the thing twice,
//   and "did the thing twice" is the entire failure mode of an offline queue.
//
//   IN THE ORDER IT HAPPENED. Applied by when it happened on the phone, not
//   when it arrived. Clock-on then clock-off arriving in the other order
//   produces a negative shift.
//
//   NOTHING IS DROPPED. A change that cannot be applied is kept with the
//   reason on it. Silently discarding somebody's afternoon on site is the one
//   outcome worse than an error.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { tickItem } from "./checklists";
import { clockOntoJob } from "./jobBudget";
import { setJobCardStatus } from "./jobCards";
import { submitExpense } from "./expenses";

export type ChangeKind = "job.status" | "checklist.tick" | "time.clockOn" | "time.clockOff" | "expense.capture" | "note.add";

export interface QueuedChange {
  clientRef: string;
  kind: ChangeKind;
  payload: Record<string, unknown>;
  happenedAt: string;
}

export interface ApplyOutcome {
  clientRef: string;
  applied: boolean;
  /** Already done on a previous attempt. Not an error. */
  duplicate?: boolean;
  error?: string;
}

/** Take the queue, without applying it. Accepting is separate from doing. */
export async function enqueue(params: {
  tenantId: string;
  membershipId: string;
  changes: QueuedChange[];
}): Promise<{ accepted: number; alreadyHad: number }> {
  let accepted = 0;
  let alreadyHad = 0;

  for (const change of params.changes) {
    if (!change.clientRef?.trim()) continue;
    const existing = await prisma.offlineChange.findUnique({
      where: { tenantId_clientRef: { tenantId: params.tenantId, clientRef: change.clientRef } },
      select: { id: true },
    });
    if (existing) {
      alreadyHad += 1;
      continue;
    }
    await prisma.offlineChange.create({
      data: {
        tenantId: params.tenantId,
        membershipId: params.membershipId,
        clientRef: change.clientRef,
        kind: change.kind,
        payload: change.payload as unknown as Prisma.InputJsonValue,
        happenedAt: new Date(change.happenedAt),
      },
    });
    accepted += 1;
  }

  return { accepted, alreadyHad };
}

async function applyOne(tenantId: string, change: {
  id: string;
  membershipId: string;
  kind: string;
  payload: Prisma.JsonValue;
  happenedAt: Date;
}): Promise<void> {
  const p = (change.payload ?? {}) as Record<string, unknown>;
  const str = (key: string) => (typeof p[key] === "string" ? (p[key] as string) : undefined);

  switch (change.kind) {
    case "job.status": {
      const jobCardId = str("jobCardId");
      const status = str("status");
      if (!jobCardId || !status) throw new Error("A job status change needs a job and a status.");
      await setJobCardStatus(tenantId, jobCardId, status as never);
      return;
    }
    case "checklist.tick": {
      const jobCardId = str("jobCardId");
      const itemId = str("itemId");
      if (!jobCardId || !itemId) throw new Error("A tick needs a job and an item.");
      await tickItem({
        tenantId,
        jobCardId,
        itemId,
        photoUrl: str("photoUrl") ?? null,
        byId: change.membershipId,
        at: change.happenedAt,
      });
      return;
    }
    case "time.clockOn": {
      const jobCardId = str("jobCardId");
      if (!jobCardId) throw new Error("Clocking on needs a job.");
      await clockOntoJob({
        tenantId,
        membershipId: change.membershipId,
        jobCardId,
        notes: str("notes") ?? null,
        at: change.happenedAt,
      });
      return;
    }
    case "time.clockOff": {
      const open = await prisma.timeEntry.findFirst({
        where: { tenantId, membershipId: change.membershipId, clockOutAt: null },
        orderBy: { clockInAt: "desc" },
      });
      if (!open) throw new Error("Nothing was clocked on to close.");
      // A clock-off that arrives before its clock-on — the queue applies in
      // the order things happened, so this only occurs when the phone's own
      // times disagree. Refusing beats writing a negative shift.
      if (change.happenedAt < open.clockInAt) {
        throw new Error("That clock-off is earlier than the shift it would close.");
      }
      // Closed at the moment it happened on the phone, not on arrival — a
      // shift that ends when the signal comes back is not a shift.
      await prisma.timeEntry.update({ where: { id: open.id }, data: { clockOutAt: change.happenedAt } });
      return;
    }
    case "expense.capture": {
      const description = str("description");
      const amountCents = typeof p.amountCents === "number" ? p.amountCents : undefined;
      if (!description || amountCents === undefined) throw new Error("A cost needs a description and an amount.");
      await submitExpense({
        tenantId,
        submittedById: change.membershipId,
        descriptionText: description,
        amountCents,
        receiptDataUrl: str("receiptDataUrl"),
        spentOn: change.happenedAt,
        source: "STAFF_APP",
        jobCardId: str("jobCardId"),
      });
      return;
    }
    case "note.add": {
      const body = str("body");
      const entityType = str("entityType") ?? "JobCard";
      const entityId = str("entityId");
      if (!body || !entityId) throw new Error("A note needs something to say and something to say it about.");
      await prisma.note.create({
        data: { tenantId, entityType, entityId, title: str("title") ?? "From the field", body, authorId: change.membershipId },
      });
      return;
    }
    default:
      throw new Error(`Nothing here knows how to apply "${change.kind}".`);
  }
}

/**
 * Apply what is queued, oldest first by when it actually happened.
 *
 * One failure does not stop the rest: a bad row is marked with its reason and
 * the queue carries on, because a whole afternoon stuck behind one malformed
 * change is how people stop trusting the phone.
 */
export async function drainQueue(params: { tenantId: string; membershipId?: string }): Promise<ApplyOutcome[]> {
  const pending = await prisma.offlineChange.findMany({
    where: {
      tenantId: params.tenantId,
      appliedAt: null,
      failedAt: null,
      ...(params.membershipId ? { membershipId: params.membershipId } : {}),
    },
    orderBy: { happenedAt: "asc" },
    take: 500,
  });

  const outcomes: ApplyOutcome[] = [];
  for (const change of pending) {
    try {
      await applyOne(params.tenantId, change);
      await prisma.offlineChange.update({ where: { id: change.id }, data: { appliedAt: new Date(), error: null } });
      outcomes.push({ clientRef: change.clientRef, applied: true });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Could not be applied.";
      await prisma.offlineChange.update({ where: { id: change.id }, data: { failedAt: new Date(), error: message } });
      outcomes.push({ clientRef: change.clientRef, applied: false, error: message });
    }
  }
  return outcomes;
}

/** Take it and do it, which is what a sync request actually wants. */
export async function sync(params: {
  tenantId: string;
  membershipId: string;
  changes: QueuedChange[];
}): Promise<{ accepted: number; alreadyHad: number; outcomes: ApplyOutcome[] }> {
  const taken = await enqueue(params);
  const outcomes = await drainQueue({ tenantId: params.tenantId, membershipId: params.membershipId });
  return { ...taken, outcomes };
}

/** What is stuck, and why. Shown rather than hidden. */
export async function stuckChanges(tenantId: string) {
  return prisma.offlineChange.findMany({
    where: { tenantId, failedAt: { not: null } },
    orderBy: { happenedAt: "desc" },
    take: 100,
  });
}

/** Somebody looked at a stuck change and fixed the cause. Try it again. */
export async function retryChange(tenantId: string, changeId: string) {
  const change = await prisma.offlineChange.findFirst({ where: { id: changeId, tenantId }, select: { id: true } });
  if (!change) throw new Error("That change is not in this workspace.");
  await prisma.offlineChange.update({ where: { id: changeId }, data: { failedAt: null, error: null } });
  return drainQueue({ tenantId });
}

export async function queueHealth(tenantId: string) {
  const [pending, failed, applied] = await Promise.all([
    prisma.offlineChange.count({ where: { tenantId, appliedAt: null, failedAt: null } }),
    prisma.offlineChange.count({ where: { tenantId, failedAt: { not: null } } }),
    prisma.offlineChange.count({ where: { tenantId, appliedAt: { not: null } } }),
  ]);
  return {
    pending,
    failed,
    applied,
    summary:
      failed > 0
        ? `${failed} ${failed === 1 ? "change" : "changes"} captured on a phone could not be applied and are waiting to be looked at.`
        : pending > 0
          ? `${pending} waiting to be applied.`
          : "Everything captured in the field has been applied.",
  };
}
