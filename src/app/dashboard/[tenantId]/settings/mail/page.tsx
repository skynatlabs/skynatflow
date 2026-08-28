import { listEmailAccounts } from "@/lib/core/email";
import { connectImapAction, connectFlowHostedAction, disconnectAccountAction } from "./actions";

export default async function MailSettingsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const accounts = await listEmailAccounts(tenantId);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Mail</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Connect an account so flow can watch for statements, invoices, legal mail, and quote
        replies — and flag what actually needs your attention.
      </p>

      <section className="mt-6">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Connected accounts</h2>
        <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
          {accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between px-5 py-3">
              <div>
                <p className="font-medium text-[var(--kb-text)]">{a.emailAddress}</p>
                <p className="text-xs text-[var(--kb-text-dim)]">
                  {a.provider}
                  {a.flowInboundAddress && ` · forwards to ${a.flowInboundAddress}`}
                  {!a.isActive && " · disconnected"}
                </p>
              </div>
              {a.isActive && (
                <form action={disconnectAccountAction}>
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="accountId" value={a.id} />
                  <button type="submit" className="text-xs text-red-500 hover:underline">Disconnect</button>
                </form>
              )}
            </li>
          ))}
          {accounts.length === 0 && (
            <li className="px-5 py-4 text-sm text-[var(--kb-text-dim)]">No mail connected yet.</li>
          )}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Connect via IMAP</h2>
        <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
          Works with most email providers using an app password (Gmail, Outlook, custom domains).
        </p>
        <form action={connectImapAction} className="kb-card mt-3 space-y-3 p-4">
          <input type="hidden" name="tenantId" value={tenantId} />
          <input name="emailAddress" type="email" required placeholder="you@yourbusiness.com" className="w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          <div className="flex gap-2">
            <input name="imapHost" required placeholder="imap.gmail.com" className="flex-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
            <input name="imapPort" type="number" defaultValue={993} className="w-20 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          </div>
          <input name="imapUser" required placeholder="IMAP username" className="w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          <input name="imapPassword" type="password" required placeholder="App password (encrypted at rest)" className="w-full rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          <button type="submit" className="kb-pill kb-pill-primary text-xs">Connect</button>
        </form>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Flow-hosted forwarding address</h2>
        <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
          No credentials needed — get a dedicated address and forward or CC statements/replies to
          it.
        </p>
        <form action={connectFlowHostedAction} className="kb-card mt-3 flex items-end gap-3 p-4">
          <input type="hidden" name="tenantId" value={tenantId} />
          <input name="emailAddress" type="email" required placeholder="Your usual sending address" className="flex-1 rounded-md border border-[var(--kb-panel-border)] bg-[var(--kb-bg)] p-2 text-sm" />
          <button type="submit" className="kb-pill kb-pill-ghost text-xs">Get forwarding address</button>
        </form>
      </section>

      <section className="mt-8 opacity-60">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Google (Gmail / Workspace)</h2>
        <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
          Coming soon — sign in directly with Google. Needs a verified Google OAuth app first.
        </p>
        <button disabled className="kb-pill kb-pill-ghost mt-3 text-xs">Sign in with Google</button>
      </section>
    </main>
  );
}
