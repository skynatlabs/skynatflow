// Rentals — platform-wide, not tied to one niche. Any catalog Item can be
// marked rentable; a Rental tracks the out/returned lifecycle a straight
// sale doesn't need, and settles into the same Transaction ledger as
// everything else once returned.

import { prisma } from "@/lib/db";
import { RentalRateUnit } from "@prisma/client";
import { createQuote, convertToInvoice, sendQuote } from "./money";

const UNIT_TO_HOURS: Record<RentalRateUnit, number> = {
  HOUR: 1,
  DAY: 24,
  WEEK: 24 * 7,
  MONTH: 24 * 30,
};

export async function markItemRentable(params: {
  itemId: string;
  rentalRateCents: number;
  rentalRateUnit: RentalRateUnit;
  // Required: without it, a form post could flip another company's catalog
  // item to rentable and set the rate it goes out at.
  tenantId: string;
}) {
  const owned = await prisma.item.findUnique({
    where: { id: params.itemId },
    select: { tenantId: true },
  });
  if (!owned || owned.tenantId !== params.tenantId) throw new Error("Product not found.");
  return prisma.item.update({
    where: { id: params.itemId },
    data: {
      isRentable: true,
      rentalRateCents: params.rentalRateCents,
      rentalRateUnit: params.rentalRateUnit,
    },
  });
}

export async function createRental(params: {
  tenantId: string;
  itemId: string;
  partyId: string;
  endAt?: Date;
  depositCents?: number;
}) {
  const item = await prisma.item.findUnique({ where: { id: params.itemId } });
  if (!item || item.tenantId !== params.tenantId) throw new Error("Product not found.");
  const party = await prisma.party.findUnique({
    where: { id: params.partyId },
    select: { tenantId: true },
  });
  if (!party || party.tenantId !== params.tenantId) throw new Error("Customer not found.");
  if (!item.isRentable || !item.rentalRateCents || !item.rentalRateUnit) {
    throw new Error("This item isn't marked as rentable yet.");
  }

  return prisma.rental.create({
    data: {
      tenantId: params.tenantId,
      itemId: params.itemId,
      partyId: params.partyId,
      endAt: params.endAt,
      rateCents: item.rentalRateCents,
      rateUnit: item.rentalRateUnit,
      depositCents: params.depositCents,
    },
  });
}

// Marks the rental returned and generates the invoice for the actual
// duration used — sized to real elapsed time, not the originally
// estimated end date, since returns rarely land exactly on schedule.
export async function returnRental(rentalId: string, tenantId: string) {
  const rental = await prisma.rental.findUnique({
    where: { id: rentalId },
    include: { item: true },
  });
  if (!rental || rental.tenantId !== tenantId) throw new Error("Rental not found.");
  if (rental.status !== "ACTIVE") throw new Error("Rental is not active.");

  const returnedAt = new Date();
  const hoursUsed = Math.max(
    1,
    Math.ceil((returnedAt.getTime() - rental.startAt.getTime()) / 3600000)
  );
  const unitsUsed = Math.ceil(hoursUsed / UNIT_TO_HOURS[rental.rateUnit]);

  const quote = await createQuote({
    tenantId: rental.tenantId,
    partyId: rental.partyId,
    lines: [{ itemId: rental.itemId, quantity: unitsUsed, unitPriceCents: rental.rateCents }],
  });
  await sendQuote(quote.id, rental.tenantId);
  const invoice = await convertToInvoice({ quoteId: quote.id, dueInDays: 0 });

  await prisma.rental.update({
    where: { id: rentalId },
    data: { status: "RETURNED", returnedAt, transactionId: invoice.id },
  });

  return invoice;
}

export async function getActiveRentals(tenantId: string) {
  return prisma.rental.findMany({
    where: { tenantId, status: "ACTIVE" },
    include: { item: true, party: true },
    orderBy: { startAt: "asc" },
  });
}

// Active rentals past their expected return date — flagged the same way
// overdue invoices are, rather than only discovered when someone asks.
export async function getOverdueRentals(tenantId: string) {
  const now = new Date();
  return prisma.rental.findMany({
    where: { tenantId, status: "ACTIVE", endAt: { lt: now } },
    include: { item: true, party: true },
    orderBy: { endAt: "asc" },
  });
}
