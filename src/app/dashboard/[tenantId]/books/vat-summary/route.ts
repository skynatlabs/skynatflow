// The VAT summary an accountant asks for, as a spreadsheet.
//
// This is a report, not a way out: taxable sales and tax collected by period,
// in the shape a VAT return wants. A business that has to file one needs to
// hand these numbers to somebody, and retyping them off a screen is how the
// wrong number gets filed.

import { notFound } from "next/navigation";
import { requireTenantAccess, AuthRequiredError, ForbiddenError } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { toCsv } from "@/lib/export/csv";
import { getTaxSummary } from "@/lib/core/tax";

const money = (cents: number) => (cents / 100).toFixed(2);

export async function GET(request: Request, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;

  try {
    const access = await requireTenantAccess(tenantId);
    // The tax position of the business is the owner's and the bookkeeper's.
    assertCan(access.role, "staff:manage");
  } catch (err) {
    if (err instanceof AuthRequiredError) return new Response("Sign in required", { status: 401 });
    if (err instanceof ForbiddenError) notFound();
    throw err;
  }

  const grouping = new URL(request.url).searchParams.get("grouping") === "sars" ? "sars-bimonthly" : "monthly";
  const rows = await getTaxSummary(tenantId, { grouping });
  const csv = toCsv(
    ["Period", "Tax Rate %", "Taxable Sales", "Tax Collected"],
    rows.map((r) => [r.periodLabel, r.taxRatePercent, money(r.taxableSalesCents), money(r.taxCollectedCents)])
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vat-summary.csv"`,
    },
  });
}
