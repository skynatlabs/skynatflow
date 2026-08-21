import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { getBookingConfig, listAvailableSlots } from "@/lib/core/booking";
import { bookSlotAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function PublicBookingPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ booked?: string }>;
}) {
  const { tenantId } = await params;
  const { booked } = await searchParams;

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) notFound();

  const config = getBookingConfig(tenant);
  if (!config.enabled) notFound();

  const slots = await listAvailableSlots(tenantId, config);

  return (
    <div className="kb-shell min-h-screen p-8" data-theme="light">
      <main className="mx-auto max-w-lg">
        <p className="text-sm text-[var(--kb-text-dim)]">{tenant.name}</p>
        <h1 className="text-2xl font-bold text-[var(--kb-text)]">Book an appointment</h1>

        {booked === "1" ? (
          <div className="kb-card mt-6 p-6 text-center">
            <p className="text-lg font-semibold text-[var(--kb-tint-mint-ink)]">
              ✓ You&apos;re booked!
            </p>
            <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
              {tenant.name} will be in touch if anything changes.
            </p>
          </div>
        ) : (
          <form action={bookSlotAction} className="kb-card mt-6 space-y-4 p-6">
            <input type="hidden" name="tenantId" value={tenantId} />

            <div>
              <label className="block text-sm font-medium text-[var(--kb-text)]">Pick a time</label>
              <select
                name="slot"
                required
                className="mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)]"
              >
                <option value="">— choose a slot —</option>
                {slots.map((s) => (
                  <option key={s.toISOString()} value={s.toISOString()}>
                    {s.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                    {" · "}
                    {s.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
                  </option>
                ))}
              </select>
              {slots.length === 0 && (
                <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
                  No open slots right now — check back soon.
                </p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--kb-text)]">Your name</label>
              <input
                name="name"
                required
                className="mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--kb-text)]">
                WhatsApp number
              </label>
              <input
                name="phone"
                required
                placeholder="+27821234567"
                className="mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[var(--kb-text)]">
                Notes <span className="text-[var(--kb-text-dim)]">(optional)</span>
              </label>
              <textarea
                name="notes"
                rows={2}
                className="mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)]"
              />
            </div>

            <button
              type="submit"
              disabled={slots.length === 0}
              className="kb-pill kb-pill-primary w-full justify-center py-3 disabled:opacity-50"
            >
              Confirm booking
            </button>
          </form>
        )}
      </main>
    </div>
  );
}
