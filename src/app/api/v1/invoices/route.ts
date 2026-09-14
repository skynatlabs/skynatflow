import { route, paging } from "@/lib/api/handler";
import { prisma } from "@/lib/db";

export const dynamic = "force-dynamic";

export const GET = route({}, async ({ caller, search }) => {
  const { limit, offset } = paging(search);
  const status = search.get("status")?.trim().toUpperCase();
  const unpaidOnly = search.get("unpaid") === "true";

  const where = {
    tenantId: caller.tenantId,
    type: "INVOICE" as const,
    ...(status ? { status: status as never } : {}),
    ...(unpaidOnly ? { status: { in: ["SENT", "PARTIALLY_PAID", "OVERDUE"] as never } } : {}),
  };

  const [invoices, total] = await Promise.all([
    prisma.transaction.findMany({
      where, orderBy: { createdAt: "desc" }, take: limit, skip: offset,
      select: {
        id: true, status: true, amountCents: true, subject: true,
        createdAt: true, dueAt: true,
        party: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.transaction.count({ where }),
  ]);

  return { invoices, total, limit, offset };
});
