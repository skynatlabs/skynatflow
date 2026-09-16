"use server";

import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { can } from "@/lib/core/access";
import { buildPayslip, emp201From, type Payslip } from "@/lib/core/payroll";

export interface PayrollResult {
  payslips: Array<{
    name: string;
    gross: number;
    deductions: number;
    net: number;
    employerCost: number;
    lines: Payslip["lines"];
    workings: string[];
    warnings: string[];
  }>;
  emp201: { paye: number; uif: number; sdl: number; total: number; dueOn: string; notes: string[]; headcount: number };
  wagesTotal: number;
}

/**
 * Work the month out.
 *
 * Nothing is stored. A payslip is a calculation over facts already in the
 * system plus what somebody is paid, and keeping a snapshot of it would mean
 * the figures could drift from the hours behind them without anybody seeing.
 */
export async function runPayrollAction(formData: FormData): Promise<PayrollResult> {
  const tenantId = String(formData.get("tenantId") ?? "");
  const access = await requireTenantAccess(tenantId);
  // What people are paid is the most sensitive thing in a small business.
  if (!can(access.role, "staff:manage")) throw new Error("Only an owner can see payroll.");

  const month = String(formData.get("month") ?? "");
  const base = month ? new Date(`${month}-01T00:00:00.000Z`) : new Date();
  const periodStart = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth(), 1));
  const periodEnd = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0, 23, 59, 59, 999));

  const payslips: Payslip[] = [];
  for (const [key, value] of formData.entries()) {
    if (!key.startsWith("salary-")) continue;
    const membershipId = key.slice("salary-".length);

    const salary = cents(String(value));
    const hourly = cents(String(formData.get(`hourly-${membershipId}`) ?? ""));
    if (!salary && !hourly) continue;

    payslips.push(
      await buildPayslip({
        tenantId,
        membershipId,
        periodStart,
        periodEnd,
        salaryCents: salary,
        hourlyRateCents: salary ? null : hourly,
      }),
    );
  }

  const declaration = emp201From(payslips, { periodEnd });

  return {
    payslips: payslips.map((slip) => ({
      name: slip.name,
      gross: slip.grossCents,
      deductions: slip.deductionsCents,
      net: slip.netCents,
      employerCost: slip.employerCostCents,
      lines: slip.lines,
      workings: slip.workings,
      warnings: slip.warnings,
    })),
    emp201: {
      paye: declaration.payeCents,
      uif: declaration.uifCents,
      sdl: declaration.sdlCents,
      total: declaration.totalCents,
      dueOn: declaration.dueOn.toISOString().slice(0, 10),
      notes: declaration.notes,
      headcount: declaration.headcount,
    },
    wagesTotal: payslips.reduce((sum, slip) => sum + slip.netCents, 0),
  };
}

function cents(raw: string): number | null {
  const cleaned = raw.replace(/[^0-9.]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
}
