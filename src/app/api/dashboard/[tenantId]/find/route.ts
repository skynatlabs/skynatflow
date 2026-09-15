// Backs the Find half of the one input on every screen.

import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { find, looksLikeAsking } from "@/lib/core/find";

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  await requireTenantAccess(tenantId);
  const q = req.nextUrl.searchParams.get("q") ?? "";
  const results = await find(tenantId, q);
  return NextResponse.json({ results, asking: looksLikeAsking(q) });
}
