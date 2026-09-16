// A copy in a folder they already know.
//
// The honest version of this screen: it shows the folder plan and exactly
// what would be copied, and it says plainly that the connection itself needs
// an app registered with each vendor. An owner reading this knows where they
// stand, which is worth more than a Connect button that does nothing.

import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { can } from "@/lib/core/access";
import { backupStatus, whatWouldBeCopied, DRIVE_PROVIDERS } from "@/lib/core/documentBackup";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { chooseDriveAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function DocumentCopiesPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const access = await requireTenantAccess(tenantId);
  const isOwner = can(access.role, "staff:manage");

  const [status, would] = await Promise.all([backupStatus(tenantId), whatWouldBeCopied(tenantId)]);

  return (
    <main className="mx-auto w-full max-w-3xl p-4 sm:p-6 lg:p-8">
      <h1 className="text-xl font-semibold text-[var(--kb-text)] sm:text-2xl">A copy in your own drive</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Every document this business produces, also written into a folder in your own Google Drive, OneDrive or Dropbox —
        so your records survive us.
      </p>

      <section className="kb-card mt-6 p-4 sm:p-5">
        <p className="text-sm text-[var(--kb-text)]">{status.summary}</p>

        {isOwner && (
          <form action={chooseDriveAction} className="mt-3 flex flex-wrap items-end gap-2">
            <input type="hidden" name="tenantId" value={tenantId} />
            <label className="text-xs text-[var(--kb-text-dim)]">
              Drive
              <select
                name="provider"
                defaultValue={status.provider ?? ""}
                className="mt-1 w-56 rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-3 py-2 text-sm text-[var(--kb-text)]"
              >
                <option value="">None</option>
                {DRIVE_PROVIDERS.map((provider) => (
                  <option key={provider.key} value={provider.key}>
                    {provider.label}
                  </option>
                ))}
              </select>
            </label>
            <SubmitButton pendingText="Saving…">Save</SubmitButton>
          </form>
        )}

        <ul className="mt-4 grid gap-1.5 text-xs text-[var(--kb-text-dim)]">
          {status.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      </section>

      <section className="kb-card mt-4 p-4 sm:p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">What would be copied</h2>
        <p className="mt-1 text-sm text-[var(--kb-text)]">{would.summary}</p>

        {would.total > 0 && (
          <ul className="mt-3 divide-y divide-[var(--kb-panel-border)]">
            {would.counts
              .filter((row) => row.count > 0)
              .map((row) => (
                <li key={row.kind} className="flex flex-wrap items-baseline justify-between gap-2 py-2">
                  <span className="text-sm text-[var(--kb-text)]">{row.label}</span>
                  <span className="font-mono text-[11px] text-[var(--kb-text-dim)]">{row.folder}/</span>
                  <span className="text-sm tabular-nums text-[var(--kb-text)]">{row.count.toLocaleString()}</span>
                </li>
              ))}
          </ul>
        )}
      </section>
    </main>
  );
}
