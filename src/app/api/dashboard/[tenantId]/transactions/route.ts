// Backs the paginated list panel (TransactionListPanel) shared by the
// Quotes and Invoices sections — a plain JSON API so the panel can stay
// mounted across navigation between /quotes and /quotes/[id] (App Router
// layouts can't read searchParams, so the list has to fetch client-side).

import { NextRequest, NextResponse } from "next/server";
import { TransactionType } from "@prisma/client";
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

  const where = {
    tenantId,
    type,
    ...(q ? { party: { name: { contains: q, mode: "insensitive" as const } } } : {}),
  };

  const [items, total] = await Promise.all([
    prisma.transaction.findMany({
      where,
      include: { party: true },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.transaction.count({ where }),
  ]);

  return NextResponse.json({
    items: items.map((t) => ({
      id: t.id,
      partyName: t.party.name,
      amountCents: t.amountCents,
      status: t.status,
      createdAt: t.createdAt,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}
