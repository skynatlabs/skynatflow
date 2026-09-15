// Closing a business's account.
//
// There is one way out and this is it: the owner asks, and after a week
// everything is gone. It is deliberately not a button anybody can lean on —
// it is typed confirmation, the owner only, and a week in which they can
// change their mind.
//
// Before anything is deleted the owner is offered a copy of their records,
// and that is not a courtesy. A business has to keep its invoices for five
// years, and a customer who asks for their information has a right to be
// given it. Deleting a workspace without offering the copy would hand
// somebody a compliance problem on their way out of the door.

import { prisma } from "@/lib/db";
import { toCsv } from "@/lib/export/csv";
import { writeZip } from "@/lib/import/zip";
import { exportTenant } from "./portability";

/** How long the owner has to change their mind. */
export const GRACE_DAYS = 7;

export interface ClosureState {
  requestedAt: Date | null;
  deletesOn: Date | null;
  requestedById: string | null;
}

export async function closureState(tenantId: string): Promise<ClosureState> {
  const tenant = await prisma.tenant.findUniqueOrThrow({
    where: { id: tenantId },
    select: { deletionRequestedAt: true, deletionRequestedById: true },
  });
  return {
    requestedAt: tenant.deletionRequestedAt,
    requestedById: tenant.deletionRequestedById,
    deletesOn: tenant.deletionRequestedAt ? new Date(tenant.deletionRequestedAt.getTime() + GRACE_DAYS * 86_400_000) : null,
  };
}

export async function requestClosure(tenantId: string, userId: string, confirmation: string) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
  // Typing the name is the whole safeguard: it is the difference between a
  // misclick and a decision.
  if (confirmation.trim().toLowerCase() !== tenant.name.trim().toLowerCase()) {
    throw new Error(`To close this account, type the business name exactly: ${tenant.name}`);
  }
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { deletionRequestedAt: new Date(), deletionRequestedById: userId },
  });
  return closureState(tenantId);
}

export async function cancelClosure(tenantId: string) {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: { deletionRequestedAt: null, deletionRequestedById: null },
  });
}

/**
 * A copy of the business's records: every table as JSON for fidelity, and the
 * ones a person actually opens as CSV, in one file.
 */
export async function recordsArchive(tenantId: string): Promise<{ fileName: string; data: Buffer }> {
  const { manifest, data } = await exportTenant(tenantId);
  const files: Array<{ name: string; data: Buffer | string }> = [
    { name: "manifest.json", data: JSON.stringify(manifest, null, 2) },
    {
      name: "README.txt",
      data:
        `${manifest.businessName} — a copy of your records\n` +
        `Taken ${manifest.exportedAt}\n\n` +
        `Every table is here as JSON, complete and exactly as it was stored.\n` +
        `The tables most people want to open are also CSV, in /csv.\n\n` +
        manifest.notes.map((n) => `- ${n}`).join("\n") +
        "\n",
    },
  ];

  for (const [key, rows] of Object.entries(data)) {
    files.push({ name: `json/${key}.json`, data: JSON.stringify(rows, null, 2) });
    if (rows.length === 0) continue;
    const columns = Object.keys(rows[0] as object);
    files.push({
      name: `csv/${key}.csv`,
      data: toCsv(
        columns,
        (rows as Record<string, unknown>[]).map((row) =>
          columns.map((c) => {
            const v = row[c];
            if (v === null || v === undefined) return "";
            if (v instanceof Date) return v.toISOString();
            return typeof v === "object" ? JSON.stringify(v) : String(v);
          })
        )
      ),
    });
  }

  const stamp = new Date().toISOString().slice(0, 10);
  const slug = manifest.businessName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "records";
  return { fileName: `${slug}-records-${stamp}.zip`, data: writeZip(files) };
}

/**
 * Everything belonging to this workspace, removed.
 *
 * Driven off the schema rather than a hand-written list: every table with a
 * tenantId is cleared, and the few reached through a parent are cleared
 * first. A table added later is therefore deleted too — the failure this is
 * most prone to is a new model quietly surviving a deletion somebody was
 * promised was complete.
 */
export async function purgeTenant(tenantId: string): Promise<{ tables: number; rows: number }> {
  const tables = await prisma.$queryRaw<Array<{ table_name: string }>>`
    SELECT table_name FROM information_schema.columns
    WHERE table_schema = 'public' AND column_name = 'tenantId' AND table_name <> 'tenants'`;

  let rows = 0;
  // Children reached through a parent, before the parents go.
  rows += await prisma.$executeRaw`DELETE FROM transaction_lines WHERE "transactionId" IN (SELECT id FROM transactions WHERE "tenantId" = ${tenantId})`;
  rows += await prisma.$executeRaw`DELETE FROM journal_lines WHERE "entryId" IN (SELECT id FROM journal_entries WHERE "tenantId" = ${tenantId})`;
  // Self-references have to be broken before the rows themselves can go.
  await prisma.$executeRaw`UPDATE memberships SET "managerId" = NULL WHERE "tenantId" = ${tenantId}`;
  await prisma.$executeRaw`UPDATE transactions SET "parentId" = NULL WHERE "tenantId" = ${tenantId}`;

  let remaining = tables.map((t) => t.table_name);
  for (let pass = 0; pass < 10 && remaining.length > 0; pass++) {
    const blocked: string[] = [];
    for (const table of remaining) {
      try {
        rows += await prisma.$executeRawUnsafe(`DELETE FROM "${table}" WHERE "tenantId" = $1`, tenantId);
      } catch {
        // Another table still points at this one; it goes on the next pass.
        blocked.push(table);
      }
    }
    if (blocked.length === remaining.length) break;
    remaining = blocked;
  }
  if (remaining.length > 0) {
    throw new Error(`Could not clear: ${remaining.join(", ")}`);
  }

  await prisma.tenant.delete({ where: { id: tenantId } });
  return { tables: tables.length, rows };
}

/** Workspaces whose week is up. Run from the daily cron. */
export async function purgeDueTenants(now = new Date()): Promise<Array<{ tenantId: string; name: string; rows: number }>> {
  const due = await prisma.tenant.findMany({
    where: { deletionRequestedAt: { lte: new Date(now.getTime() - GRACE_DAYS * 86_400_000) } },
    select: { id: true, name: true },
  });
  const done: Array<{ tenantId: string; name: string; rows: number }> = [];
  for (const tenant of due) {
    try {
      const { rows } = await purgeTenant(tenant.id);
      done.push({ tenantId: tenant.id, name: tenant.name, rows });
    } catch (err) {
      console.error(`[closure] ${tenant.id} could not be purged:`, err);
    }
  }
  return done;
}
