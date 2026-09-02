// Backs the tenant tile grid at /car/tenants — same client-fetch pattern as
// the dashboard's TransactionListPanel, so search-as-you-type and
// pagination don't need a full page reload.

import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireSuperAdmin } from "@/lib/auth/tenant-access";
import { nicheConfig } from "@/lib/niches/config";

const PAGE_SIZE = 24;

export async function GET(req: NextRequest) {
  await requireSuperAdmin();

  const { searchParams } = req.nextUrl;
  const page = Math.max(1, Number(searchParams.get("page") ?? 1));
  const q = searchParams.get("q")?.trim();

  const where = q ? { name: { contains: q, mode: "insensitive" as const } } : {};

  const [items, total] = await Promise.all([
    prisma.tenant.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: {
        memberships: { where: { role: "OWNER" }, include: { user: { select: { email: true } } }, take: 1 },
        _count: { select: { memberships: true } },
      },
    }),
    prisma.tenant.count({ where }),
  ]);

  return NextResponse.json({
    items: items.map((t) => ({
      id: t.id,
      name: t.name,
      niche: nicheConfig(t.niche).label,
      owner: t.memberships[0]?.user.email ?? "no owner membership",
      memberCount: t._count.memberships,
      createdAt: t.createdAt,
    })),
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  });
}
