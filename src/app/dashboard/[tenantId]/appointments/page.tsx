// Every booked CONSULTATION/SITE_VISIT — past and upcoming — with a
// "Mark no-show" button on anything already past its slot time. This is
// the missing surface for the no-show PA job (src/lib/core/reminders.ts
// markNoShowAndRebook): the logic existed with nothing to click before
// this page.

import { prisma } from "@/lib/db";
import { markNoShowAction } from "./actions";

function when(date: Date) {
  return date.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export default async function AppointmentsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const now = new Date();

  const appointments = await prisma.event.findMany({
    where: { tenantId, type: { in: ["CONSULTATION", "SITE_VISIT"] }, scheduledAt: { not: null } },
    include: { party: true },
    orderBy: { scheduledAt: "desc" },
    take: 100,
  });

  const upcoming = appointments.filter((a) => a.scheduledAt! >= now);
  const past = appointments.filter((a) => a.scheduledAt! < now);

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Appointments</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Booked site visits and consultations. Mark a past one as a no-show and flow sends the
        rebooking nudge immediately.
      </p>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-[var(--kb-text-dim)]">Upcoming</h2>
        {upcoming.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--kb-text-dim)]">Nothing booked yet.</p>
        ) : (
          <ul className="kb-card mt-2 divide-y divide-[var(--kb-panel-border)]">
            {upcoming.map((a) => (
              <li key={a.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium text-[var(--kb-text)]">{a.party?.name ?? "Unknown"}</p>
                  <p className="text-xs text-[var(--kb-text-dim)]">{when(a.scheduledAt!)}</p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-[var(--kb-text-dim)]">Past</h2>
        {past.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--kb-text-dim)]">No past appointments yet.</p>
        ) : (
          <ul className="kb-card mt-2 divide-y divide-[var(--kb-panel-border)]">
            {past.map((a) => (
              <li key={a.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="font-medium text-[var(--kb-text)]">{a.party?.name ?? "Unknown"}</p>
                  <p className="text-xs text-[var(--kb-text-dim)]">{when(a.scheduledAt!)}</p>
                </div>
                {a.noShow ? (
                  <span className="kb-pill text-xs" style={{ background: "var(--kb-tint-peach)", color: "var(--kb-tint-peach-ink)" }}>
                    No-show — nudged
                  </span>
                ) : (
                  <form action={markNoShowAction}>
                    <input type="hidden" name="tenantId" value={tenantId} />
                    <input type="hidden" name="eventId" value={a.id} />
                    <button type="submit" className="kb-pill kb-pill-ghost text-xs">
                      Mark no-show
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
