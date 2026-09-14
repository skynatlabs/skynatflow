import { NextRequest } from "next/server";
import { route, body, int } from "@/lib/api/handler";
import { prisma } from "@/lib/db";
import { recordPayment } from "@/lib/core/money";

export const dynamic = "force-dynamic";

/**
 * Recording money against an invoice.
 *
 * The tenant check is explicit and first: recordPayment takes a bare invoice
 * id, so without it a key from one workspace could settle another's invoice —
 * exactly the class of hole this codebase has already had to close once.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return route({ capability: "payment:record", mutates: true }, async ({ caller, req: r }) => {
    const owned = await prisma.transaction.findFirst({
      where: { id, tenantId: caller.tenantId, type: "INVOICE" },
      select: { id: true },
    });
    if (!owned) throw new Error("Invoice not found.");

    const input = await body(r);
    const updated = await recordPayment({
      invoiceId: id,
      amountCents: int(input, "amountCents", true)!,
    });

    return {
      invoice: { id: updated.id, status: updated.status, totalCents: updated.amountCents },
    };
  })(req);
}
