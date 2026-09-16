import Link from "next/link";
import { listNotifications } from "@/lib/core/notifications2";
import { listInboundEmails } from "@/lib/core/email";
import { listSubmissions } from "@/lib/core/portal";
import { listConversations, responseHealth } from "@/lib/core/conversations";
import { unansweredMissedCalls } from "@/lib/core/calls";
import { leadResponseHealth, listSubmissions as listEnquiries } from "@/lib/core/leadForms";
import { tenantCurrency } from "@/lib/core/currency";
import { formatMoney } from "@/lib/format/money";
import {
  acceptDetailsAction,
  handleSubmissionAction,
  markEmailReadAction,
  markNotificationReadAction,
  markAllNotificationsReadAction,
} from "./actions";
import { BreakdownDonut } from "@/components/dashboard/MiniCharts";

const SUBMISSION_LABEL: Record<string, string> = {
  payment_proof: "Says they have paid",
  message: "Asked a question",
  details: "Corrected their details",
};

const CATEGORY_TINT: Record<string, string> = {
  STATEMENT: "kb-tint-blue",
  INVOICE: "kb-tint-yellow",
  LEGAL: "kb-tint-peach",
  QUOTE_REPLY: "kb-tint-mint",
  OTHER: "kb-tint-violet",
};

const CATEGORY_COLOR: Record<string, string> = {
  STATEMENT: "var(--kb-tint-blue-ink)",
  INVOICE: "var(--kb-tint-yellow-ink)",
  LEGAL: "var(--kb-tint-peach-ink)",
  QUOTE_REPLY: "var(--kb-tint-mint-ink)",
  OTHER: "var(--kb-tint-violet-ink)",
};

export default async function InboxPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const [notifications, emails, fromCustomers, currency, waiting, replyHealth, missed, enquiries, leadHealth] =
    await Promise.all([
      listNotifications(tenantId),
      listInboundEmails(tenantId),
      listSubmissions(tenantId, { handled: false }),
      tenantCurrency(tenantId),
      listConversations(tenantId, { status: "OPEN" }),
      responseHealth(tenantId),
      unansweredMissedCalls(tenantId),
      listEnquiries(tenantId, { handled: false }),
      leadResponseHealth(tenantId),
    ]);
  // Only the ones where somebody is actually waiting on an answer. An open
  // conversation nobody is waiting on is not a thing to put in front of
  // anybody at the top of their inbox.
  const unanswered = waiting.filter((c) => c.waitingSince !== null);

  const categoryCounts = emails.reduce<Record<string, number>>((acc, e) => {
    acc[e.category] = (acc[e.category] ?? 0) + 1;
    return acc;
  }, {});
  const donutData = Object.entries(categoryCounts).map(([category, count]) => ({
    name: category.replace("_", " "),
    value: count,
    color: CATEGORY_COLOR[category] ?? "#94a3b8",
  }));

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6 lg:p-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Inbox</h1>
          <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
            Everything that needs your attention — hot leads, important mail, and follow-up
            activity — in one place, so nothing gets missed in an inbox nobody checks.
          </p>
        </div>
        <form action={markAllNotificationsReadAction}>
          <input type="hidden" name="tenantId" value={tenantId} />
          <button type="submit" className="kb-pill kb-pill-ghost text-xs">Mark all read</button>
        </form>
      </div>

      {/* The three things where somebody is on the other end waiting, above
          everything else. A missed call and an unanswered enquiry are both
          somebody who has already gone to the next business on the list. */}
      {(missed.length > 0 || enquiries.length > 0 || unanswered.length > 0) && (
        <section className="mt-6 space-y-4">
          {missed.length > 0 && (
            <div className="kb-card p-5" style={{ background: "var(--kb-status-danger)" }}>
              <h2 className="text-sm font-semibold text-[var(--kb-text)]">
                {missed.length} missed {missed.length === 1 ? "call" : "calls"} nobody has answered
              </h2>
              <ul className="mt-2 space-y-1">
                {missed.slice(0, 6).map((c) => (
                  <li key={c.id} className="text-sm text-[var(--kb-text)]">
                    {c.party ? (
                      <Link href={`/dashboard/${tenantId}/customers/${c.partyId}`} className="hover:underline">
                        {c.party.companyName ?? c.party.name}
                      </Link>
                    ) : (
                      c.fromNumber
                    )}
                    <span className="ml-2 text-xs text-[var(--kb-text-dim)]">
                      {c.startedAt.toLocaleString(undefined, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {enquiries.length > 0 && (
            <div className="kb-card p-5" style={{ background: "var(--kb-tint-yellow)" }}>
              <h2 className="text-sm font-semibold text-[var(--kb-text)]">
                {enquiries.length} {enquiries.length === 1 ? "enquiry" : "enquiries"} not answered
              </h2>
              <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">{leadHealth.summary}</p>
              <ul className="mt-2 space-y-1">
                {enquiries.slice(0, 6).map((e) => (
                  <li key={e.id} className="text-sm text-[var(--kb-text)]">
                    {e.answerList.name ?? e.party?.name ?? "Somebody"}
                    {e.answerList.need ? <span className="text-[var(--kb-text-dim)]"> — {e.answerList.need.slice(0, 90)}</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {unanswered.length > 0 && (
            <div className="kb-card p-5">
              <h2 className="text-sm font-semibold text-[var(--kb-text)]">Waiting on an answer</h2>
              <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">{replyHealth.summary}</p>
              <ul className="mt-2 divide-y divide-[var(--kb-panel-border)]">
                {unanswered.slice(0, 8).map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span className="text-sm text-[var(--kb-text)]">
                      {c.customer ?? c.threadKey}
                      {c.assignedTo ? <span className="ml-2 text-xs text-[var(--kb-text-dim)]">{c.assignedTo}</span> : null}
                    </span>
                    <span className="text-xs" style={{ color: (c.waitingHours ?? 0) >= 24 ? "var(--kb-status-danger-ink)" : "var(--kb-text-dim)" }}>
                      {c.waitingHours !== null && c.waitingHours >= 24
                        ? `${Math.floor(c.waitingHours / 24)} days`
                        : `${c.waitingHours ?? 0} hours`}
                      {c.assignedTo ? "" : " · nobody has it"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      )}

      {/* Customers first. Someone waiting on an answer about money they have
          already sent is the most expensive thing in this list to leave sitting. */}
      {fromCustomers.length > 0 && (
        <section className="mt-6">
          <h2 className="text-lg font-semibold text-[var(--kb-text)]">From your customers</h2>
          <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
            Sent from their own portal link. Nothing here has changed the books — it is waiting on you.
          </p>
          <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
            {fromCustomers.map((s) => (
              <li key={s.id} className="px-5 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-[var(--kb-text)]">
                      <Link href={`/dashboard/${tenantId}/customers/${s.partyId}`} className="hover:underline">
                        {s.party.name}
                      </Link>{" "}
                      <span className="text-xs font-normal text-[var(--kb-text-dim)]">
                        · {SUBMISSION_LABEL[s.kind] ?? s.kind} ·{" "}
                        {s.createdAt.toLocaleDateString(undefined, { day: "numeric", month: "short" })}
                      </span>
                    </p>
                    {s.transaction && (
                      <p className="text-xs text-[var(--kb-text-dim)]">
                        About {s.transaction.type.toLowerCase()} {formatMoney(s.transaction.amountCents, currency)}
                      </p>
                    )}
                    {s.body && <p className="mt-1 text-sm whitespace-pre-wrap text-[var(--kb-text)]">{s.body}</p>}
                  </div>
                  <span className="flex shrink-0 flex-wrap gap-1">
                    {s.kind === "payment_proof" && s.transaction && (
                      <Link
                        href={`/dashboard/${tenantId}/invoices/${s.transaction.id}`}
                        className="kb-pill kb-pill-primary text-xs"
                      >
                        Record the payment
                      </Link>
                    )}
                    {s.kind === "details" && (
                      <form action={acceptDetailsAction}>
                        <input type="hidden" name="tenantId" value={tenantId} />
                        <input type="hidden" name="submissionId" value={s.id} />
                        <button type="submit" className="kb-pill kb-pill-primary text-xs">
                          Apply the change
                        </button>
                      </form>
                    )}
                    <form action={handleSubmissionAction}>
                      <input type="hidden" name="tenantId" value={tenantId} />
                      <input type="hidden" name="submissionId" value={s.id} />
                      <button type="submit" className="kb-pill kb-pill-ghost text-xs">
                        Done
                      </button>
                    </form>
                  </span>
                </div>
                {s.fileDataUrl && (
                  <a href={s.fileDataUrl} download={s.fileName ?? "proof"} target="_blank" rel="noopener noreferrer">
                    {s.fileDataUrl.startsWith("data:image/") ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.fileDataUrl}
                        alt={s.fileName ?? "Proof of payment"}
                        className="mt-2 max-h-56 rounded-xl border border-[var(--kb-panel-border)]"
                      />
                    ) : (
                      <span className="kb-pill kb-pill-ghost mt-2 inline-flex text-xs">
                        Open {s.fileName ?? "the attachment"}
                      </span>
                    )}
                  </a>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {donutData.length > 0 && (
        <div className="mt-6">
          <BreakdownDonut title="Mail by category" data={donutData} />
        </div>
      )}

      <section className="mt-6">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Notifications</h2>
        <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
          {notifications.map((n) => (
            <li key={n.id} className={`flex items-center justify-between px-5 py-3 ${n.isRead ? "opacity-60" : ""}`}>
              <div>
                <p className="font-medium text-[var(--kb-text)]">{n.title}</p>
                <p className="text-xs text-[var(--kb-text-dim)]">{n.body}</p>
              </div>
              {!n.isRead && (
                <form action={markNotificationReadAction}>
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="notificationId" value={n.id} />
                  <button type="submit" className="kb-pill kb-pill-ghost text-xs">Mark read</button>
                </form>
              )}
            </li>
          ))}
          {notifications.length === 0 && (
            <li className="px-5 py-4 text-sm text-[var(--kb-text-dim)]">
              Nothing has needed you. Blocking deadlines, customer replies and anything an officer cannot rank land here the moment they happen; everything else waits on The Brief.
            </li>
          )}
        </ul>
      </section>

      <section className="mt-8">
        <h2 className="text-lg font-semibold text-[var(--kb-text)]">Mail</h2>
        <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
          Statements, invoices, and legal mail are flagged automatically — connect an account in
          Settings → Mail to start receiving.
        </p>
        <ul className="kb-card mt-3 divide-y divide-[var(--kb-panel-border)]">
          {emails.map((e) => (
            <li key={e.id} className={`flex items-center justify-between px-5 py-3 ${e.isRead ? "opacity-60" : ""}`}>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className={`kb-tile ${CATEGORY_TINT[e.category]} !py-0.5 !px-2 text-[10px] font-semibold`}>
                    {e.category.replace("_", " ")}
                  </span>
                  {e.isImportant && <span className="text-xs text-[var(--kb-tint-peach-ink)]">Important</span>}
                </div>
                <p className="mt-1 truncate font-medium text-[var(--kb-text)]">{e.subject}</p>
                <p className="truncate text-xs text-[var(--kb-text-dim)]">{e.aiSummary ?? e.fromAddress}</p>
              </div>
              {!e.isRead && (
                <form action={markEmailReadAction}>
                  <input type="hidden" name="tenantId" value={tenantId} />
                  <input type="hidden" name="emailId" value={e.id} />
                  <button type="submit" className="kb-pill kb-pill-ghost shrink-0 text-xs">Mark read</button>
                </form>
              )}
            </li>
          ))}
          {emails.length === 0 && (
            <li className="px-5 py-4 text-sm text-[var(--kb-text-dim)]">No mail yet.</li>
          )}
        </ul>
      </section>
    </main>
  );
}
