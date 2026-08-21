import { prisma } from "@/lib/db";
import { getBookingConfig } from "@/lib/core/booking";
import { saveBookingConfigAction, saveReviewUrlAction, saveCollectionsToneAction } from "./actions";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export default async function BookingSettingsPage({
  params,
}: {
  params: Promise<{ tenantId: string }>;
}) {
  const { tenantId } = await params;
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const config = getBookingConfig(tenant);

  return (
    <main className="mx-auto max-w-md p-8">
      <h1 className="text-2xl font-semibold text-[var(--kb-text)]">Booking page</h1>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        A public link where customers pick their own appointment slot — no back-and-forth.
      </p>

      {config.enabled && (
        <div className="kb-card mt-4 p-4">
          <p className="text-xs text-[var(--kb-text-dim)]">Your booking link</p>
          <code className="mt-1 block truncate rounded-lg bg-black/5 px-3 py-2 text-xs text-[var(--kb-text)]">
            /book/{tenantId}
          </code>
        </div>
      )}

      <form action={saveBookingConfigAction} className="kb-card mt-4 space-y-4 p-6">
        <input type="hidden" name="tenantId" value={tenantId} />

        <label className="flex items-center gap-2 text-sm text-[var(--kb-text)]">
          <input type="checkbox" name="enabled" defaultChecked={config.enabled} />
          Enable the public booking page
        </label>

        <div>
          <label className="block text-sm font-medium text-[var(--kb-text)]">Working days</label>
          <div className="mt-1 flex flex-wrap gap-2">
            {DAY_LABELS.map((label, i) => (
              <label key={i} className="flex items-center gap-1 text-xs text-[var(--kb-text)]">
                <input type="checkbox" name="workDays" value={i} defaultChecked={config.workDays.includes(i)} />
                {label}
              </label>
            ))}
          </div>
        </div>

        <div className="flex gap-4">
          <div className="flex-1">
            <label className="block text-sm font-medium text-[var(--kb-text)]">Start hour</label>
            <input
              name="startHour"
              type="number"
              min={0}
              max={23}
              defaultValue={config.startHour}
              className="mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)]"
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-[var(--kb-text)]">End hour</label>
            <input
              name="endHour"
              type="number"
              min={0}
              max={23}
              defaultValue={config.endHour}
              className="mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)]"
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-[var(--kb-text)]">Slot (mins)</label>
            <input
              name="slotMins"
              type="number"
              min={15}
              step={15}
              defaultValue={config.slotMins}
              className="mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)]"
            />
          </div>
        </div>

        <button type="submit" className="kb-pill kb-pill-primary w-full justify-center py-3">
          Save
        </button>
      </form>

      <h2 className="mt-8 text-lg font-semibold text-[var(--kb-text)]">Review requests</h2>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        The moment an invoice is fully paid, this link goes out on WhatsApp automatically — once
        per invoice, no manual chasing.
      </p>
      <form action={saveReviewUrlAction} className="kb-card mt-4 space-y-3 p-6">
        <input type="hidden" name="tenantId" value={tenantId} />
        <div>
          <label className="block text-sm font-medium text-[var(--kb-text)]">
            Google review link
          </label>
          <input
            name="googleReviewUrl"
            type="url"
            placeholder="https://g.page/r/..."
            defaultValue={tenant.googleReviewUrl ?? ""}
            className="mt-1 w-full rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm text-[var(--kb-text)]"
          />
        </div>
        <button type="submit" className="kb-pill kb-pill-primary w-full justify-center py-3">
          Save
        </button>
      </form>

      <h2 className="mt-8 text-lg font-semibold text-[var(--kb-text)]">Collections tone</h2>
      <p className="mt-1 text-sm text-[var(--kb-text-dim)]">
        How firm the follow-up engine gets when chasing an unpaid invoice or unanswered quote.
      </p>
      <form action={saveCollectionsToneAction} className="kb-card mt-4 space-y-3 p-6">
        <input type="hidden" name="tenantId" value={tenantId} />
        <div className="space-y-2">
          {(
            [
              { value: "GENTLE", label: "Gentle", desc: "Always warm, assumes good faith, never pressures — even by touch 5+." },
              { value: "STANDARD", label: "Standard", desc: "Gradually escalates from a check-in to a direct, respectful ask." },
              { value: "FIRM", label: "Firm", desc: "Gets to the point from touch 2 — direct and businesslike, still professional." },
            ] as const
          ).map((opt) => (
            <label
              key={opt.value}
              className="flex cursor-pointer items-start gap-2 rounded-xl border border-[var(--kb-panel-border)] bg-white px-3 py-2.5 text-sm has-[:checked]:border-[var(--kb-accent-a)]"
            >
              <input
                type="radio"
                name="collectionsTone"
                value={opt.value}
                defaultChecked={tenant.collectionsTone === opt.value}
                className="mt-0.5"
              />
              <span>
                <span className="block font-medium text-[var(--kb-text)]">{opt.label}</span>
                <span className="block text-xs text-[var(--kb-text-dim)]">{opt.desc}</span>
              </span>
            </label>
          ))}
        </div>
        <button type="submit" className="kb-pill kb-pill-primary w-full justify-center py-3">
          Save
        </button>
      </form>
    </main>
  );
}
