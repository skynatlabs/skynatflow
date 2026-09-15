// The workspace's currency, and the formatter re-exported for server code.
//
// Client components import from "@/lib/format/money" instead: this module
// reads the database, and anything that imports it drags the Postgres driver
// into the browser bundle.

import { prisma } from "@/lib/db";

export { formatMoney, currencySymbol, CURRENCY_FOR_COUNTRY } from "@/lib/format/money";

/**
 * The workspace's currency. One query, and callers that format many figures
 * should fetch it once and pass it down rather than call this per figure.
 */
export async function tenantCurrency(tenantId: string): Promise<string> {
  const t = await prisma.tenant.findUnique({
    where: { id: tenantId },
    select: { currency: true },
  });
  return t?.currency ?? "ZAR";
}

