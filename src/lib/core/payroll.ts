// Paying people, and what the taxman takes on the way.
//
// Payroll is the last thing a small business moves off a spreadsheet, and the
// reason is fear: getting PAYE wrong is not an accounting error, it is money
// deducted from somebody's wages and not paid over, which SARS treats far
// more seriously than an underpayment of the business's own tax.
//
// So this is built to be checkable rather than clever. Every payslip shows
// its own arithmetic. The tax tables are dated, visible data rather than
// constants buried in a function, so anybody can see which year's figures
// produced a number — and the system refuses to run a period with tables it
// does not have for that year, instead of quietly using last year's.
//
// What it does not do: file anything. EMP201 and EMP501 go to SARS through
// eFiling or e@syFile, and this produces the figures to type in and the
// supporting file, not a submission. That boundary is deliberate — an
// automatic submission that is wrong is worse than a number somebody checked.

import { prisma } from "@/lib/db";

// ---------------------------------------------------------------- the tables
//
// South Africa, by tax year (a tax year runs 1 March to 28/29 February and is
// named by the year it ends in). Thresholds and rebates are published by SARS
// in the February budget. Anything not listed here is a year this cannot do.

export interface TaxBracket {
  /** Annual income up to which this bracket applies, in cents. Null = the top bracket. */
  upToCents: number | null;
  /** Tax on everything below this bracket, in cents. */
  baseCents: number;
  /** Percentage on the part above the previous bracket. */
  percent: number;
}

export interface TaxTable {
  /** Tax year ending in this calendar year. 2026 means 1 Mar 2025 – 28 Feb 2026. */
  year: number;
  brackets: TaxBracket[];
  /** Rebates by age band, annual, in cents. */
  primaryRebateCents: number;
  secondaryRebateCents: number;
  tertiaryRebateCents: number;
  /** Below this annual income, no PAYE at all. */
  thresholdCents: number;
  /** UIF: 1% each side, on earnings capped at this per month. */
  uifCeilingCentsPerMonth: number;
  uifPercent: number;
  /** SDL: payable only once the annual payroll bill passes this. */
  sdlPercent: number;
  sdlPayrollThresholdCents: number;
}

export const TAX_TABLES: TaxTable[] = [
  {
    year: 2026,
    brackets: [
      { upToCents: 23_710_000, baseCents: 0, percent: 18 },
      { upToCents: 37_050_000, baseCents: 4_267_800, percent: 26 },
      { upToCents: 51_260_000, baseCents: 7_735_200, percent: 31 },
      { upToCents: 67_390_000, baseCents: 12_140_300, percent: 36 },
      { upToCents: 85_790_000, baseCents: 17_947_100, percent: 39 },
      { upToCents: 181_760_000, baseCents: 25_123_100, percent: 41 },
      { upToCents: null, baseCents: 64_471_200, percent: 45 },
    ],
    primaryRebateCents: 1_723_500,
    secondaryRebateCents: 944_400,
    tertiaryRebateCents: 314_500,
    thresholdCents: 9_575_000,
    uifCeilingCentsPerMonth: 1_771_200,
    uifPercent: 1,
    sdlPercent: 1,
    sdlPayrollThresholdCents: 50_000_000,
  },
];

/**
 * The tax year a date falls in.
 *
 * March starts a new one, which catches everybody out at least once: a
 * payslip dated 3 March belongs to the year ending the following February.
 */
export function taxYearOf(date: Date): number {
  const month = date.getUTCMonth(); // 0 = January
  return month >= 2 ? date.getUTCFullYear() + 1 : date.getUTCFullYear();
}

export function tableFor(year: number): TaxTable | null {
  return TAX_TABLES.find((table) => table.year === year) ?? null;
}

/**
 * PAYE on one month's pay.
 *
 * Worked annually and then divided, which is how SARS's own method works and
 * why a month with a bonus in it is taxed the way it is. Done month by month
 * instead, somebody paid unevenly would be over-taxed in a good month and
 * never get it back until assessment.
 */
export function payeFor(params: { monthlyCents: number; table: TaxTable; age?: number }): {
  monthlyCents: number;
  annualIncomeCents: number;
  annualTaxCents: number;
  rebateCents: number;
  workings: string[];
} {
  const annual = params.monthlyCents * 12;
  const age = params.age ?? 30;

  let rebate = params.table.primaryRebateCents;
  if (age >= 65) rebate += params.table.secondaryRebateCents;
  if (age >= 75) rebate += params.table.tertiaryRebateCents;

  const workings: string[] = [`${cents(params.monthlyCents)} a month is ${cents(annual)} a year.`];

  if (annual <= params.table.thresholdCents) {
    workings.push(`That is under the ${cents(params.table.thresholdCents)} threshold, so no PAYE is due.`);
    return { monthlyCents: 0, annualIncomeCents: annual, annualTaxCents: 0, rebateCents: rebate, workings };
  }

  let previousCeiling = 0;
  let tax = 0;
  for (const bracket of params.table.brackets) {
    if (bracket.upToCents === null || annual <= bracket.upToCents) {
      const above = annual - previousCeiling;
      tax = bracket.baseCents + Math.round((above * bracket.percent) / 100);
      workings.push(
        `${cents(bracket.baseCents)} plus ${bracket.percent}% of the ${cents(above)} above ${cents(previousCeiling)} is ${cents(tax)}.`,
      );
      break;
    }
    previousCeiling = bracket.upToCents;
  }

  const afterRebate = Math.max(0, tax - rebate);
  workings.push(`Less the ${cents(rebate)} rebate: ${cents(afterRebate)} for the year.`);

  const monthly = Math.round(afterRebate / 12);
  workings.push(`Divided by twelve: ${cents(monthly)} this month.`);

  return { monthlyCents: monthly, annualIncomeCents: annual, annualTaxCents: afterRebate, rebateCents: rebate, workings };
}

/** UIF is 1% from the employee and 1% from the business, both on capped earnings. */
export function uifFor(monthlyCents: number, table: TaxTable): { employeeCents: number; employerCents: number; cappedAtCents: number } {
  const capped = Math.min(monthlyCents, table.uifCeilingCentsPerMonth);
  const each = Math.round((capped * table.uifPercent) / 100);
  return { employeeCents: each, employerCents: each, cappedAtCents: capped };
}

function cents(value: number): string {
  return `R${(value / 100).toLocaleString("en-ZA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ---------------------------------------------------------------- a payslip

export interface PayslipLine {
  label: string;
  amountCents: number;
  kind: "earning" | "deduction" | "employer";
}

export interface Payslip {
  membershipId: string;
  name: string;
  periodStart: Date;
  periodEnd: Date;
  lines: PayslipLine[];
  grossCents: number;
  deductionsCents: number;
  netCents: number;
  /** What the business pays on top, which never appears on the employee's side. */
  employerCostCents: number;
  /** The arithmetic, shown rather than hidden. */
  workings: string[];
  warnings: string[];
}

/**
 * One person's pay for one month.
 *
 * Hours come from what they actually clocked when they are paid by the hour,
 * and from a set salary when they are not. Mixing the two silently is how a
 * business pays somebody twice, so a person with both is flagged rather than
 * guessed at.
 */
export async function buildPayslip(params: {
  tenantId: string;
  membershipId: string;
  periodStart: Date;
  periodEnd: Date;
  /** A set monthly salary in cents, when there is one. */
  salaryCents?: number | null;
  /** What an hour is paid — not what it costs the business. */
  hourlyRateCents?: number | null;
  /** Extra earnings this month: a bonus, overtime already agreed, a travel allowance. */
  extras?: Array<{ label: string; amountCents: number }>;
  /** Anything coming off: a loan repayment, a garnishee, staff purchases. */
  otherDeductions?: Array<{ label: string; amountCents: number }>;
  age?: number;
}): Promise<Payslip> {
  const membership = await prisma.membership.findFirst({
    where: { id: params.membershipId, tenantId: params.tenantId },
    include: { user: { select: { name: true, email: true } } },
  });
  if (!membership) throw new Error("That person is not on this workspace.");

  const year = taxYearOf(params.periodEnd);
  const table = tableFor(year);
  if (!table) {
    // Refused rather than quietly run on last year's figures. A payslip with
    // the wrong year's brackets is wrong in a way nobody notices for months.
    throw new Error(
      `There are no tax tables loaded for the year ending February ${year}. SARS publishes them in the February budget; until they are in, payroll for this period cannot be worked out.`,
    );
  }

  const lines: PayslipLine[] = [];
  const warnings: string[] = [];
  const workings: string[] = [];

  let gross = 0;

  if (params.salaryCents && params.hourlyRateCents) {
    warnings.push("This person has both a salary and an hourly rate. Only the salary has been used — set one or the other.");
  }

  if (params.salaryCents) {
    lines.push({ label: "Salary", amountCents: params.salaryCents, kind: "earning" });
    gross += params.salaryCents;
  } else if (params.hourlyRateCents) {
    const entries = await prisma.timeEntry.findMany({
      where: {
        tenantId: params.tenantId,
        membershipId: params.membershipId,
        clockInAt: { gte: params.periodStart, lte: params.periodEnd },
        clockOutAt: { not: null },
      },
      select: { clockInAt: true, clockOutAt: true },
    });

    const minutes = entries.reduce((sum, entry) => sum + Math.round((entry.clockOutAt!.getTime() - entry.clockInAt.getTime()) / 60_000), 0);
    const hours = Math.round((minutes / 60) * 100) / 100;
    const pay = Math.round(hours * params.hourlyRateCents);

    lines.push({ label: `Hours worked (${hours})`, amountCents: pay, kind: "earning" });
    gross += pay;
    workings.push(`${hours} hours clocked at ${cents(params.hourlyRateCents)} an hour.`);

    const open = await prisma.timeEntry.count({
      where: { tenantId: params.tenantId, membershipId: params.membershipId, clockInAt: { gte: params.periodStart, lte: params.periodEnd }, clockOutAt: null },
    });
    if (open > 0) {
      warnings.push(`${open} ${open === 1 ? "shift was" : "shifts were"} never clocked off, so ${open === 1 ? "it is" : "they are"} not paid here.`);
    }
  } else {
    warnings.push("No salary and no hourly rate, so this payslip has nothing on it.");
  }

  for (const extra of params.extras ?? []) {
    lines.push({ label: extra.label, amountCents: extra.amountCents, kind: "earning" });
    gross += extra.amountCents;
  }

  const paye = payeFor({ monthlyCents: gross, table, age: params.age });
  const uif = uifFor(gross, table);

  if (paye.monthlyCents > 0) lines.push({ label: "PAYE", amountCents: paye.monthlyCents, kind: "deduction" });
  lines.push({ label: "UIF", amountCents: uif.employeeCents, kind: "deduction" });
  for (const deduction of params.otherDeductions ?? []) {
    lines.push({ label: deduction.label, amountCents: deduction.amountCents, kind: "deduction" });
  }

  lines.push({ label: "UIF (employer's share)", amountCents: uif.employerCents, kind: "employer" });

  workings.push(...paye.workings);
  if (gross > table.uifCeilingCentsPerMonth) {
    workings.push(`UIF is 1% of ${cents(table.uifCeilingCentsPerMonth)} rather than of the full pay, because that is where the ceiling sits.`);
  }

  const deductions = lines.filter((line) => line.kind === "deduction").reduce((sum, line) => sum + line.amountCents, 0);
  const employer = lines.filter((line) => line.kind === "employer").reduce((sum, line) => sum + line.amountCents, 0);

  return {
    membershipId: params.membershipId,
    name: membership.user.name ?? membership.user.email ?? "Unnamed",
    periodStart: params.periodStart,
    periodEnd: params.periodEnd,
    lines,
    grossCents: gross,
    deductionsCents: deductions,
    netCents: gross - deductions,
    employerCostCents: gross + employer,
    workings,
    warnings,
  };
}

// ------------------------------------------------------------------- EMP201

export interface Emp201 {
  periodLabel: string;
  payeCents: number;
  uifCents: number;
  sdlCents: number;
  totalCents: number;
  headcount: number;
  /** When this has to be with SARS. */
  dueOn: Date;
  notes: string[];
}

/**
 * The monthly declaration's figures.
 *
 * Not a submission. EMP201 is filed on eFiling and this produces the four
 * numbers that go on it, out of payslips that show their own arithmetic — so
 * somebody can check rather than trust.
 */
export function emp201From(payslips: Payslip[], params: { periodEnd: Date; annualPayrollCents?: number }): Emp201 {
  const year = taxYearOf(params.periodEnd);
  const table = tableFor(year);
  if (!table) throw new Error(`No tax tables for the year ending February ${year}.`);

  const paye = payslips.reduce((sum, slip) => sum + (slip.lines.find((l) => l.label === "PAYE")?.amountCents ?? 0), 0);
  const uif = payslips.reduce(
    (sum, slip) =>
      sum +
      (slip.lines.find((l) => l.label === "UIF")?.amountCents ?? 0) +
      (slip.lines.find((l) => l.label === "UIF (employer's share)")?.amountCents ?? 0),
    0,
  );

  const monthlyPayroll = payslips.reduce((sum, slip) => sum + slip.grossCents, 0);
  const annualPayroll = params.annualPayrollCents ?? monthlyPayroll * 12;
  const sdlDue = annualPayroll > table.sdlPayrollThresholdCents;
  const sdl = sdlDue ? Math.round((monthlyPayroll * table.sdlPercent) / 100) : 0;

  // The 7th of the following month, or the last business day before it when
  // the 7th is a weekend — which SARS applies and everybody forgets.
  const due = new Date(Date.UTC(params.periodEnd.getUTCFullYear(), params.periodEnd.getUTCMonth() + 1, 7));
  while (due.getUTCDay() === 0 || due.getUTCDay() === 6) due.setUTCDate(due.getUTCDate() - 1);

  const notes = [
    `Worked out on the tables for the year ending February ${year}.`,
    "These are the figures to type into EMP201 on eFiling. Nothing is submitted from here — an automatic submission that is wrong is worse than a number somebody checked.",
  ];
  if (!sdlDue) {
    notes.push(
      `No SDL: the payroll bill works out at about ${cents(annualPayroll)} a year, under the ${cents(table.sdlPayrollThresholdCents)} where SDL starts.`,
    );
  }
  if (payslips.some((slip) => slip.warnings.length > 0)) {
    notes.push("At least one payslip has a warning on it. Settle those before filing — this total is only as right as the slips under it.");
  }

  return {
    periodLabel: params.periodEnd.toLocaleDateString("en-ZA", { month: "long", year: "numeric" }),
    payeCents: paye,
    uifCents: uif,
    sdlCents: sdl,
    totalCents: paye + uif + sdl,
    headcount: payslips.filter((slip) => slip.grossCents > 0).length,
    dueOn: due,
    notes,
  };
}

/**
 * What payroll is going to cost next month, for the cash forecast.
 *
 * The number a business most often forgets is the employer's side: UIF, SDL
 * and the fact that the money leaves on the 25th while the tax leaves on the
 * 7th. Two separate outflows, not one.
 */
export async function payrollCommitment(params: {
  tenantId: string;
  people: Array<{ membershipId: string; salaryCents?: number | null; hourlyRateCents?: number | null }>;
  periodStart: Date;
  periodEnd: Date;
}) {
  const payslips: Payslip[] = [];
  for (const person of params.people) {
    payslips.push(
      await buildPayslip({
        tenantId: params.tenantId,
        membershipId: person.membershipId,
        salaryCents: person.salaryCents,
        hourlyRateCents: person.hourlyRateCents,
        periodStart: params.periodStart,
        periodEnd: params.periodEnd,
      }),
    );
  }

  const declaration = emp201From(payslips, { periodEnd: params.periodEnd });
  const wages = payslips.reduce((sum, slip) => sum + slip.netCents, 0);

  return {
    wagesCents: wages,
    toSarsCents: declaration.totalCents,
    totalCents: wages + declaration.totalCents,
    sarsDueOn: declaration.dueOn,
    payslips,
    note: `${cents(wages)} to staff, and ${cents(declaration.totalCents)} to SARS by ${declaration.dueOn.toLocaleDateString("en-ZA", { day: "numeric", month: "long" })}. Two outflows, not one — the second is the one that catches businesses out.`,
  };
}
