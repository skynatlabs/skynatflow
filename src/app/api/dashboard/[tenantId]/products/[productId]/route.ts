// Edit a catalogue item from inside a quote or invoice, without leaving it.

import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { updateCatalogItem } from "@/lib/core/catalog";
import { recordAudit } from "@/lib/core/audit";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ tenantId: string; productId: string }> }
) {
  const { tenantId, productId } = await params;
  const access = await requireTenantAccess(tenantId);
  try {
    assertCan(access.role, "product:manage");
  } catch {
    return NextResponse.json({ error: "Your role cannot change products." }, { status: 403 });
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const num = (v: unknown) => (v === null || v === "" || v === undefined ? null : Number(v));
  try {
    const updated = await updateCatalogItem(tenantId, productId, {
      name: typeof body.name === "string" ? body.name : undefined,
      description: typeof body.description === "string" || body.description === null ? (body.description as string | null) : undefined,
      sku: typeof body.sku === "string" || body.sku === null ? (body.sku as string | null) : undefined,
      unit: typeof body.unit === "string" || body.unit === null ? (body.unit as string | null) : undefined,
      unitPriceCents: body.priceRand !== undefined ? Math.round((num(body.priceRand) ?? 0) * 100) : undefined,
      costCents: body.costRand !== undefined ? (num(body.costRand) === null ? null : Math.round(num(body.costRand)! * 100)) : undefined,
      taxRatePercent: body.taxRatePercent !== undefined ? num(body.taxRatePercent) : undefined,
    });
    await recordAudit({
      tenantId,
      actorType: "user",
      actorId: access.userId,
      capability: "product:manage",
      targetType: "Item",
      targetId: productId,
      metadata: { action: "update-from-document", name: updated.name },
    });
    return NextResponse.json({ product: updated });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Could not save." }, { status: 400 });
  }
}
