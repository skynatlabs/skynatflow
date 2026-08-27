import { prisma } from "@/lib/db";
import { connectBackupAction, disconnectBackupAction } from "./actions";

export default async function BackupSettingsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });

  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Account settings &amp; document backup</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Every new signed quote, lease contract, and compliance filing backed up to your own cloud
        storage automatically — your data stays yours, even away from flow.
      </p>

      <div className="kb-card mt-6 p-5">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-[var(--kb-text)]">Google Drive</p>
            <p className="text-xs text-[var(--kb-text-dim)]">
              {tenant.docBackupConnected
                ? "Connected — new documents will sync daily once Google sign-in is fully wired up."
                : "Not connected yet."}
            </p>
          </div>
          <form action={tenant.docBackupConnected ? disconnectBackupAction : connectBackupAction}>
            <input type="hidden" name="tenantId" value={tenantId} />
            <button
              type="submit"
              className={tenant.docBackupConnected ? "kb-pill kb-pill-ghost text-xs" : "kb-pill kb-pill-primary text-xs"}
            >
              {tenant.docBackupConnected ? "Disconnect" : "Connect Google Drive"}
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
