import { listNotifications } from "@/lib/core/notifications2";
import { listInboundEmails } from "@/lib/core/email";
import { markEmailReadAction, markNotificationReadAction, markAllNotificationsReadAction } from "./actions";
import { BreakdownDonut } from "@/components/dashboard/MiniCharts";

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
  const [notifications, emails] = await Promise.all([
    listNotifications(tenantId),
    listInboundEmails(tenantId),
  ]);

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
    <main className="mx-auto max-w-3xl p-8">
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
            <li className="px-5 py-4 text-sm text-[var(--kb-text-dim)]">Nothing yet.</li>
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
