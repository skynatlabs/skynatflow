// The hours the power is off.
//
// No business software built anywhere else has this screen, and in South
// Africa it decides more of a working week than anything on the other pages.
// Two things happen once the times are in: the week's plan stops offering
// slots that cannot be worked, and the business can finally put a number on
// what load-shedding costs it.

import { notFound, redirect } from "next/navigation";
import { AuthRequiredError, ForbiddenError, requireTenantAccess } from "@/lib/auth/tenant-access";
import { costOfDarkness, formatBlock, getSchedule, isDark, nextOutage } from "@/lib/core/loadShedding";
import { formatMoney } from "@/lib/format/money";
import { PageHeader } from "../PageHeader";
import { SubmitButton } from "@/components/dashboard/SubmitButton";
import { saveScheduleAction } from "./actions";

export const dynamic = "force-dynamic";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function timeValue(minute: number) {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

export default async function PowerPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  try {
    await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const now = new Date();
  const schedule = await getSchedule(tenantId);
  const next = nextOutage(schedule, now);
  const cost = await costOfDarkness({ tenantId, from: new Date(now.getTime() - 30 * 86_400_000), to: now });
  const dark = isDark(schedule, now);

  return (
    <div className="pb-10">
      <PageHeader tenantId={tenantId} title="Power" />

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <section className="kb-card p-4 sm:p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">Your times</h2>
          <p className="mt-1 text-xs text-[var(--kb-text-dim)]">
            Your block and your stage, as your municipality publishes them. Enter what you know — a day left blank is a
            day with no load-shedding on it, not an error.
          </p>

          <form action={saveScheduleAction} className="mt-4 grid gap-3">
            <input type="hidden" name="tenantId" value={tenantId} />

            <div className="flex flex-wrap gap-3">
              <label className="text-xs text-[var(--kb-text-dim)]">
                Area or block
                <input
                  name="areaLabel"
                  defaultValue={schedule.areaLabel ?? ""}
                  placeholder="Block 7"
                  className="mt-1 w-44 rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-3 py-2 text-sm text-[var(--kb-text)]"
                />
              </label>
              <label className="text-xs text-[var(--kb-text-dim)]">
                Stage
                <select
                  name="stage"
                  defaultValue={String(schedule.stage)}
                  className="mt-1 w-28 rounded-xl border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-3 py-2 text-sm text-[var(--kb-text)]"
                >
                  {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((stage) => (
                    <option key={stage} value={stage}>
                      {stage === 0 ? "None" : `Stage ${stage}`}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div className="mt-2 grid gap-2">
              {DAYS.map((label, day) => {
                const blocks = schedule.blocks.filter((block) => block.day === day).sort((a, b) => a.startMinute - b.startMinute);
                return (
                  <div key={label} className="flex flex-wrap items-center gap-2">
                    <span className="w-24 text-xs text-[var(--kb-text-dim)]">{label}</span>
                    {[1, 2, 3].map((slot) => {
                      const block = blocks[slot - 1];
                      return (
                        <span key={slot} className="flex items-center gap-1">
                          <input
                            type="time"
                            name={`from-${day}-${slot}`}
                            defaultValue={block ? timeValue(block.startMinute) : ""}
                            className="rounded-lg border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-2 py-1 text-xs text-[var(--kb-text)]"
                          />
                          <span className="text-[11px] text-[var(--kb-text-dim)]">to</span>
                          <input
                            type="time"
                            name={`to-${day}-${slot}`}
                            defaultValue={block ? timeValue(block.endMinute) : ""}
                            className="rounded-lg border border-[var(--kb-panel-border)] bg-[var(--kb-panel)] px-2 py-1 text-xs text-[var(--kb-text)]"
                          />
                        </span>
                      );
                    })}
                  </div>
                );
              })}
            </div>

            <div>
              <SubmitButton pendingText="Saving…">Save the schedule</SubmitButton>
            </div>
          </form>
        </section>

        <div className="grid gap-4 content-start">
          <section className="kb-card p-4 sm:p-5">
            <p className="text-sm font-medium text-[var(--kb-text)]">{dark ? "The power is off right now." : "The power is on."}</p>
            <p className="mt-1 text-xs text-[var(--kb-text-dim)]">{schedule.note}</p>

            {next && (
              <p className="mt-3 text-sm text-[var(--kb-text)]">
                Next block {next.startsAt.toLocaleDateString(undefined, { weekday: "long" })}{" "}
                {next.startsAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}–
                {next.endsAt.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}
                {next.minutesAway < 180 ? ` — that is in ${Math.round(next.minutesAway / 60)} hours.` : "."}
              </p>
            )}

            {schedule.blocks.length > 0 && (
              <ul className="mt-3 grid gap-1 text-xs text-[var(--kb-text-dim)]">
                {DAYS.map((label, day) => {
                  const blocks = schedule.blocks.filter((block) => block.day === day);
                  if (blocks.length === 0) return null;
                  return (
                    <li key={label}>
                      {label}: {blocks.map(formatBlock).join(", ")}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section className="kb-card p-4 sm:p-5">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">The last thirty days</h2>
            <dl className="mt-3 grid gap-2 text-sm">
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-[var(--kb-text-dim)]">Working hours in the dark</dt>
                <dd className="tabular-nums text-[var(--kb-text)]">{cost.workingDarkHours}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-[var(--kb-text-dim)]">Hours nobody could work</dt>
                <dd className="tabular-nums text-[var(--kb-text)]">{cost.lostLabourCents === null ? "—" : formatMoney(cost.lostLabourCents)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-2">
                <dt className="text-[var(--kb-text-dim)]">Generator fuel</dt>
                <dd className="tabular-nums text-[var(--kb-text)]">{formatMoney(cost.generatorFuelCents)}</dd>
              </div>
              <div className="flex items-baseline justify-between gap-2 border-t border-[var(--kb-panel-border)] pt-2">
                <dt className="font-medium text-[var(--kb-text)]">What it cost</dt>
                <dd className="font-medium tabular-nums text-[var(--kb-text)]">{formatMoney(cost.totalCents)}</dd>
              </div>
            </dl>
            <ul className="mt-3 grid gap-1 text-[11px] text-[var(--kb-text-dim)]">
              {cost.caveats.map((caveat) => (
                <li key={caveat}>{caveat}</li>
              ))}
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
