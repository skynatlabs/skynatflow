// A way back.
//
// The autonomy gate already stops the irreversible things. This covers
// everything else — which is most of what the agent does — and it exists for
// one commercial reason: "I can put that back" is the sentence that lets
// somebody turn the agent up a notch. Without it the only safe setting is the
// one where nothing happens.
//
// Two design decisions that matter:
//
//   THE COMPENSATION IS RECORDED AT THE TIME. Working out how to reverse
//   something a week later needs state that has moved on — the old value of a
//   field, the id of a row that has since been edited. So the action writes
//   down how to undo itself while it still knows.
//
//   IT EXPIRES. A week. After that the world has moved on around whatever was
//   done, and putting it back would break more than it fixes. The window is
//   stated rather than silent, so nobody discovers it by needing it.

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const WINDOW_DAYS = 7;

/**
 * The shapes of undo this knows how to perform.
 *
 * Deliberately a closed set rather than a generic "apply this patch": an undo
 * that can express anything can express something wrong, and a wrong undo is
 * worse than no undo.
 */
export type Compensation =
  /** Put named fields on a row back to the values they held. */
  | { kind: "restore"; model: string; id: string; fields: Record<string, unknown> }
  /** Remove a row that was created. */
  | { kind: "delete"; model: string; id: string }
  /** Put a row back that was soft-removed by clearing a flag. */
  | { kind: "unset"; model: string; id: string; field: string };

/** Models an undo may touch. Anything not here cannot be undone by mistake. */
const UNDOABLE: Record<string, { label: string }> = {
  task: { label: "task" },
  jobCard: { label: "job card" },
  party: { label: "customer" },
  item: { label: "product" },
  note: { label: "note" },
  transaction: { label: "document" },
  agreement: { label: "agreement" },
  conversation: { label: "conversation" },
  checklist: { label: "checklist" },
  contactConsent: { label: "consent record" },
  connectedSystem: { label: "system" },
  expenseCodingRule: { label: "coding rule" },
};

export async function recordUndo(params: {
  tenantId: string;
  runId?: string | null;
  tool: string;
  description: string;
  compensation: Compensation;
  actedById?: string | null;
  now?: Date;
}) {
  if (!UNDOABLE[params.compensation.model]) {
    // Not an error: an action on something outside the set simply is not
    // offered as undoable, rather than failing the action that just worked.
    return null;
  }
  const now = params.now ?? new Date();
  return prisma.agentUndo.create({
    data: {
      tenantId: params.tenantId,
      runId: params.runId ?? null,
      tool: params.tool,
      description: params.description,
      compensation: params.compensation as unknown as Prisma.InputJsonValue,
      actedById: params.actedById ?? null,
      expiresAt: new Date(now.getTime() + WINDOW_DAYS * 86_400_000),
    },
  });
}

/** What can still be put back, newest first. */
export async function undoable(tenantId: string, now = new Date()) {
  return prisma.agentUndo.findMany({
    where: { tenantId, undoneAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
}

function parse(raw: Prisma.JsonValue): Compensation | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const c = raw as Record<string, unknown>;
  if (typeof c.kind !== "string" || typeof c.model !== "string" || typeof c.id !== "string") return null;
  if (!UNDOABLE[c.model]) return null;

  if (c.kind === "restore" && c.fields && typeof c.fields === "object") {
    return { kind: "restore", model: c.model, id: c.id, fields: c.fields as Record<string, unknown> };
  }
  if (c.kind === "delete") return { kind: "delete", model: c.model, id: c.id };
  if (c.kind === "unset" && typeof c.field === "string") return { kind: "unset", model: c.model, id: c.id, field: c.field };
  return null;
}

/**
 * Put one thing back.
 *
 * Every path re-checks the tenant on the target row rather than trusting the
 * record: an undo is a write, and a write that trusts a stored id is one
 * stale row away from reaching into another workspace.
 */
export async function undo(params: { tenantId: string; undoId: string; undoneById?: string | null; now?: Date }) {
  const now = params.now ?? new Date();
  const record = await prisma.agentUndo.findFirst({ where: { id: params.undoId, tenantId: params.tenantId } });
  if (!record) throw new Error("There is no such thing to put back.");
  if (record.undoneAt) throw new Error("That has already been put back.");
  if (record.expiresAt <= now) {
    throw new Error(`That was more than ${WINDOW_DAYS} days ago — the world has moved on around it, so it is not undone automatically.`);
  }

  const compensation = parse(record.compensation);
  if (!compensation) throw new Error("Nothing here knows how to put that back.");

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the model is one of a checked set, and Prisma's delegate map is not indexable in a typed way.
  const delegate = (prisma as any)[compensation.model];
  if (!delegate?.findFirst) throw new Error("Nothing here knows how to put that back.");

  const target = await delegate.findFirst({ where: { id: compensation.id, tenantId: params.tenantId }, select: { id: true } });
  if (!target) {
    await prisma.agentUndo.update({
      where: { id: record.id },
      data: { failedReason: "The thing it changed is no longer there." },
    });
    throw new Error("The thing it changed is no longer there.");
  }

  try {
    if (compensation.kind === "delete") {
      await delegate.delete({ where: { id: compensation.id } });
    } else if (compensation.kind === "restore") {
      await delegate.update({ where: { id: compensation.id }, data: compensation.fields });
    } else {
      await delegate.update({ where: { id: compensation.id }, data: { [compensation.field]: null } });
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : "It could not be put back.";
    await prisma.agentUndo.update({ where: { id: record.id }, data: { failedReason: reason } });
    throw new Error(reason);
  }

  await prisma.agentUndo.update({
    where: { id: record.id },
    data: { undoneAt: now, undoneById: params.undoneById ?? null, failedReason: null },
  });
  return { undone: true, what: record.description };
}

/** Everything one run did, put back together. */
export async function undoRun(params: { tenantId: string; runId: string; undoneById?: string | null }) {
  const records = await prisma.agentUndo.findMany({
    where: { tenantId: params.tenantId, runId: params.runId, undoneAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (records.length === 0) return { undone: 0, failed: 0, nothing: true as const };

  let undone = 0;
  let failed = 0;
  const problems: string[] = [];
  // Newest first: a later change may depend on an earlier one, and undoing
  // in the order they happened would hit the dependency before its dependent.
  for (const record of records) {
    try {
      await undo({ tenantId: params.tenantId, undoId: record.id, undoneById: params.undoneById });
      undone += 1;
    } catch (err) {
      failed += 1;
      problems.push(`${record.description}: ${err instanceof Error ? err.message : "could not be put back"}`);
    }
  }
  return { undone, failed, problems, nothing: false as const };
}

export async function undoHealth(tenantId: string, now = new Date()) {
  const [available, used, failed] = await Promise.all([
    prisma.agentUndo.count({ where: { tenantId, undoneAt: null, expiresAt: { gt: now } } }),
    prisma.agentUndo.count({ where: { tenantId, undoneAt: { not: null } } }),
    prisma.agentUndo.count({ where: { tenantId, failedReason: { not: null }, undoneAt: null } }),
  ]);
  return {
    availableToUndo: available,
    alreadyUndone: used,
    couldNotBeUndone: failed,
    windowDays: WINDOW_DAYS,
    summary:
      available === 0
        ? "Nothing recent to put back."
        : `${available} ${available === 1 ? "thing" : "things"} the agent did can still be put back, for ${WINDOW_DAYS} days each.`,
  };
}

/** Dropped once nobody could act on them anyway. Called by the purge cron. */
export async function forgetExpiredUndo(now = new Date()) {
  const { count } = await prisma.agentUndo.deleteMany({ where: { expiresAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } } });
  return count;
}
