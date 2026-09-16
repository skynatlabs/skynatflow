// Paying people.
//
// The last thing a small business moves off a spreadsheet, and the reason is
// fear rather than habit: PAYE deducted and not paid over is treated far more
// seriously than any error in the business's own tax. So this screen shows
// its arithmetic rather than asking to be trusted, and it stops at the
// figures — the declaration itself goes to SARS on eFiling.

import { notFound, redirect } from "next/navigation";
import { AuthRequiredError, ForbiddenError, requireTenantAccess } from "@/lib/auth/tenant-access";
import { can } from "@/lib/core/access";
import { prisma } from "@/lib/db";
import { TAX_TABLES, taxYearOf } from "@/lib/core/payroll";
import { PageHeader } from "../PageHeader";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { PayrollRun } from "./PayrollRun";
import { runPayrollAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function PayrollPage({ params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  let access;
  try {
    access = await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) redirect("/login");
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  if (!can(access.role, "staff:manage")) {
    return (
      <div className="pb-10">
        <PageHeader tenantId={tenantId} title="Payroll" />
        <p className="kb-card p-5 text-sm text-[var(--kb-text-dim)]">
          What people are paid is the most sensitive thing in a small business, so only an owner can open this.
        </p>
      </div>
    );
  }

  const members = await prisma.membership.findMany({
    where: { tenantId },
    select: { id: true, costRateCents: true, user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });

  const now = new Date();
  const year = taxYearOf(now);
  const haveTables = TAX_TABLES.some((table) => table.year === year);

  return (
    <div className="pb-10">
      <PageHeader tenantId={tenantId} title="Payroll" />

      {!haveTables && (
        <p className="kb-card mb-4 p-4 text-sm text-[var(--kb-text)]" style={{ background: "var(--kb-tint-yellow)" }}>
          There are no tax tables loaded for the year ending February {year}. SARS publishes them in the February budget.
          Until they are in, payroll for this year cannot be worked out — running it on last year&apos;s brackets would be
          wrong in a way nobody notices for months.
        </p>
      )}

      {members.length === 0 ? (
        <EmptyState
          title="Nobody on the payroll yet"
          purpose="Works out what each person takes home and what has to go to SARS, showing its own arithmetic so you can check it."
          needs="The people who work here, invited under Staff & Roles."
          action={{ label: "Staff & Roles", href: `/dashboard/${tenantId}/staff` }}
        />
      ) : (
        <PayrollRun
          tenantId={tenantId}
          defaultMonth={`${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`}
          people={members.map((member) => ({
            id: member.id,
            name: member.user.name ?? member.user.email ?? "Unnamed",
            costRateCents: member.costRateCents,
          }))}
          runAction={runPayrollAction}
        />
      )}

      <section className="kb-card mt-4 p-4 sm:p-5">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-[var(--kb-text-dim)]">What this does not do</h2>
        <ul className="mt-2 grid gap-1.5 text-xs text-[var(--kb-text-dim)]">
          <li>It does not file anything. EMP201 and EMP501 go to SARS through eFiling or e@syFile — this produces the figures to type in.</li>
          <li>It does not pay anybody. The money still leaves through your bank.</li>
          <li>
            It works on the published tables for the year, which are dated and visible rather than buried in the code, so
            anybody can see which year&apos;s figures produced a number.
          </li>
        </ul>
      </section>
    </div>
  );
}
