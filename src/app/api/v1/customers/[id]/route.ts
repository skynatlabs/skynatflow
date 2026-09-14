import { NextRequest } from "next/server";
import { route, apiError } from "@/lib/api/handler";
import { prisma } from "@/lib/db";
import { customerBalance } from "@/lib/core/money";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  return route({}, async ({ caller }) => {
    // Scoped by tenant in the query itself, not checked afterwards — the
    // lookup can then never return a row from another workspace at all.
    const customer = await prisma.party.findFirst({
      where: { id, tenantId: caller.tenantId },
      select: {
        id: true, name: true, email: true, phone: true, companyName: true,
        vatNumber: true, addressLine: true, city: true, postalCode: true,
        country: true, notes: true, createdAt: true,
      },
    });
    if (!customer) throw new Error("Customer not found.");

    const [balance, documents] = await Promise.all([
      customerBalance(caller.tenantId, id).catch(() => null),
      prisma.transaction.findMany({
        where: { tenantId: caller.tenantId, partyId: id, type: { in: ["QUOTE", "INVOICE"] } },
        orderBy: { createdAt: "desc" },
        take: 20,
        select: { id: true, type: true, status: true, amountCents: true, createdAt: true },
      }),
    ]);

    return { customer, balance, documents };
  })(req).catch(() => apiError(500, "Something went wrong on our side."));
}
