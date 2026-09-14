import { route, paging, body, str, int } from "@/lib/api/handler";
import { prisma } from "@/lib/db";
import { createProduct, searchProducts } from "@/lib/core/catalog";

export const dynamic = "force-dynamic";

export const GET = route({}, async ({ caller, search }) => {
  const q = search.get("q")?.trim();
  if (q) return { products: await searchProducts(caller.tenantId, q) };

  const { limit, offset } = paging(search);
  const where = { tenantId: caller.tenantId, isActive: true };
  const [products, total] = await Promise.all([
    prisma.item.findMany({
      where, orderBy: { name: "asc" }, take: limit, skip: offset,
      select: {
        id: true, name: true, description: true, sku: true, unit: true,
        unitPriceCents: true, stockQty: true, reorderPoint: true, taxRatePercent: true,
      },
    }),
    prisma.item.count({ where }),
  ]);
  return { products, total, limit, offset };
});

export const POST = route({ capability: "product:manage", mutates: true }, async ({ caller, req }) => {
  const input = await body(req);
  const item = await createProduct({
    tenantId: caller.tenantId,
    name: str(input, "name", true)!,
    unitPriceCents: int(input, "unitPriceCents", true)!,
    sku: str(input, "sku"),
    stockQty: int(input, "stockQty"),
    reorderPoint: int(input, "reorderPoint"),
  });
  return { product: { id: item.id, name: item.name } };
});
