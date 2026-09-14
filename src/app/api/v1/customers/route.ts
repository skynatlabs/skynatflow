import { route, paging, body, str } from "@/lib/api/handler";
import { prisma } from "@/lib/db";
import { createParty } from "@/lib/core/parties";
import { PartyRole } from "@prisma/client";

export const dynamic = "force-dynamic";

export const GET = route({}, async ({ caller, search }) => {
  const { limit, offset } = paging(search);
  const q = search.get("q")?.trim();

  const where = {
    tenantId: caller.tenantId,
    role: PartyRole.CUSTOMER,
    ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
  };

  const [customers, total] = await Promise.all([
    prisma.party.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      skip: offset,
      select: {
        id: true, name: true, email: true, phone: true, companyName: true,
        vatNumber: true, addressLine: true, city: true, createdAt: true,
      },
    }),
    prisma.party.count({ where }),
  ]);

  return { customers, total, limit, offset };
});

export const POST = route({ capability: "task:manage", mutates: true }, async ({ caller, req }) => {
  const input = await body(req);
  const party = await createParty({
    tenantId: caller.tenantId,
    role: PartyRole.CUSTOMER,
    name: str(input, "name", true)!,
    email: str(input, "email"),
    phone: str(input, "phone"),
    companyName: str(input, "companyName"),
    vatNumber: str(input, "vatNumber"),
    addressLine: str(input, "addressLine"),
    city: str(input, "city"),
  });
  return { customer: { id: party.id, name: party.name } };
});
