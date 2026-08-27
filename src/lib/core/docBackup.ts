// Document backup — daily copy of new documents (signed quotes, lease
// contracts, compliance filings) to the owner's own cloud storage.
// Checkpoint: real Google Drive OAuth isn't wired up yet (needs app
// registration + verification with Google). Connecting just flips the
// flag; the actual daily sync job logs instead of failing, same
// graceful-degradation pattern as every other unconfigured integration.

import { prisma } from "@/lib/db";

export async function connectDocBackup(tenantId: string, provider: "google_drive") {
  return prisma.tenant.update({
    where: { id: tenantId },
    data: { docBackupProvider: provider, docBackupConnected: true },
  });
}

export async function disconnectDocBackup(tenantId: string) {
  return prisma.tenant.update({
    where: { id: tenantId },
    data: { docBackupConnected: false },
  });
}

// Would run daily via cron once real OAuth exists — for now, reports what
// it WOULD back up so the feature is visibly "real but not yet wired,"
// not silently missing.
export async function runDocBackupForTenant(tenantId: string) {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  if (!tenant.docBackupConnected) return { skipped: true };

  console.warn(
    `[doc-backup:stub] tenant ${tenantId} would sync new documents to ${tenant.docBackupProvider} — OAuth not yet configured.`
  );
  return { skipped: false, stub: true };
}
