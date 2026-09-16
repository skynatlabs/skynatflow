"use server";

import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { exportCosts, exportInvoices, exportTrialBalance, type Package } from "@/lib/export/accounting";

/**
 * Builds the file and hands it back as text.
 *
 * Returned to the browser rather than written anywhere: the file is the
 * business's own data, it is wanted once, and storing a copy of every export
 * somebody ever ran is a pile of stale ledgers waiting to be leaked.
 */
export async function buildExportAction(formData: FormData): Promise<{ fileName: string; csv: string; rows: number; notes: string[] }> {
  const tenantId = String(formData.get("tenantId") ?? "");
  await requireTenantAccess(tenantId);

  const pkg = String(formData.get("package") ?? "generic") as Package;
  const what = String(formData.get("what") ?? "invoices");
  const from = new Date(`${String(formData.get("from") ?? "")}T00:00:00.000Z`);
  const to = new Date(`${String(formData.get("to") ?? "")}T23:59:59.999Z`);

  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new Error("Pick both dates before building the file.");
  }
  if (from > to) throw new Error("The first date is after the second one.");

  if (what === "costs") return exportCosts({ tenantId, pkg, from, to });
  if (what === "trial-balance") return exportTrialBalance({ tenantId, from, to });
  return exportInvoices({ tenantId, pkg, from, to });
}
