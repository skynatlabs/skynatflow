import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { requireTenantAccess } from "@/lib/auth/tenant-access";
import { synthesizePaVoice } from "@/lib/voice/synthesize";

export async function POST(req: NextRequest, { params }: { params: Promise<{ tenantId: string }> }) {
  const { tenantId } = await params;
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ error: "Sign in required" }, { status: 401 });
  await requireTenantAccess(tenantId);

  const { text } = await req.json();
  if (!text || typeof text !== "string" || !text.trim()) {
    return NextResponse.json({ engine: "browser" });
  }

  const result = await synthesizePaVoice(tenantId, text);
  return NextResponse.json(result);
}
