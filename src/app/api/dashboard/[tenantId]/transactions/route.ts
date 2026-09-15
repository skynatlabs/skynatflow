// Backs the paginated list panel (TransactionListPanel) shared by the
// Quotes and Invoices sections — a plain JSON API so the panel can stay
// mounted across navigation between /quotes and /quotes/[id] (App Router
// layouts can't read searchParams, so the list has to fetch client-side).

import { NextRequest, NextResponse } from "next/server";
import { Prisma, TransactionType } from "@prisma/client";
import { prisma } from "@/lib/db";
import { requireTenantAccess } from "@/lib/auth/tenant-access";

const PAGE_SIZE = 25;

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  await requireTenantAccess(tenantId);

  const { searchParams } = req.nextUrl;
  const type = searchParams.get("type") === "INVOICE" ? TransactionType.INVOICE : TransactionType.QUOTE;
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const q = searchParams.get("q")?.trim();

  const like = { contains: q ?? "", mode: "insensitive" as const };

  // Searching by customer alone stops being enough the moment a workspace has
  // a few thousand documents: the question people actually arrive with is
  // "which quote had the 8kVA inverter on it", and the customer's name is the
  // one thing they cannot remember. So the line items are searched too, along
  // with the subject and PO number — the other two fields somebody would
  // reasonably expect to find a document by.
  const where: Prisma.TransactionWhereInput = {
    tenantId,
    type,
    ...(q
      ? {
          OR: [
            { party: { name: like } },
            { subject: like },
            { poNumber: like },
            { itemLines: { some: { item: { name: like } } } },
            { itemLines: { some: { item: { sku: like } } } },
            { itemLines: { some: { item: { description: like } } } },
          ],
        }
      : {}),
  };

  const [items, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: {
        party: true,
        // Always included rather than only when searching: a conditional
        // include defeats Prisma's type inference, and twelve item names
        // across twenty-five rows is not a query worth optimising for.
        // They are only read when there is something to match against.
        itemLines: {
          select: { item: { select: { name: true, sku: true } } },
          take: 12,
        },
      },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.transaction.count({ where }),
  ]);

  const needle = q?.toLowerCase() ?? "";

  return NextResponse.json({
    items: items.map((t) => {
      // Name the items that actually matched, not every item on the document.
      const matchedItems = q
        ? [
            ...new Set(
              t.itemLines
                .filter(
                  (l) =>
                    l.item.name.toLowerCase().includes(needle) ||
                    (l.item.sku ?? "").toLowerCase().includes(needle)
                )
                .map((l) => l.item.name)
            ),
          ].slice(0, 3)
        : [];

      return {
        id: t.id,
        partyName: t.party.name,
        amountCents: t.amountCents,
        status: t.status,
        createdAt: t.createdAt,
        subject: t.subject,
        matchedItems,
      };
    }),
    total,
    page,
    pageSize: PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}
