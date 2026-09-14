import { route, paging, body, str, int } from "@/lib/api/handler";
import { prisma } from "@/lib/db";
import { createQuote } from "@/lib/core/money";
import { composeQuoteFromText } from "@/lib/core/quoteComposer";

export const dynamic = "force-dynamic";

export const GET = route({}, async ({ caller, search }) => {
  const { limit, offset } = paging(search);
  const status = search.get("status")?.trim().toUpperCase();

  const where = {
    tenantId: caller.tenantId,
    type: "QUOTE" as const,
    ...(status ? { status: status as never } : {}),
  };

  const [quotes, total] = await Promise.all([
    prisma.transaction.findMany({
      where, orderBy: { createdAt: "desc" }, take: limit, skip: offset,
      select: {
        id: true, status: true, amountCents: true, subject: true, poNumber: true,
        createdAt: true, dueAt: true, respondedAt: true,
        party: { select: { id: true, name: true } },
      },
    }),
    prisma.transaction.count({ where }),
  ]);

  return { quotes, total, limit, offset };
});

/**
 * Two ways in, because integrators arrive with two shapes of data.
 *
 * Structured callers send customerId and lines. Anything reading from a
 * mailbox, a form or a messaging bot has prose — and posting that prose is
 * far more likely to succeed than asking it to resolve product ids first.
 */
export const POST = route({ capability: "quote:create", mutates: true }, async ({ caller, req }) => {
  const input = await body(req);
  const text = str(input, "text");

  if (text) {
    const result = await composeQuoteFromText({
      tenantId: caller.tenantId,
      text,
      customerId: str(input, "customerId"),
      subject: str(input, "subject"),
    });
    return { quote: result };
  }

  const lines = Array.isArray(input.lines) ? input.lines : null;
  if (!lines?.length) {
    throw new Error('Send either "text" (a written list) or "lines" (itemId, quantity, unitPriceCents).');
  }

  const quote = await createQuote({
    tenantId: caller.tenantId,
    partyId: str(input, "customerId", true)!,
    subject: str(input, "subject"),
    poNumber: str(input, "poNumber"),
    lines: lines.map((raw) => {
      const line = raw as Record<string, unknown>;
      return {
        itemId: str(line, "itemId", true)!,
        quantity: int(line, "quantity", true)!,
        unitPriceCents: int(line, "unitPriceCents", true)!,
        discountPercent: int(line, "discountPercent"),
        taxRatePercent: int(line, "taxRatePercent"),
      };
    }),
  });

  return { quote: { id: quote.id, status: quote.status, totalCents: quote.amountCents } };
});
