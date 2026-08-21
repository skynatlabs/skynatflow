// The Business Graph API — movement functions (deliveries, site visits,
// installs). A driver/technician app action and a manual owner action call
// the exact same functions here.

import { EventType, TransactionStatus } from "@prisma/client";
import { convertToInvoice } from "./money";
import { prisma } from "@/lib/db";

export async function logDelivery(params: {
  tenantId: string;
  partyId: string;
  notes?: string;
  photoUrl?: string;
  signedByUrl?: string;
  gpsLat?: number;
  gpsLng?: number;
  type?: EventType; // defaults to DELIVERY — the driver app's own calls never pass this
  // If a QUOTE id is supplied and it's ACCEPTED, completing the delivery
  // auto-generates the invoice — this is the "proof of delivery triggers
  // the money engine" link described in the strategic report, Section 9.
  fromAcceptedQuoteId?: string;
}) {
  const event = await prisma.event.create({
    data: {
      tenantId: params.tenantId,
      partyId: params.partyId,
      type: params.type ?? EventType.DELIVERY,
      notes: params.notes,
      photoUrl: params.photoUrl,
      signedByUrl: params.signedByUrl,
      gpsLat: params.gpsLat,
      gpsLng: params.gpsLng,
    },
  });

  if (params.fromAcceptedQuoteId) {
    const quote = await prisma.transaction.findUnique({
      where: { id: params.fromAcceptedQuoteId },
    });
    if (quote && quote.status === TransactionStatus.ACCEPTED) {
      await convertToInvoice({ quoteId: quote.id });
    }
  }

  return event;
}

export async function logFollowUpSent(params: {
  tenantId: string;
  partyId: string;
  transactionId: string;
  notes: string;
}) {
  return prisma.event.create({
    data: {
      tenantId: params.tenantId,
      partyId: params.partyId,
      transactionId: params.transactionId,
      type: EventType.FOLLOW_UP_SENT,
      notes: params.notes,
    },
  });
}

// How many follow-up touches a transaction has already had — drives the
// escalating tone in the AI-drafted message (strategic report, Section 6.3).
export async function countFollowUpsSent(transactionId: string): Promise<number> {
  return prisma.event.count({
    where: { transactionId, type: EventType.FOLLOW_UP_SENT },
  });
}
