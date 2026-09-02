// Every booked CONSULTATION/SITE_VISIT — past and upcoming — with a
// "Mark no-show" button on anything already past its slot time. This is
// the missing surface for the no-show PA job (src/lib/core/reminders.ts
// markNoShowAndRebook): the logic existed with nothing to click before
// this page.

import { prisma } from "@/lib/db";
import { markNoShowAction } from "./actions";
import { BreakdownBarChart } from "@/components/dashboard/MiniCharts";

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

  const days: { start: Date; end: Date; label: string }[] = [];
  for (let i = -3; i <= 3; i++) {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    const end = new Date(start.getTime() + 86400000);
    days.push({ start, end, label: start.toLocaleDateString(undefined, { weekday: "short", day: "numeric" }) });
  }
  const barData = days.map(({ start, end, label }) => ({
    name: label,
    value: appointments.filter((a) => a.scheduledAt! >= start && a.scheduledAt! < end).length,
    color: "var(--kb-accent-a)",
  }));

  return (
    <main className="mx-auto max-w-2xl p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Appointments</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        Booked site visits and consultations. Mark a past one as a no-show and flow sends the
        rebooking nudge immediately.
      </p>

      <div className="mt-6">
        <BreakdownBarChart title="Appointments, this week (±3 days)" data={barData} />
      </div>

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-[var(--kb-text-dim)]">Upcoming</h2>
        {upcoming.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--kb-text-dim)]">Nothing booked yet.</p>
        ) : (
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {upcoming.map((a) => (
              <div key={a.id} className="kb-tile kb-tint-blue">
                <p className="font-semibold">{a.party?.name ?? "Unknown"}</p>
                <p className="mt-1 text-xs opacity-70">{when(a.scheduledAt!)}</p>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="mt-8">
        <h2 className="text-sm font-semibold text-[var(--kb-text-dim)]">Past</h2>
        {past.length === 0 ? (
          <p className="mt-2 text-sm text-[var(--kb-text-dim)]">No past appointments yet.</p>
        ) : (
          <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2">
            {past.map((a) => (
              <div key={a.id} className="kb-tile kb-tint-violet flex flex-col justify-between">
                <div>
                  <p className="font-semibold">{a.party?.name ?? "Unknown"}</p>
                  <p className="mt-1 text-xs opacity-70">{when(a.scheduledAt!)}</p>
                </div>
                <div className="mt-3">
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
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
