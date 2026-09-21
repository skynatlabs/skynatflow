// The week, per person, against the jobs.
//
// One figure carries this page: how much of the time a business pays for
// actually reaches a customer. Everything else on it exists to explain that
// number or to say why it cannot be trusted yet.

import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AuthRequiredError, ForbiddenError, requireTenantAccess } from "@/lib/auth/tenant-access";
import { can } from "@/lib/core/access";
import { teamWeek } from "@/lib/core/timesheets";
import { moneyOf } from "@/lib/regions";
import { PageHeader } from "../PageHeader";
import { EmptyState } from "@/components/dashboard/EmptyState";

export const dynamic = "force-dynamic";

function startOfWeek(date: Date): Date {
  const day = new Date(date);
  // Monday. A week that starts on Sunday puts half a working week on each
  // side of the line and makes every figure on this page harder to read.
  const offset = (day.getDay() + 6) % 7;
  day.setDate(day.getDate() - offset);
  day.setHours(0, 0, 0, 0);
  return day;
}

export default async function TimesheetsPage({
  params,
  searchParams,
}: {
  params: Promise<{ tenantId: string }>;
  searchParams: Promise<{ week?: string }>;
}) {
  const { tenantId } = await params;
  const { week } = await searchParams;
  let access;
  try {
    access = await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const from = week ? startOfWeek(new Date(week)) : startOfWeek(new Date());
  const to = new Date(from.getTime() + 7 * 86_400_000);
  const seesCost = can(access, "staff:manage");

  const report = await teamWeek({ tenantId, from, to });
  const money = await moneyOf(tenantId);

  const previous = new Date(from.getTime() - 7 * 86_400_000).toISOString().slice(0, 10);
  const next = new Date(from.getTime() + 7 * 86_400_000).toISOString().slice(0, 10);

  return (
    <div className="pb-10">
      <PageHeader
        tenantId={tenantId}
        title="Timesheets"
        actions={
          <span className="flex gap-2">
            <Link href={`?week=${previous}`} className="kb-pill kb-pill-ghost text-xs">
              Previous
            </Link>
            <Link href={`?week=${next}`} className="kb-pill kb-pill-ghost text-xs">
              Next
            </Link>
          </span>
        }
      />

      <p className="mb-4 text-sm text-[var(--kb-text-dim)]">
        Week of {from.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}. {report.note}
      </p>

      {report.sheets.length === 0 ? (
        <EmptyState
          title="Nobody clocked any hours this week"
          purpose="Shows how much of the time you pay for reaches a customer, per person and per job."
          needs="Staff clocking on — to a job where there is one, which is what makes the hours costable."
          action={{ label: "Attendance", href: `/dashboard/${tenantId}/attendance` }}
        />
      ) : (
        <>
          <div className="kb-card mb-4 grid gap-3 p-4 sm:grid-cols-3 sm:p-5">
            <div>
              <p className="text-xs text-[var(--kb-text-dim)]">Hours worked</p>
              <p className="text-2xl font-semibold tabular-nums text-[var(--kb-text)]">{report.totalHours}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--kb-text-dim)]">Of those, on a job</p>
              <p className="text-2xl font-semibold tabular-nums text-[var(--kb-text)]">{report.onJobHours}</p>
            </div>
            <div>
              <p className="text-xs text-[var(--kb-text-dim)]">Reached a customer</p>
              <p className="text-2xl font-semibold tabular-nums text-[var(--kb-text)]">{report.billablePercent}%</p>
            </div>
          </div>

          <ul className="grid gap-3">
            {report.sheets.map((sheet) => (
              <li key={sheet.membershipId} className="kb-card p-4 sm:p-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-medium text-[var(--kb-text)]">{sheet.name}</span>
                  <span className="text-sm tabular-nums text-[var(--kb-text)]">
                    {Math.round(sheet.totalMinutes / 60)} h
                    <span className="ml-2 text-[11px] text-[var(--kb-text-dim)]">{sheet.billablePercent}% on jobs</span>
                    {seesCost && sheet.costCents !== null && (
                      <span className="ml-2 text-[11px] text-[var(--kb-text-dim)]">{money(sheet.costCents)}</span>
                    )}
                  </span>
                </div>

                {sheet.jobs.length > 0 && (
                  <ul className="mt-2 grid gap-1 text-xs text-[var(--kb-text-dim)]">
                    {sheet.jobs.slice(0, 6).map((job) => (
                      <li key={job.jobCardId ?? "none"} className="flex justify-between gap-2">
                        <span>{job.title}</span>
                        <span className="tabular-nums">{Math.round((job.minutes / 60) * 10) / 10} h</span>
                      </li>
                    ))}
                  </ul>
                )}

                {sheet.warnings.map((warning) => (
                  <p key={warning} className="mt-2 text-xs text-[var(--kb-tint-amber-ink)]">
                    {warning}
                  </p>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mt-4 max-w-prose text-xs text-[var(--kb-text-dim)]">
        A shift started and never closed counts as no hours at all rather than as a full day. Filling it in would quietly
        inflate every cost figure that divides by these numbers, and nobody would ever find out.
      </p>
    </div>
  );
}
