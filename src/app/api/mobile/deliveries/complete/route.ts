// Driver taps "Mark Delivered" — this is the exact "proof of delivery
// triggers the money engine" link from the strategic report (Section 9),
// calling the same logDelivery() function the rest of the platform uses.

import { NextRequest, NextResponse } from "next/server";
import { logDelivery } from "@/lib/core/movement";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { tenantId, partyId, quoteId, photoUrl, signedByUrl, gpsLat, gpsLng, notes } = body;

  if (!tenantId || !partyId) {
    return NextResponse.json({ error: "tenantId and partyId are required" }, { status: 400 });
  }

  try {
    const event = await logDelivery({
      tenantId,
      partyId,
      fromAcceptedQuoteId: quoteId,
      photoUrl,
      signedByUrl,
      gpsLat,
      gpsLng,
      notes,
    });
    return NextResponse.json({ ok: true, event });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Could not log delivery" },
      { status: 400 }
    );
  }
}
