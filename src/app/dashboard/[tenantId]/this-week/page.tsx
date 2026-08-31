// The actual "who do I need to contact" work list for the week — every
// quote/invoice with a reminder or default-cadence follow-up due within
// the next 7 days (or already overdue), across the whole tenant. This is
// what the daily voice briefing reads from too, so the two always agree.

import Link from "next/link";
import { listThisWeekFollowUps } from "@/lib/core/followUpReminders";

function money(cents: number) {
  return (cents / 100).toLocaleString(undefined, { style: "currency", currency: "ZAR" });
}

function dayLabel(date: Date) {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((date.getTime() - startOfToday.getTime()) / 86400000);
  if (diffDays < 0) return `Overdue by ${-diffDays} day${-diffDays === 1 ? "" : "s"}`;
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  return date.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

export default async function ThisWeekPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const items = await listThisWeekFollowUps(tenantId);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">This week</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Who to contact and why — every reminder and follow-up due in the next 7 days, or already
        overdue.
      </p>

      {items.length === 0 ? (
        <div className="kb-card mt-6 p-8 text-center text-sm text-[var(--kb-text-dim)]">
          Nothing lined up for this week. 🎉
        </div>
      ) : (
        <ul className="kb-card mt-6 divide-y divide-[var(--kb-panel-border)]">
          {items.map((t) => {
            const href = `/dashboard/${tenantId}/${t.type === "QUOTE" ? "quotes" : "invoices"}/${t.id}`;
            const isOverdue = t.nextFollowUpAt && t.nextFollowUpAt < new Date();
            return (
              <li key={t.id}>
                <Link href={href} className="flex items-center justify-between gap-4 p-4 hover:bg-black/[0.02]">
                  <div className="min-w-0">
                    <p className="font-medium text-[var(--kb-text)]">{t.party.name}</p>
                    <p className="mt-0.5 text-xs text-[var(--kb-text-dim)]">
                      {t.type === "QUOTE" ? "Quote" : "Invoice"} · {money(t.amountCents)}
                      {t.followUpNote && ` · ${t.followUpNote}`}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 text-xs font-semibold ${
                      isOverdue ? "text-[var(--kb-tint-peach-ink)]" : "text-[var(--kb-text-dim)]"
                    }`}
                  >
                    {t.nextFollowUpAt && dayLabel(t.nextFollowUpAt)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
