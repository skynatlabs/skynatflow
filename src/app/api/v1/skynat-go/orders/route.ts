// Skynat Go posts each delivered order here, so a merchant selling on the
// delivery platform has books that keep themselves.
//
// Go holds a key issued by this workspace, so the merchant can revoke the
// connection from their own API keys page without anyone's help.

import { route, body, str, int } from "@/lib/api/handler";
import { ingestDeliveryOrder, platformFees, type SkynatOrderLine } from "@/lib/core/skynatGo";

export const dynamic = "force-dynamic";

export const GET = route({}, async ({ caller, search }) => {
  const days = Number(search.get("days") ?? 30);
  const since = new Date(Date.now() - (Number.isFinite(days) ? days : 30) * 86_400_000);

  return { since, ...(await platformFees(caller.tenantId, since)) };
});

export const POST = route({ capability: "invoice:create", mutates: true }, async ({ caller, req }) => {
  const input = await body(req);

  const result = await ingestDeliveryOrder({
    tenantId: caller.tenantId,
    orderId: str(input, "orderId", true)!,
    storeName: str(input, "storeName"),
    customer: {
      name: str(input, "customerName") ?? "Skynat Go customer",
      phone: str(input, "customerPhone"),
      email: str(input, "customerEmail"),
    },
    lines: parseLines(input.lines),
    totalCents: int(input, "totalCents", true)!,
    feeCents: int(input, "feeCents") ?? undefined,
    settled: input.settled === false ? false : true,
    occurredAt: parseDate(str(input, "occurredAt")),
  });

  return { order: result };
});

function parseLines(raw: unknown): SkynatOrderLine[] {
  if (!Array.isArray(raw)) return [];

  return raw.flatMap((entry) => {
    if (typeof entry !== "object" || entry === null) return [];
    const line = entry as Record<string, unknown>;
    const name = typeof line.name === "string" ? line.name : "";
    if (!name.trim()) return [];

    return [{
      name,
      quantity: Number(line.quantity) || 1,
      unitPriceCents: Number(line.unitPriceCents) || 0,
      sku: typeof line.sku === "string" ? line.sku : null,
    }];
  });
}

function parseDate(value: string | null | undefined): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);

  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
}
