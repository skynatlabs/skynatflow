// Mail, in the workspace.
//
// Conversations rather than a list of messages: what the customer wrote, what
// was sent back, and who sent it — with the reply going out from the
// business's own address where a mailbox is connected for sending.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthRequiredError, ForbiddenError, requireTenantAccess } from "@/lib/auth/tenant-access";
import { prisma } from "@/lib/db";
import { listThreads, readThread, sendingAccount } from "@/lib/core/mailbox";
import { PageHeader } from "../PageHeader";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { archiveAction, composeAction, markReadAction, replyAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function MailPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ thread?: string; archived?: string; compose?: string }>;
}) {
  const { tenantId } = await params;
  const { thread: threadKey, archived, compose } = await searchParams;
  try {
    await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const showArchived = archived === "1";
  const [threads, open, account, accounts] = await Promise.all([
    listThreads(tenantId, { archived: showArchived }),
    threadKey ? readThread(tenantId, threadKey) : Promise.resolve({ thread: null, messages: [] }),
    sendingAccount(tenantId),
    prisma.emailAccount.count({ where: { tenantId, isActive: true } }),
  ]);

  const lastInbound = [...open.messages].reverse().find((m) => m.direction === "in");

  return (
    <div className="pb-10">
      <PageHeader
        tenantId={tenantId}
        title="Mail"
        crumbs={[{ label: "Mail" }]}
        actions={
          <span className="flex flex-wrap gap-1">
            <Link href={`/dashboard/${tenantId}/mail?compose=1`} className="kb-pill kb-pill-primary text-xs">
              Write a message
            </Link>
            <Link href={`/dashboard/${tenantId}/mail${showArchived ? "" : "?archived=1"}`} className="kb-pill kb-pill-ghost text-xs">
              {showArchived ? "Back to the inbox" : "Archived"}
            </Link>
            <Link href={`/dashboard/${tenantId}/settings/mail`} className="kb-pill kb-pill-ghost text-xs">
              Mailboxes
            </Link>
          </span>
        }
      />

      {accounts === 0 && (
        <div className="kb-card mb-4 flex flex-wrap items-center justify-between gap-3 px-5 py-3" style={{ background: "var(--kb-tint-yellow)" }}>
          <p className="text-sm text-[var(--kb-text)]">No mailbox is connected yet, so nothing arrives here.</p>
          <Link href={`/dashboard/${tenantId}/settings/mail`} className="kb-pill kb-pill-primary text-xs">
            Connect your mail
          </Link>
        </div>
      )}
      {accounts > 0 && !account?.smtpHost && (
        <p className="mb-4 text-xs text-[var(--kb-text-dim)]">
          Replies will go out from the platform&apos;s address until you add your mailbox&apos;s sending details under{" "}
          <Link href={`/dashboard/${tenantId}/settings/mail`} className="underline">
            Mailboxes
          </Link>
          . Mail from your own address is far likelier to land in an inbox.
        </p>
      )}

      {compose === "1" && (
        <form action={composeAction.bind(null, tenantId)} className="kb-card mb-4 p-5">
          <h2 className="text-sm font-semibold text-[var(--kb-text)]">New message</h2>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <input name="to" type="email" required placeholder="them@example.com" className="kb-input text-sm" />
            <input name="subject" required placeholder="Subject" className="kb-input text-sm" />
          </div>
          <textarea name="body" required rows={5} placeholder="Write it here" className="kb-input mt-2 w-full text-sm" />
          <div className="mt-3 flex justify-end gap-2">
            <Link href={`/dashboard/${tenantId}/mail`} className="kb-pill kb-pill-ghost text-xs">
              Cancel
            </Link>
            <SubmitButton pendingText="Sending…">Send</SubmitButton>
          </div>
        </form>
      )}

      <div className="grid gap-4 lg:grid-cols-[22rem_minmax(0,1fr)]">
        <section className="kb-card overflow-hidden p-0">
          {threads.length === 0 ? (
            <div className="p-5">
              <EmptyState
                title={showArchived ? "Nothing archived" : "No mail yet"}
                purpose="Every conversation with a customer in one place, beside their invoices."
                needs="A connected mailbox, or a message written from here."
              />
            </div>
          ) : (
            <ul className="divide-y divide-[var(--kb-panel-border)]">
              {threads.map((t) => {
                const active = t.key === threadKey;
                return (
                  <li key={t.key}>
                    <Link
                      href={`/dashboard/${tenantId}/mail?thread=${encodeURIComponent(t.key)}${showArchived ? "&archived=1" : ""}`}
                      className="block px-4 py-3 hover:bg-black/[0.02]"
                      style={active ? { background: "var(--kb-tint-blue)" } : undefined}
                    >
                      <div className="flex items-baseline justify-between gap-2">
                        <span className={`truncate text-sm ${t.unread > 0 ? "font-semibold" : "font-medium"} text-[var(--kb-text)]`}>
                          {t.partyName ?? t.counterpart}
                        </span>
                        <span className="shrink-0 text-[10px] text-[var(--kb-text-dim)]">
                          {t.lastAt.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                        </span>
                      </div>
                      <p className="truncate text-xs text-[var(--kb-text)]">{t.subject}</p>
                      <p className="truncate text-xs text-[var(--kb-text-dim)]">{t.preview}</p>
                      {t.unread > 0 && (
                        <span className="kb-pill mt-1 inline-flex text-[10px]" style={{ background: "var(--kb-accent-a)", color: "#fff" }}>
                          {t.unread} new
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="kb-card p-5">
          {!open.thread ? (
            <p className="text-sm text-[var(--kb-text-dim)]">Pick a conversation to read it.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-[var(--kb-text)]">{open.thread.subject}</h2>
                  <p className="text-xs text-[var(--kb-text-dim)]">
                    {open.thread.partyName ? (
                      <Link href={`/dashboard/${tenantId}/customers/${open.thread.partyId}`} className="underline">
                        {open.thread.partyName}
                      </Link>
                    ) : null}
                    {open.thread.partyName ? " · " : ""}
                    {open.thread.counterpart}
                  </p>
                </div>
                <span className="flex gap-1">
                  {open.thread.unread > 0 && (
                    <form action={markReadAction.bind(null, tenantId, open.thread.key)}>
                      <button type="submit" className="kb-pill kb-pill-ghost text-[10px]">
                        Mark read
                      </button>
                    </form>
                  )}
                  <form action={archiveAction.bind(null, tenantId, open.thread.key, !showArchived)}>
                    <button type="submit" className="kb-pill kb-pill-ghost text-[10px]">
                      {showArchived ? "Back to inbox" : "Archive"}
                    </button>
                  </form>
                </span>
              </div>

              <ol className="mt-4 space-y-3">
                {open.messages.map((m) => (
                  <li
                    key={m.id}
                    className="rounded-xl p-3"
                    style={{
                      background: m.direction === "in" ? "var(--kb-panel)" : "var(--kb-tint-mint)",
                      border: "1px solid var(--kb-panel-border)",
                    }}
                  >
                    <p className="text-[11px] text-[var(--kb-text-dim)]">
                      {m.direction === "in" ? m.address : `You${m.authorName ? ` · ${m.authorName}` : ""}`} ·{" "}
                      {m.at.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                      {m.failed ? ` · did not send: ${m.failed}` : ""}
                    </p>
                    <p className="mt-1 text-sm whitespace-pre-wrap text-[var(--kb-text)]">{m.body}</p>
                  </li>
                ))}
              </ol>

              {lastInbound ? (
                <form action={replyAction.bind(null, tenantId, lastInbound.id, open.thread.key)} className="mt-4">
                  <textarea name="body" required rows={4} placeholder="Reply…" className="kb-input w-full text-sm" />
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <span className="text-[11px] text-[var(--kb-text-dim)]">
                      {account?.smtpHost ? `Goes out from ${account.emailAddress}.` : "Goes out from the platform's address."}
                    </span>
                    <SubmitButton pendingText="Sending…">Send reply</SubmitButton>
                  </div>
                </form>
              ) : (
                <p className="mt-4 text-xs text-[var(--kb-text-dim)]">
                  Nothing has come in on this conversation yet, so there is nothing to reply to. Write a new message instead.
                </p>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
