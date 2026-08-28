import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { requireTenantAccess, AuthRequiredError, ForbiddenError } from "@/lib/auth/tenant-access";
import { generateProposalContent, getProposalUsage } from "@/lib/ai/proposal";

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { tenantId, customerName, projectLocation, itemName, quantity } = body;

  try {
    await requireTenantAccess(tenantId);
  } catch (err) {
    if (err instanceof AuthRequiredError) return NextResponse.json({ error: "Sign-in required" }, { status: 401 });
    if (err instanceof ForbiddenError) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    throw err;
  }

  if (!customerName || !projectLocation || !itemName) {
    return NextResponse.json({ error: "customerName, projectLocation, and itemName are required" }, { status: 400 });
  }

  try {
    const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const content = await generateProposalContent({
      tenantId,
      tenantName: tenant.name,
      customerName,
      projectLocation,
      lines: [{ name: itemName, quantity: Number(quantity ?? 1) }],
    });
    const usage = await getProposalUsage(tenantId);
    return NextResponse.json({ ...content, usage: { used: usage.used, limit: usage.limit } });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Generation failed" },
      { status: 400 }
    );
  }
}
