"use server";

import { revalidatePath } from "next/cache";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { createBankAccount, importStatement } from "@/lib/core/banking";
import { acceptMatch, ignoreLine, recordOverrule } from "@/lib/core/reconciliation";
import type { CandidateKind } from "@/lib/core/reconciliation";

async function guard(tenantId: string) {
  const access = await requireTenantAccess(tenantId);
  // Reconciling writes to the books. That is an owner-level act even though
  // the individual clicks look small.
  assertCan(access, "staff:manage");
  return access;
}

function refresh(tenantId: string) {
  revalidatePath(`/dashboard/${tenantId}/banking`);
  revalidatePath(`/dashboard/${tenantId}/books`);
}

export async function addBankAccountAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await guard(tenantId);

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Give the account a name.");

  await createBankAccount({
    tenantId,
    name,
    last4: String(formData.get("last4") ?? "").trim() || null,
  });
  refresh(tenantId);
}

export interface ImportOutcome {
  ok: boolean;
  message: string;
  problems: string[];
}

/**
 * Import a statement.
 *
 * Returns a result rather than redirecting, because the counts are the point:
 * "imported 34, skipped 12 already seen" is what tells somebody the
 * deduplication worked and their overlapping export did not double anything.
 */
export async function importStatementAction(input: {
  tenantId: string;
  bankAccountId: string;
  csv: string;
}): Promise<ImportOutcome> {
  await guard(input.tenantId);

  const result = await importStatement(input);
  refresh(input.tenantId);

  if (result.imported === 0 && result.duplicates === 0) {
    return {
      ok: false,
      message: "Nothing could be read from that file.",
      problems: result.problems.slice(0, 8),
    };
  }

  const parts = [`Imported ${result.imported} line${result.imported === 1 ? "" : "s"}`];
  if (result.duplicates > 0) {
    parts.push(`skipped ${result.duplicates} already on file`);
  }
  if (result.problems.length > 0) {
    parts.push(`${result.problems.length} row${result.problems.length === 1 ? "" : "s"} couldn't be read`);
  }

  return { ok: true, message: `${parts.join(", ")}.`, problems: result.problems.slice(0, 8) };
}

export async function acceptMatchAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await guard(tenantId);

  await acceptMatch({
    tenantId,
    bankTransactionId: String(formData.get("bankTransactionId") ?? ""),
    kind: String(formData.get("kind") ?? "account") as CandidateKind,
    targetId: String(formData.get("targetId") ?? ""),
    rememberFor: String(formData.get("rememberFor") ?? "").trim() || null,
    userId: access.userId,
  });
  refresh(tenantId);
}

export async function ignoreLineAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await guard(tenantId);

  await ignoreLine({
    tenantId,
    bankTransactionId: String(formData.get("bankTransactionId") ?? ""),
    note: String(formData.get("note") ?? "").trim() || undefined,
  });
  refresh(tenantId);
}

/**
 * Reject a proposal.
 *
 * Only useful when a learned rule produced it — that is the thing capable of
 * improving. A wrong guess from amount-matching alone carries no lesson worth
 * storing.
 */
export async function rejectMatchAction(formData: FormData) {
  const tenantId = String(formData.get("tenantId") ?? "");
  await guard(tenantId);

  await recordOverrule({
    tenantId,
    description: String(formData.get("description") ?? ""),
  });
  refresh(tenantId);
}
