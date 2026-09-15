// Live catalogue search for the item field on quotes, invoices and cash sales.

import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { searchCatalog } from "@/lib/core/catalog";

export async function GET(req: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  await requireTenantAccess(tenantId);
  const q = req.nextUrl.searchParams.get("q") ?? "";
  return NextResponse.json({ results: await searchCatalog(tenantId, q) });
}
