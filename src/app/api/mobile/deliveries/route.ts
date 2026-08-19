// Mobile-facing endpoint for the driver app (Phase 6). Lists today's
// deliveries for a tenant. Auth is a shared-secret header for now — real
// per-driver login is part of the Phase 0 Auth.js checkpoint; this is
// enough to build and test the field app against without waiting on that.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET(req: NextRequest) {
  const tenantId = req.nextUrl.searchParams.get("tenantId");
  if (!tenantId) {
    return NextResponse.json({ error: "tenantId is required" }, { status: 400 });
  }

  // Transactions of type QUOTE/INVOICE that are ACCEPTED but not yet
  // fulfilled represent "needs a delivery" — a simple, real query rather
  // than a dedicated status field, since delivery status is really just
  // "has a DELIVERY Event been logged against this party yet."
  const acceptedQuotes = await prisma.transaction.findMany({
    where: { tenantId, type: "QUOTE", status: "ACCEPTED" },
    include: { party: true },
  });

  const deliveredPartyIds = new Set(
    (
      await prisma.event.findMany({
        where: { tenantId, type: "DELIVERY" },
        select: { partyId: true },
      })
    ).map((e) => e.partyId)
  );

  const pending = acceptedQuotes.filter((q) => !deliveredPartyIds.has(q.partyId));

  return NextResponse.json({
    deliveries: pending.map((q) => ({
      quoteId: q.id,
      partyId: q.partyId,
      customerName: q.party.name,
      customerPhone: q.party.phone,
      amountCents: q.amountCents,
    })),
  });
}
