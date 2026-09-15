// Where a phone sends the field captures it queued while it had no signal.

import { NextRequest, NextResponse } from "next/server";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { assertCan } from "@/lib/core/access";
import { applyFieldCaptures, type FieldCapture } from "@/lib/core/fieldCapture";

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const access = await requireTenantAccess(tenantId);
  try {
    assertCan(access.role, "delivery:log");
  } catch {
    return NextResponse.json({ error: "Your role cannot record field work." }, { status: 403 });
  }
  const body = (await req.json().catch(() => null)) as { captures?: FieldCapture[] } | null;
  const captures = Array.isArray(body?.captures) ? body!.captures.slice(0, 50) : [];
  return NextResponse.json({ outcomes: await applyFieldCaptures(tenantId, captures) });
}
