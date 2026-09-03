export default async function BackupSettingsPage() {
  return (
    <main className="mx-auto max-w-xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Account settings &amp; document backup</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Automatically back up every new signed quote, lease contract, and compliance filing to your
        own cloud storage — your data stays yours, even away from flow.
      </p>

      <div className="kb-card mt-6 p-5 opacity-60">
        <div className="flex items-center justify-between">
          <div>
            <p className="font-medium text-[var(--kb-text)]">Google Drive</p>
            <p className="text-xs text-[var(--kb-text-dim)]">
              Coming soon — needs a verified Google OAuth app first. Your documents are safe on flow
              in the meantime; this just isn't wired up to sync anywhere yet.
            </p>
          </div>
          <button disabled className="kb-pill kb-pill-ghost text-xs">
            Connect Google Drive
          </button>
        </div>
      </div>
    </main>
  );
}
